import { DmrvnAbi, type AbiField } from './dmrvn-abi.js';
import { bytes32, hexBytes, keccak, normalizeAddress, recover, textHash, uint } from './dmrvn-crypto.js';
import { DmrvnJson } from './dmrvn-json.js';
import { DmrvnError } from './errors.js';
import type { EvmTypedData } from './evm-signer.js';
import { messageDigest } from './dmrvn-crypto.js';

export type DmrvnStructType = 'EvidenceLocation' | 'ClaimRequest' | 'TaskAssignment' | 'MrvObservation' | 'ForwardRequest' | 'EIP712Domain';

const invalid = (): never => { throw new DmrvnError('INVALID_INPUT'); };
const field = (name: string, type: string): AbiField => Object.freeze({ name, type });
const claimFields = DmrvnAbi.CLAIM.inputs('submitClaim')[0]!.components!;
const locationFields = claimFields.find(value => value.name === 'evidenceLocation')!.components!;
const TYPES: Readonly<Record<DmrvnStructType, readonly AbiField[]>> = Object.freeze({
  EvidenceLocation: locationFields,
  ClaimRequest: Object.freeze(claimFields.map(value => value.name === 'evidenceLocation' ? field(value.name, 'EvidenceLocation') : value)),
  TaskAssignment: DmrvnAbi.CLAIM.inputs('onReport')[0]!.components!,
  MrvObservation: DmrvnAbi.CLAIM.inputs('onReport')[3]!.components!,
  ForwardRequest: Object.freeze([field('from', 'address'), field('to', 'address'), field('value', 'uint256'),
    field('gas', 'uint256'), field('nonce', 'uint256'), field('deadline', 'uint48'), field('data', 'bytes')]),
  EIP712Domain: Object.freeze([field('name', 'string'), field('version', 'string'), field('chainId', 'uint256'), field('verifyingContract', 'address')]),
});

function map(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return invalid();
  return value as Record<string, unknown>;
}
function str(value: unknown): string { if (typeof value !== 'string') return invalid(); return value; }
function known(type: string): type is DmrvnStructType { return Object.hasOwn(TYPES, type); }
function description(type: DmrvnStructType): string {
  return type + '(' + TYPES[type].map(value => value.type + ' ' + value.name).join(',') + ')';
}

/** v7 EIP-712/provenance/calldata 계산. 네트워크 호출·서명·거래 전송을 하지 않는다. */
export class DmrvnProtocol {
  static domain(chainId: bigint | number, contract: string, forwarder = false): Record<string, unknown> {
    const chain = uint(chainId, 256);
    if (chain === 0n || chain > 9007199254740991n) return invalid();
    return { name: forwarder ? 'DMRVNForwarder' : 'DMRVNClaimContract', version: forwarder ? '1' : '7',
      chainId: Number(chain), verifyingContract: normalizeAddress(contract) };
  }

  static encodeType(type: DmrvnStructType): string {
    if (!known(type)) return invalid();
    return description(type) + (type === 'ClaimRequest' ? description('EvidenceLocation') : '');
  }

  static typeHash(type: DmrvnStructType): string { return textHash(this.encodeType(type)); }

  static typedData(type: DmrvnStructType, domain: Readonly<Record<string, unknown>>,
    message: Readonly<Record<string, unknown>>): EvmTypedData {
    if (!known(type)) return invalid();
    const types: Record<string, { name: string; type: string }[]> = Object.create(null) as Record<string, { name: string; type: string }[]>;
    const add = (type: DmrvnStructType) => { types[type] = TYPES[type].map(value => ({ name: value.name, type: value.type })); };
    add('EIP712Domain'); add(type);
    if (type === 'ClaimRequest') add('EvidenceLocation');
    return DmrvnJson.copy({ domain, types, primaryType: type, message }) as EvmTypedData;
  }

  static structHash(type: DmrvnStructType, message: Readonly<Record<string, unknown>>): string {
    if (!known(type)) return invalid();
    const value = map(message);
    const words: Uint8Array[] = [hexBytes(this.typeHash(type))];
    for (const definition of TYPES[type]) {
      const item = value[definition.name];
      if (item == null) return invalid();
      let encoded: string;
      if (known(definition.type)) encoded = this.structHash(definition.type, map(item));
      else if (definition.type === 'string') encoded = textHash(str(item));
      else if (definition.type === 'bytes') encoded = keccak(hexBytes(str(item)));
      else encoded = DmrvnAbi.encodeTuple([definition], { [definition.name]: item });
      words.push(hexBytes(encoded));
    }
    return keccak(Buffer.concat(words));
  }

  static digest(type: DmrvnStructType, domain: Readonly<Record<string, unknown>>, message: Readonly<Record<string, unknown>>): string {
    return keccak(Buffer.concat([Buffer.from([0x19, 0x01]), hexBytes(this.structHash('EIP712Domain', domain)), hexBytes(this.structHash(type, message))]));
  }

  static recover(digest: string, signature: string): string { return recover(digest, signature); }
  static ownerHash(beneficiary: string): string { return textHash(normalizeAddress(beneficiary)); }
  static evidenceLocationHash(location: Readonly<Record<string, unknown>>): string { return this.structHash('EvidenceLocation', location); }

  static verifyProvenance(evidence: Readonly<Record<string, unknown>>, evidenceHash: string, storedApprover: string): string {
    if (DmrvnJson.hash(evidence) !== bytes32(evidenceHash)) throw new DmrvnError('SIGNATURE_INVALID');
    const body = map(DmrvnJson.copy(evidence));
    const provenance = map(body.provenance);
    delete body.provenance;
    const signer = recover(messageDigest('DMRVN v4 source:' + DmrvnJson.hash(body)), str(provenance.sourceSignature));
    if (signer !== normalizeAddress(str(provenance.signer)) || signer !== normalizeAddress(storedApprover)) throw new DmrvnError('SIGNATURE_INVALID');
    return signer;
  }

  static submitCalldata(approved: Readonly<Record<string, unknown>>): string {
    return DmrvnAbi.CLAIM.encode('submitClaim', { request: approved.claimRequest, approvalSignature: approved.approvalSignature });
  }
  static executeCalldata(request: Readonly<Record<string, unknown>>, signature: string): string {
    const copy = map(DmrvnJson.copy(request));
    delete copy.nonce;
    copy.signature = signature;
    return DmrvnAbi.FORWARDER.encode('execute', { request: copy });
  }

  static sortedAddresses(addresses: readonly string[]): readonly string[] {
    const sorted = addresses.map(normalizeAddress).sort();
    if (sorted.length === 0 || new Set(sorted).size !== sorted.length) throw new DmrvnError('REPORT_MISMATCH');
    return sorted;
  }

  static committeeHash(assignment: Readonly<Record<string, unknown>>, committee: readonly string[]): string {
    const definitions = [field('taskId', 'bytes32'), field('claimId', 'bytes32'), field('quorumPolicyVersion', 'uint32'),
      field('committeeSize', 'uint8'), field('threshold', 'uint8'), field('deadline', 'uint64'), field('committee', 'address[]')];
    const value = map(DmrvnJson.copy(assignment));
    value.committee = committee;
    return keccak(hexBytes(DmrvnAbi.encodeTuple(definitions, value)));
  }

  static reportHash(assignment: Readonly<Record<string, unknown>>, observation: Readonly<Record<string, unknown>>,
    signers: readonly string[], domain: Readonly<Record<string, unknown>>): string {
    const definitions = [field('taskId', 'bytes32'), field('claimId', 'bytes32'), field('committeeHash', 'bytes32'),
      field('digest', 'bytes32'), field('signers', 'address[]')];
    const value = map(DmrvnJson.copy(assignment));
    value.digest = this.digest('MrvObservation', domain, observation);
    value.signers = this.sortedAddresses(signers);
    return keccak(hexBytes(DmrvnAbi.encodeTuple(definitions, value)));
  }
}

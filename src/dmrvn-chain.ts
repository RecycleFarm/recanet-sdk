import { DmrvnAbi } from './dmrvn-abi.js';
import { bytes32, hexBytes, keccak, uint, ZERO_BYTES32 } from './dmrvn-crypto.js';
import { DmrvnConfig } from './dmrvn-config.js';
import { deploymentAddress } from './dmrvn-deployment.js';
import { DmrvnProtocol } from './dmrvn-protocol.js';
import { DmrvnError, type DmrvnErrorCode } from './errors.js';
import type { EvmRpc } from './evm-rpc.js';
import { chainNumber } from './internal/chain-id.js';

export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

function requireValue(condition: boolean, code: DmrvnErrorCode): asserts condition { if (!condition) throw new DmrvnError(code); }
function map(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'INVALID_INPUT');
  return value as Record<string, unknown>;
}
function str(value: unknown): string { requireValue(typeof value === 'string', 'INVALID_INPUT'); return value; }
function list(value: unknown): unknown[] { requireValue(Array.isArray(value), 'INVALID_INPUT'); return value; }
function long(value: bigint): bigint {
  if (value > 9223372036854775807n) throw new RangeError('블록 높이가 int64 범위를 벗어났습니다');
  return value;
}

/** DMRVN 읽기 계층. quantity 허용 범위는 일반 거래 조회와 다르다. */
export class DmrvnChain {
  readonly config: DmrvnConfig;
  #rpc: EvmRpc;
  constructor(config: DmrvnConfig, rpc: EvmRpc) {
    if (!(config instanceof DmrvnConfig) || !rpc || typeof rpc.call !== 'function') throw new TypeError('config와 RPC가 필요합니다');
    this.config = config;
    this.#rpc = rpc;
    Object.freeze(this);
  }
  async call(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new DmrvnError('INTERRUPTED');
    return this.#rpc.call(method, params, signal);
  }
  static quantity(value: bigint): string { return '0x' + value.toString(16); }
  static number(value: unknown): bigint {
    const input = str(value);
    requireValue(/^0x[0-9a-fA-F]+$/.test(input), 'RPC_UNAVAILABLE');
    return BigInt(input);
  }
  async head(signal?: AbortSignal): Promise<bigint> { return long(DmrvnChain.number(await this.call('eth_blockNumber', [], signal))); }
  async confirmedHead(signal?: AbortSignal): Promise<bigint> {
    const head = await this.head(signal) - BigInt(this.config.confirmations) + 1n;
    return head < 0n ? 0n : head;
  }
  async block(height: bigint, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return map(await this.call('eth_getBlockByNumber', [DmrvnChain.quantity(height), false], signal));
  }
  async timestamp(signal?: AbortSignal): Promise<bigint> {
    return long(DmrvnChain.number(map(await this.call('eth_getBlockByNumber', ['latest', false], signal)).timestamp));
  }
  async contract(abi: DmrvnAbi, address: string, fn: string, args: Readonly<Record<string, unknown>>, tag: string,
    signal?: AbortSignal): Promise<Record<string, unknown>> {
    try { return abi.decodeOutput(fn, str(await this.call('eth_call', [{ to: address, data: abi.encode(fn, args) }, tag], signal))); }
    catch (error) {
      if (error instanceof DmrvnError && error.code === 'GAS_ESTIMATION_FAILED') throw new DmrvnError('RPC_UNAVAILABLE');
      throw error;
    }
  }
  async view(fn: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown> {
    return Object.values(await this.contract(DmrvnAbi.CLAIM, this.config.claimAddress, fn, args, 'latest', signal))[0];
  }
  async nonce(address: string, forwarder: boolean, signal?: AbortSignal): Promise<bigint> {
    const abi = forwarder ? DmrvnAbi.FORWARDER : DmrvnAbi.CLAIM;
    const args = { [abi.inputs('nonces')[0]!.name]: address };
    return uint(Object.values(await this.contract(abi, forwarder ? this.config.forwarderAddress : this.config.claimAddress,
      'nonces', args, 'latest', signal))[0], 256);
  }
  async claim(id: string, block: bigint, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return map((await this.contract(DmrvnAbi.CLAIM, this.config.claimAddress, 'getClaim', { claimId: id }, DmrvnChain.quantity(block), signal))['']);
  }
  async verifyApprover(address: string, signal?: AbortSignal): Promise<void> {
    const role = await this.view('CLAIM_APPROVER_ROLE', {}, signal);
    requireValue(await this.view('hasRole', { role, account: address }, signal) === true, 'UNAUTHORIZED_SIGNER');
  }

  async receipt(hash: string, head: bigint, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    const raw = await this.call('eth_getTransactionReceipt', [hash], signal);
    if (raw === null) return null;
    const receipt = map(raw), height = long(DmrvnChain.number(receipt.blockNumber));
    if (height > head) return null;
    requireValue(str(receipt.transactionHash).toLowerCase() === hash.toLowerCase()
      && (await this.block(height, signal)).hash === receipt.blockHash, 'SUBMISSION_UNRESOLVED');
    return receipt;
  }

  event(name: string, receipt: Readonly<Record<string, unknown>>, claimId: string): Record<string, unknown> | null {
    for (const raw of list(receipt.logs)) {
      const log = map(raw);
      if (this.config.claimAddress.toLowerCase() !== String(log.address).toLowerCase()) continue;
      const topics = list(log.topics);
      if (topics.length === 0 || DmrvnAbi.CLAIM.topic(name) !== topics[0]) continue;
      const event = DmrvnAbi.CLAIM.decodeEvent(name, log);
      if (claimId.toLowerCase() === str(event.claimId).toLowerCase()) return event;
    }
    return null;
  }

  /** 최대 100001개 높이를 1000블록씩 읽고 최초로 일치한 로그의 거래를 반환한다. */
  async findTransaction(event: string, id: string, from: bigint, to: bigint, field: string, expected: string,
    signal?: AbortSignal): Promise<string | null> {
    requireValue(typeof from === 'bigint' && typeof to === 'bigint' && from >= 0n && from <= to && to - from <= 100000n,
      'REPORT_LOOKUP_RANGE');
    long(to);
    for (let start = from; start <= to; start += 1000n) {
      const end = to < start + 999n ? to : start + 999n;
      const filter = { address: this.config.claimAddress, fromBlock: DmrvnChain.quantity(start), toBlock: DmrvnChain.quantity(end),
        topics: [DmrvnAbi.CLAIM.topic(event), id] };
      for (const item of list(await this.call('eth_getLogs', [filter], signal))) {
        const log = map(item);
        requireValue(this.config.claimAddress.toLowerCase() === str(log.address).toLowerCase() && log.removed !== true, 'RPC_UNAVAILABLE');
        const decoded = DmrvnAbi.CLAIM.decodeEvent(event, log);
        if (id.toLowerCase() === str(decoded.claimId).toLowerCase() && expected === String(decoded[field])) return str(log.transactionHash);
      }
    }
    return null;
  }

  /** 코드·slot·domain을 같은 block tag로 관찰한다. 합의 최종성 증명은 아니다. */
  async verifyDeployment(height?: bigint | number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try {
      const observedHeight = height === undefined ? await this.head(signal) : chainNumber(height);
      requireValue(DmrvnChain.number(await this.call('eth_chainId', [], signal)) === BigInt(this.config.chainId), 'DEPLOYMENT_NOT_READY');
      const tag = DmrvnChain.quantity(observedHeight);
      const blockHash = bytes32(str((await this.block(observedHeight, signal)).hash));
      const deployment = this.config.deployment;
      const observed = deployment.snapshot();
      const expected = map(observed.codeHashes);
      const hashes: Record<string, unknown> = {};
      const key = deployment.isProxy() ? 'proxy' : 'contract';
      hashes[key] = await this.#verifyCode(this.config.claimAddress, expected[key], tag, 'DEPLOYMENT_NOT_READY', signal);
      hashes.forwarder = await this.#verifyCode(this.config.forwarderAddress, expected.forwarder, tag, 'DEPLOYMENT_NOT_READY', signal);
      if (deployment.isProxy()) {
        const implementation = await this.#slotAddress(IMPLEMENTATION_SLOT, tag, signal);
        const release = deployment.release(implementation);
        requireValue(release !== null, 'UNAPPROVED_IMPLEMENTATION');
        const admin = await this.#slotAddress(ADMIN_SLOT, tag, signal);
        requireValue(admin === observed.proxyAdminAddress, 'DEPLOYMENT_NOT_READY');
        hashes.proxyAdmin = await this.#verifyCode(admin, expected.proxyAdmin, tag, 'DEPLOYMENT_NOT_READY', signal);
        hashes.implementation = await this.#verifyCode(implementation, release.codeHash, tag, 'UNAPPROVED_IMPLEMENTATION', signal);
        requireValue((await this.contract(DmrvnAbi.CLAIM, this.config.claimAddress, 'contractVersion', {}, tag, signal))[''] === release.contractVersion,
          'UNAPPROVED_IMPLEMENTATION');
        requireValue((await this.contract(DmrvnAbi.PROXY_ADMIN, admin, 'owner', {}, tag, signal))[''] === observed.owner, 'DEPLOYMENT_NOT_READY');
        observed.implementationAddress = implementation;
        observed.approvedImplementationHash = release.codeHash;
        observed.contractVersion = release.contractVersion;
      }
      await this.#verifyDomain(DmrvnAbi.CLAIM, this.config.claimAddress, false, tag, signal);
      await this.#verifyDomain(DmrvnAbi.FORWARDER, this.config.forwarderAddress, true, tag, signal);
      const field = DmrvnAbi.CLAIM.inputs('isTrustedForwarder')[0]!.name;
      requireValue((await this.contract(DmrvnAbi.CLAIM, this.config.claimAddress, 'isTrustedForwarder',
        { [field]: this.config.forwarderAddress }, tag, signal))[''] === true, 'DEPLOYMENT_NOT_READY');
      // Java는 두 번째 raw hash와 첫 번째 정규화 hash를 비교한다.
      requireValue(blockHash === (await this.block(observedHeight, signal)).hash, 'DEPLOYMENT_NOT_READY');
      return { ...observed, codeHashes: hashes, verified: true, observedBlock: observedHeight, observedBlockHash: blockHash };
    } catch (error) {
      if (error instanceof DmrvnError && error.code === 'UNAPPROVED_IMPLEMENTATION') throw error;
      throw new DmrvnError('DEPLOYMENT_NOT_READY');
    }
  }
  async #slotAddress(slot: string, tag: string, signal?: AbortSignal): Promise<string> {
    const value = str(await this.call('eth_getStorageAt', [this.config.claimAddress, slot, tag], signal));
    requireValue(/^0x0{24}[0-9a-fA-F]{40}$/.test(value), 'DEPLOYMENT_NOT_READY');
    return deploymentAddress('0x' + value.slice(26));
  }
  async #verifyCode(address: string, expected: unknown, tag: string, failure: DmrvnErrorCode, signal?: AbortSignal): Promise<string> {
    const code = hexBytes(str(await this.call('eth_getCode', [address, tag], signal)));
    const hash = keccak(code);
    requireValue(code.length > 0 && hash === expected, failure);
    return hash;
  }
  async #verifyDomain(abi: DmrvnAbi, address: string, forwarder: boolean, tag: string, signal?: AbortSignal): Promise<void> {
    const actual = await this.contract(abi, address, 'eip712Domain', {}, tag, signal);
    const expected = DmrvnProtocol.domain(this.config.chainId, address, forwarder);
    for (const field of ['name', 'version', 'chainId', 'verifyingContract']) requireValue(String(expected[field]) === String(actual[field]), 'DEPLOYMENT_NOT_READY');
    requireValue(actual.fields === '0x0f' && actual.salt === ZERO_BYTES32 && Array.isArray(actual.extensions) && actual.extensions.length === 0, 'DEPLOYMENT_NOT_READY');
  }
}

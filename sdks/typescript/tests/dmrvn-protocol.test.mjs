import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DmrvnProtocol as protocol } from '../dist/index.js';

import { DmrvnAbi } from '../dist/dmrvn-abi.js';
import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';

const fixture = async name => JSON.parse(await readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const code = expected => error => { assert.equal(error.code, expected); return true; };

test('6개 encodeType/typeHash 및 Claim·Task·Observation digest가 고정 벡터와 일치한다', async () => {
  const primitive = await fixture('dmrvn-primitives.json');
  for (const [type, entry] of Object.entries(primitive.types)) {
    assert.equal(protocol.encodeType(type), entry.encodeType);
    assert.equal(protocol.typeHash(type), entry.typeHash);
  }
  const vectors = await fixture('dmrvn-protocol.json');
  for (const [type, entry] of [['ClaimRequest', vectors.claim], ['TaskAssignment', vectors.assignment], ['MrvObservation', vectors.observation]]) {
    assert.equal(protocol.digest(type, vectors.domain, entry.value), entry.digest);
    assert.equal(protocol.recover(entry.digest, entry.signature), entry.recoveredSigner.toLowerCase());
    assert.equal(protocol.digest(type, vectors.domain, { ...entry.value, ignored: 'not-hashed' }), entry.digest);
  }
  assert.equal(protocol.evidenceLocationHash(vectors.claim.value.evidenceLocation), vectors.evidenceLocationHash);
});

test('과거 PET의 Evidence·provenance·Claim·Forwarder digest/calldata를 재현한다', async () => {
  const pet = await fixture('dmrvn-pet.json');
  assert.equal(DmrvnJson.hash(pet.evidence), pet.evidenceHash);
  assert.equal(DmrvnJson.canonical(pet.evidence), pet.evidenceCanonicalJson);
  assert.equal(protocol.verifyProvenance(pet.evidence, pet.evidenceHash, pet.expectedFinalClaim.approver),
    pet.expectedFinalClaim.approver.toLowerCase());
  assert.equal(protocol.digest('ClaimRequest', pet.claimDomain, pet.claimRequest), pet.claimDigest);
  assert.equal(protocol.digest('ForwardRequest', pet.sponsored.domain, pet.sponsored.forwardRequest), pet.sponsored.digest);
  assert.equal(protocol.submitCalldata({ claimRequest: pet.claimRequest, approvalSignature: pet.approvalSignature }), pet.selfPaid.data);
  assert.equal(protocol.executeCalldata(pet.sponsored.forwardRequest, pet.sponsored.userSignature), pet.sponsored.executeCalldata);
  const decoded = DmrvnAbi.FORWARDER.decodeCall('execute', pet.sponsored.executeCalldata);
  assert.equal(Object.hasOwn(decoded.request, 'nonce'), false);
  assert.equal(decoded.request.signature, pet.sponsored.userSignature);
});

test('committee 순서를 보존하고 report signer는 정렬·중복/빈 배열을 거부한다', async () => {
  const vectors = await fixture('dmrvn-protocol.json');
  assert.equal(protocol.committeeHash(vectors.assignment.value, vectors.committee), vectors.assignment.value.committeeHash);
  assert.notEqual(protocol.committeeHash(vectors.assignment.value, [...vectors.committee].reverse()), vectors.assignment.value.committeeHash);
  const pet = await fixture('dmrvn-pet.json');
  const signers = pet.observations.map(entry => entry.signer);
  assert.equal(protocol.reportHash(pet.assignment, pet.observations[0].observation, signers, pet.claimDomain), pet.reportHash);
  assert.equal(protocol.reportHash(pet.assignment, pet.observations[0].observation, [...signers].reverse(), pet.claimDomain), pet.reportHash);
  assert.throws(() => protocol.reportHash(pet.assignment, pet.observations[0].observation, [], pet.claimDomain), code('REPORT_MISMATCH'));
  assert.throws(() => protocol.sortedAddresses([signers[0], signers[0].toLowerCase()]), code('REPORT_MISMATCH'));
});

test('domain·타입/필수 필드·uint 범위와 Evidence provenance 결속을 검사한다', async () => {
  const domain = protocol.domain(421614, '0x' + '11'.repeat(20));
  assert.deepEqual(domain, { name: 'DMRVNClaimContract', version: '7', chainId: 421614, verifyingContract: '0x' + '11'.repeat(20) });
  assert.equal(protocol.domain(421614, '0x' + '11'.repeat(20), true).version, '1');
  for (const chain of [0, -1, 9007199254740992n]) assert.throws(() => protocol.domain(chain, domain.verifyingContract), code('INVALID_INPUT'));
  assert.throws(() => protocol.structHash('unknown', {}), code('INVALID_INPUT'));
  const pet = await fixture('dmrvn-pet.json');
  assert.throws(() => protocol.structHash('ClaimRequest', { ...pet.claimRequest, deadline: '18446744073709551616' }), code('INVALID_INPUT'));
  assert.throws(() => protocol.structHash('ClaimRequest', { ...pet.claimRequest, claimId: null }), code('INVALID_INPUT'));
  assert.throws(() => protocol.verifyProvenance({ ...pet.evidence, inputs: { changed: true } }, pet.evidenceHash,
    pet.expectedFinalClaim.approver), code('SIGNATURE_INVALID'));
  assert.throws(() => protocol.verifyProvenance(pet.evidence, pet.evidenceHash, '0x' + '99'.repeat(20)), code('SIGNATURE_INVALID'));
  assert.equal(protocol.ownerHash(pet.claimRequest.beneficiary), DmrvnCrypto.textHash(pet.claimRequest.beneficiary.toLowerCase()));
});

test('typed data는 정확한 필드 배열과 domain/message snapshot을 보존한다', async () => {
  const pet = await fixture('dmrvn-pet.json');
  const message = structuredClone(pet.claimRequest);
  const typed = protocol.typedData('ClaimRequest', pet.claimDomain, message);
  assert.deepEqual(Object.keys(typed.types), ['ClaimRequest', 'EIP712Domain', 'EvidenceLocation']);
  assert.equal(typed.types.ClaimRequest[0].name, 'claimId');
  assert.equal(typed.types.ClaimRequest.at(-1).name, 'deadline');
  message.evidenceLocation.bucketName = 'changed';
  assert.equal(typed.message.evidenceLocation.bucketName, pet.claimRequest.evidenceLocation.bucketName);
  assert.equal(typed.primaryType, 'ClaimRequest');
  const decimal = protocol.typedData('MrvObservation', pet.claimDomain, { value: DmrvnJson.parse(Buffer.from('1.5')) });
  assert.equal(JSON.parse(JSON.stringify(decimal)).message.value, 1.5);
});

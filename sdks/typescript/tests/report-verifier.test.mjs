import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Wallet } from 'ethers';
import { DmrvnAbi, DmrvnCrypto as crypto, DmrvnError, DmrvnJson as json, DmrvnProtocol as protocol } from '../dist/index.js';
import { verifyReport } from '../dist/internal/report-verifier.js';
import { chainFixture } from './helpers/dmrvn-chain.mjs';

const pet = JSON.parse(await readFile(new URL('./fixtures/dmrvn-pet.json', import.meta.url), 'utf8'));
const invalid = error => error instanceof DmrvnError && error.code === 'REPORT_MISMATCH';
function fixture() {
  const config = chainFixture().config, stored = json.copy(pet.expectedFinalClaim);
  for (const field of ['partnerId', 'activityId', 'methodologyId', 'methodologyVersion']) stored[field] = pet.claimRequest[field];
  const event = { claimId: stored.claimId, taskId: pet.assignment.taskId, committeeHash: pet.assignment.committeeHash,
    status: stored.status, outputHash: stored.outputHash, reportHash: stored.reportHash };
  const tx = { to: config.claimAddress, input: pet.onReportCalldata }, report = json.copy(pet.report);
  const call = DmrvnAbi.CLAIM.decodeCall('onReport', tx.input);
  const f = { config, stored, event, tx, report, call };
  f.verify = (bytes = json.bytes(report), expected = null) => verifyReport(config, stored.claimId, stored, event, tx, bytes, expected);
  f.encode = () => { tx.input = DmrvnAbi.CLAIM.encode('onReport', call); };
  return f;
}

/** 문서의 고정 공개 시험키 1..10만 사용. 실제 지갑과 무관하다. */
const wallets = new Map(Array.from({ length: 10 }, (_, i) => {
  const wallet = new Wallet('0x' + (i + 1).toString(16).padStart(64, '0')); return [wallet.address.toLowerCase(), wallet];
}));
function recommit(f, outputs, result = 2) {
  f.report.outputs = outputs; f.report.result = result;
  f.stored.status = f.event.status = result;
  f.stored.outputHash = f.event.outputHash = f.call.observation.outputHash = result === 2 ? json.hash(outputs) : crypto.ZERO_BYTES32;
  const originalSigners = pet.observations.map(entry => entry.signer.toLowerCase());
  f.call.observation.result = result;
  const digest = protocol.digest('MrvObservation', pet.claimDomain, f.call.observation);
  f.call.observationSignatures = originalSigners.map(signer => wallets.get(signer).signingKey.sign(digest).serialized);
  f.report.observations = originalSigners.map((signer, i) => ({ signer, observation: json.copy(f.call.observation), signature: f.call.observationSignatures[i] }));
  f.stored.reportHash = f.event.reportHash = f.report.reportHash = protocol.reportHash(f.call.assignment, f.call.observation, originalSigners, pet.claimDomain);
  f.encode();
}

test('과거 PET 벡터의 정확한 calldata/quorum/output/file commitment를 검증하되 metadata 권한 보장을 확대하지 않는다', () => {
  const f = fixture(), result = f.verify();
  assert.equal(pet.offlineOnly, true); assert.equal(pet.actuallySubmitted, false);
  assert.equal(result.reportVerified, true); assert.equal(result.outputs.estimated_co2e.value, '60');
  assert.equal(result.fileHash, pet.reportFileHash); assert.equal(result.reportHash, pet.reportHash);
  assert.equal(result.fileHashVerification, 'DOWNLOAD_CHECKSUM_ONLY'); assert.equal(result.metadataIndependentlyVerified, false);
  assert.equal(result.authorizationEvidence, 'SUCCESSFUL_V7_RECEIPT'); assert.equal(result.coordinator, pet.actors.coordinator.toLowerCase());
  assert.deepEqual(result.signers, pet.observations.map(entry => entry.signer.toLowerCase()));
  assert.equal(f.verify(json.bytes(f.report), pet.reportFileHash).fileHashVerification, 'MATCHED_EXTERNAL_COMMITMENT');
});

test('metadata·추가 key·파일 공백은 core 검증과 별개지만 외부 원시 file hash commitment는 변경을 거부한다', () => {
  const f = fixture(); f.report.coefficientNotice = 'changed metadata'; f.report.untrustedExtra = { anything: true };
  f.report.source.extra = true; f.report.observations[0].observation.ignoredByEip712 = 'extra';
  const bytes = Buffer.from(JSON.stringify(f.report, null, 2) + '\n');
  const result = f.verify(bytes);
  assert.equal(result.reportVerified, true); assert.notEqual(result.fileHash, pet.reportFileHash); assert.equal(result.metadataIndependentlyVerified, false);
  assert.throws(() => f.verify(bytes, pet.reportFileHash), invalid);
  assert.equal(f.verify(bytes, crypto.keccak(bytes)).fileHashVerification, 'MATCHED_EXTERNAL_COMMITMENT');
});

test('event/Claim/assignment/observation·주소·strict calldata의 불일치를 REPORT_MISMATCH로 통일한다', () => {
  const changes = [
    f => { f.tx.to = f.config.forwarderAddress; }, f => { f.event.status = 3; },
    f => { f.event.taskId = crypto.ZERO_BYTES32; }, f => { f.event.committeeHash = crypto.ZERO_BYTES32; },
    f => { f.event.outputHash = crypto.ZERO_BYTES32; }, f => { f.event.reportHash = crypto.ZERO_BYTES32; },
    f => { f.call.assignment.claimId = crypto.ZERO_BYTES32; f.encode(); },
    f => { f.call.observation.claimId = crypto.ZERO_BYTES32; f.encode(); },
    f => { f.call.observation.taskId = crypto.ZERO_BYTES32; f.encode(); },
    f => { f.call.observation.quorumPolicyVersion = 2; f.encode(); },
    f => { f.call.observation.deadline = '1'; f.encode(); },
    f => { f.stored.evidenceLocation.objectName = 'changed'; },
    f => { f.stored.methodologyVersion = 2; },
    f => { f.tx.input += '00'; }, f => { f.tx.input = '0x'; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => f.verify(), invalid); }
  const f = fixture(); assert.throws(() => verifyReport(f.config, f.stored.claimId, f.stored, null, f.tx, json.bytes(f.report), null), invalid);
  for (const bytes of [null, Buffer.from('[]'), Buffer.from('{"a":1,"a":2}'), new Uint8Array([0xff])]) assert.throws(() => f.verify(bytes), invalid);
});

test('위원회 정렬·크기·threshold·서명 수/중복/멤버십·coordinator 서명을 검사한다', () => {
  const changes = [
    f => { f.call.committee.reverse(); }, f => { f.call.assignment.committeeSize = 4; },
    f => { f.call.assignment.threshold = 0; }, f => { f.call.assignment.threshold = 6; },
    f => { f.call.assignment.committeeHash = crypto.ZERO_BYTES32; },
    f => { f.call.observationSignatures.pop(); },
    f => { f.call.observationSignatures[1] = f.call.observationSignatures[0]; },
    f => { f.call.coordinatorSignature = '0x'; },
    f => { const digest = protocol.digest('MrvObservation', pet.claimDomain, f.call.observation);
      f.call.observationSignatures[0] = wallets.get(pet.actors.user.toLowerCase()).signingKey.sign(digest).serialized; },
  ];
  for (const change of changes) { const f = fixture(); change(f); f.encode(); assert.throws(() => f.verify(), invalid); }
});

test('calldata 서명/보고서 항목은 순서 자유이며 같은 digest/signer의 다른 유효 v 표현도 허용한다', () => {
  const f = fixture(); f.call.observationSignatures.reverse(); f.encode();
  f.report.observations.reverse(); const signature = crypto.hexBytes(f.report.observations[0].signature); signature[64] -= 27;
  f.report.observations[0].signature = crypto.hexString(signature);
  assert.equal(f.verify().reportVerified, true);
  assert.deepEqual(f.verify().signers, pet.observations.map(entry => entry.signer.toLowerCase()).reverse());
  const g = fixture(); g.report.observations[1] = json.copy(g.report.observations[0]); assert.throws(() => g.verify(), invalid);
});

test('보고서 핵심 필드·source·항목 signer/digest/길이를 대조한다', () => {
  const changes = [
    f => { f.report.outputs.estimated_co2e.value = '61'; }, f => { f.report.schemaVersion = 2; },
    f => { f.report.claimId = crypto.ZERO_BYTES32; }, f => { f.report.taskId = crypto.ZERO_BYTES32; },
    f => { f.report.reportHash = crypto.ZERO_BYTES32; }, f => { f.report.result = 3; },
    f => { f.report.source.approver = pet.actors.user; }, f => { f.report.source.evidenceLocation.objectName = 'changed'; },
    f => { f.report.source.evidenceLocationHash = crypto.ZERO_BYTES32; },
    f => { f.report.observations[0].signer = pet.actors.user; }, f => { f.report.observations[0].observation.deadline = '1'; },
    f => { f.report.observations.pop(); }, f => { f.report.observations[0].signature = '0x'; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => f.verify(), invalid); }
  const f = fixture(); f.report.schemaVersion = '1'; f.report.result = '2'; assert.equal(f.verify().reportVerified, true);
});

test('VALID 출력은 정확한 3키·정수 문자열·Java 비공백 unit·uint32 scale를 검증하고 큰 값/-0를 보존한다', () => {
  for (const output of [
    { value: '1.0', unit: 'kg', scale: 0 }, { value: '+1', unit: 'kg', scale: 0 }, { value: '01', unit: 'kg', scale: 0 },
    { value: 1, unit: 'kg', scale: 0 }, { value: '1', unit: '\u3000', scale: 0 }, { value: '1', unit: 'kg', scale: '4294967296' },
    { value: '1', unit: 'kg', scale: 0, extra: true }, { value: '1', scale: 0 },
  ]) { const f = fixture(); recommit(f, { quantity: output }); assert.throws(() => f.verify(), invalid); }
  const f = fixture(), outputs = { negativeZero: { value: '-0', unit: ' kg ', scale: '4294967295' },
    large: { value: '9'.repeat(500), unit: '\u00a0', scale: 32 } };
  recommit(f, outputs); assert.deepEqual(f.verify().outputs, json.copy(outputs));
});

test('VALID의 빈 outputs hash도 수용하고 INVALID는 빈 outputs와 zero hash로 정상 검증된다', () => {
  const f = fixture(); recommit(f, {}); assert.equal(f.verify().reportVerified, true);
  const g = fixture(); recommit(g, {}, 3); assert.equal(g.verify().reportVerified, true); assert.equal(g.verify().outputHash, crypto.ZERO_BYTES32);
  g.report.outputs = { quantity: { value: '1', unit: 'kg', scale: 0 } }; assert.throws(() => g.verify(), invalid);
});

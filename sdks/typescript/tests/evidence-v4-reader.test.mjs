import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Wallet } from 'ethers';
import { DmrvnAbi, DmrvnCrypto, DmrvnJson, DmrvnProtocol, DmrvnReader } from '../dist/index.js';
import { resolutionFixture } from './helpers/dmrvn-resolution.mjs';
import { reportFixture } from './helpers/dmrvn-report.mjs';
import { eventLog } from './helpers/dmrvn-events.mjs';
import { petV3Methodology } from './helpers/evidence-v4.mjs';

const vector = JSON.parse(await readFile(new URL('./fixtures/evidence-v4-pet-v3.json', import.meta.url), 'utf8'));
const code = expected => error => error.code === expected;
const pendingReader = f => new DmrvnReader(f.config, f.rpc,
  { async read() { assert.fail('PENDING에서 보고서 조회'); } }, { resolve() { assert.fail('PENDING에서 resolver 호출'); } });

test('독립 reader는 v4 저장 Evidence를 Claim approver/hash와 결속하고 본문 변조를 거부한다', async () => {
  const f = await resolutionFixture(false, { petV3: true }), reader = pendingReader(f);
  const state = await f.client.operation(f.operation), bytes = f.objects.get(f.objectName).bytes;
  assert.equal(await reader.verifyEvidenceProvenance(f.claimId, bytes), f.wallet.address.toLowerCase());
  const changed = { ...state.evidence, inputs: { petBottleCount: 4 } };
  await assert.rejects(reader.verifyEvidenceProvenance(f.claimId, DmrvnJson.bytes(changed)), code('SIGNATURE_INVALID'));
  // 전체 hash를 함께 바꿔도 원래 본문 서명은 새 입력을 승인하지 않는다.
  f.observed.claim.evidenceHash = DmrvnJson.hash(changed);
  await assert.rejects(reader.verifyEvidenceProvenance(f.claimId, DmrvnJson.bytes(changed)), code('SIGNATURE_INVALID'));
});

test('작업 reader의 v4 출처 검증은 접수 확인이나 nonce 예약 해제를 대신하지 않는다', async () => {
  const f = await resolutionFixture(false, { petV3: true });
  const result = await f.client.readResult(f.operation, pendingReader(f));
  assert.equal(result.provenanceVerified, true); assert.equal(result.claim.methodologyVersion, 3);
  assert.equal(result.chainStatus, 'PENDING'); assert.equal(result.reportVerified, false);
  const state = await f.client.operation(f.operation);
  assert.equal(Object.hasOwn(state, 'submissionStatus'), false);
  assert.equal((await f.journal.load(`claim-nonce:${f.config.deploymentId()}:${f.beneficiary}`)).operationId, f.operation);
});

test('합성 PET v3 INVALID 보고서는 새 Evidence hash·방법론3·재서명 quorum을 검증하고 과거 버전 변조를 거부한다', async () => {
  const f = reportFixture(), { hash } = petV3Methodology();
  const call = DmrvnAbi.CLAIM.decodeCall('onReport', f.observed.tx.input);
  const report = DmrvnJson.copy(f.pet.report);
  // 실제 validator 결과나 PET 계산값이 아니다. 과거 fixture를 수정하지 않고 새 합성 관찰을 서명한다.
  Object.assign(f.observed.stored, { methodologyVersion: 3, methodologyHash: hash, evidenceHash: vector.evidenceHash,
    status: 3, outputHash: DmrvnCrypto.ZERO_BYTES32 });
  Object.assign(call.observation, { methodologyVersion: 3, methodologyHash: hash, evidenceHash: vector.evidenceHash,
    result: 3, outputHash: DmrvnCrypto.ZERO_BYTES32 });
  const keys = Array.from({ length: 10 }, (_, i) => new Wallet('0x' + (i + 1).toString(16).padStart(64, '0')));
  const signers = f.pet.observations.map(entry => entry.signer.toLowerCase());
  const digest = DmrvnProtocol.digest('MrvObservation', f.pet.claimDomain, call.observation);
  call.observationSignatures = signers.map(signer => keys.find(key => key.address.toLowerCase() === signer).signingKey.sign(digest).serialized);
  const reportHash = DmrvnProtocol.reportHash(call.assignment, call.observation, signers, f.pet.claimDomain);
  f.observed.stored.reportHash = reportHash;
  Object.assign(report, { methodologyHash: hash, evidenceHash: vector.evidenceHash, reportHash, result: 3, outputs: {},
    observations: signers.map((signer, i) => ({ signer, signature: call.observationSignatures[i], observation: call.observation })) });
  f.observed.tx.input = DmrvnAbi.CLAIM.encode('onReport', call);
  f.observed.bytes = DmrvnJson.bytes(report);
  f.observed.receipt.logs = [eventLog(DmrvnAbi.CLAIM, 'MrvClaimReported', { claimId: f.id, taskId: call.assignment.taskId,
    committeeHash: call.assignment.committeeHash, status: 3, outputHash: DmrvnCrypto.ZERO_BYTES32, reportHash,
    reporter: f.pet.actors.coordinator }, f.target, { transactionHash: f.hash })];
  assert.equal(await f.client.verifyEvidenceProvenance(f.id, Buffer.from(vector.evidenceCanonical)), vector.signer);
  const result = await f.client.readResult(f.id, null, f.hash);
  assert.equal(result.chainStatus, 'INVALID'); assert.equal(result.reportVerified, true);
  assert.equal(result.report.evidenceHash, vector.evidenceHash);
  assert.equal(result.report.observations[0].observation.methodologyVersion, 3);
  assert.equal(result.metadataIndependentlyVerified, false);
  // 본문 서명이 아니라 onReport calldata/관찰과 저장 Claim 사이의 버전 결속 검사다.
  f.observed.stored.methodologyVersion = 1;
  const changed = await f.client.readResult(f.id, null, f.hash);
  assert.equal(changed.reportVerified, false); assert.equal(changed.reportError.code, 'REPORT_MISMATCH');
});

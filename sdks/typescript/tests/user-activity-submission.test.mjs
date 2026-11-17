import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityRequest, DeclaredMethodology, DmrvnClient, DmrvnError, PrivyApiError } from '../dist/index.js';

import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';
import { userActivityFixture } from './helpers/user-activity.mjs';

const request = (options = {}, source = 'source-event') => new ActivityRequest(' member raw ', source, { custom: ['kg', 3] },
  { confirmationTimeoutMs: 0, pollIntervalMs: 1, ...options });
const submit = (f, r = request(), signal) => f.client.submitActivity(f.wallets, r, signal);
const noSecrets = result => {
  const text = JSON.stringify(result);
  for (const key of ['approvalSignature', 'userSignature', 'sourceSignature', 'configurationFingerprint', 'submissionFingerprint', 'provider-secret']) {
    assert.ok(!text.includes(key), key);
  }
};

test('고수준 호출은 자동 ID·경로로 한 번 실행하고 timeout=0에도 접수를 한 번 확인하며 공개 사실만 반환한다', async () => {
  const f = userActivityFixture(), result = await submit(f);
  assert.equal(result.outcome, 'CONFIRMED'); assert.equal(result.lastConfirmedStage, 'SUBMISSION_CONFIRMED');
  assert.ok(!Object.hasOwn(result, 'errorCode')); assert.equal(f.facts.claimReads, 1); assert.equal(f.facts.sends, 1);
  assert.equal(f.facts.walletCalls, 1); assert.deepEqual(f.facts.member, { partnerId: 101, userId: ' member raw ' });
  const known = result.confirmed;
  assert.match(known.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(known.claimId, DmrvnCrypto.textHash(f.config.deploymentId() + ':' + known.operationId));
  assert.equal(result.requested.evidenceLocation.objectName, `partners/101/activities/1003/${known.operationId}/evidence.json`);
  assert.equal(known.chainStatus, 'PENDING'); assert.equal(known.storageStatus, 'SEALED'); assert.equal(known.txHash, f.hash);
  assert.equal(known.submissionFromBlock, 100); assert.ok(known.receipt);
  noSecrets(result);
});

test('최초 조회 미확정은 timeout=0이면 UNKNOWN이며 양의 timeout에서는 unresolved만 polling한다', async () => {
  const f = userActivityFixture(); f.facts.claimStatus = 0;
  const unknown = await submit(f); assert.equal(unknown.outcome, 'UNKNOWN'); assert.equal(unknown.errorCode, 'SUBMISSION_UNRESOLVED');
  assert.equal(unknown.lastConfirmedStage, 'SUBMISSION_BROADCAST'); assert.equal(f.facts.claimReads, 1); noSecrets(unknown);
  const g = userActivityFixture(); g.facts.confirmAfter = 2;
  const confirmed = await submit(g, request({ confirmationTimeoutMs: 1000 }));
  assert.equal(confirmed.outcome, 'CONFIRMED'); assert.equal(g.facts.claimReads, 3); assert.equal(g.facts.sends, 1);
  const h = userActivityFixture(); h.facts.claimStatus = 5;
  const invalid = await submit(h, request({ confirmationTimeoutMs: 1000 }));
  assert.equal(invalid.outcome, 'UNKNOWN'); assert.equal(invalid.errorCode, 'SUBMISSION_INPUT_CHANGED'); assert.equal(h.facts.claimReads, 1);
});

test('send 오류는 polling 없이 UNKNOWN이고 wallet 확보 오류는 공급자 코드에 따라 실패/미확정을 구분하며 메시지를 숨긴다', async () => {
  const f = userActivityFixture(); f.facts.sendError = new Error('provider-secret');
  const unknown = await submit(f); assert.equal(unknown.outcome, 'UNKNOWN'); assert.equal(unknown.lastConfirmedStage, 'BENEFICIARY_SIGNED');
  assert.equal(unknown.errorCode, 'SUBMISSION_UNRESOLVED'); assert.equal(f.facts.claimReads, 0); noSecrets(unknown);
  for (const [error, outcome, code] of [
    [new Error('provider-secret'), 'UNKNOWN', 'RPC_UNAVAILABLE'],
    [new TypeError('provider-secret'), 'FAILED', 'INVALID_INPUT'],
    [new DmrvnError('UNAUTHORIZED_SIGNER'), 'FAILED', 'UNAUTHORIZED_SIGNER'],
    [new PrivyApiError('INVALID_CREDENTIALS', 401), 'FAILED', 'UNAUTHORIZED_SIGNER'],
    [new PrivyApiError('FORBIDDEN', 403), 'FAILED', 'UNAUTHORIZED_SIGNER'],
    [new PrivyApiError('UNAVAILABLE', 503), 'UNKNOWN', 'RPC_UNAVAILABLE'],
    [new PrivyApiError('INVALID_RESPONSE', 200), 'UNKNOWN', 'RPC_UNAVAILABLE'],
    [new PrivyApiError('RATE_LIMITED', 429), 'FAILED', 'RPC_UNAVAILABLE'],
    [new PrivyApiError('INTERRUPTED', 0), 'UNKNOWN', 'INTERRUPTED'],
  ]) {
    const g = userActivityFixture(); g.wallets.getOrCreateSigner = async () => { throw error; };
    const result = await submit(g);
    assert.equal(result.outcome, outcome); assert.equal(result.errorCode, code); assert.equal(result.lastConfirmedStage, 'REQUEST_ACCEPTED');
    assert.ok(!Object.hasOwn(result.confirmed, 'beneficiary')); noSecrets(result);
  }
});

test('요청 위치 오류는 wallet 호출 전에 FAILED지만 requested에는 남고 null request/wallet은 결과 밖 오류다', async () => {
  const f = userActivityFixture();
  const result = await submit(f, request({ objectName: '../outside.json' }));
  assert.equal(result.outcome, 'FAILED'); assert.equal(result.errorCode, 'INVALID_INPUT'); assert.equal(f.facts.walletCalls, 0);
  assert.equal(result.requested.evidenceLocation.objectName, '../outside.json'); assert.ok(!Object.hasOwn(result.confirmed, 'evidenceLocation'));
  await assert.rejects(() => f.client.submitActivity(null, request()), TypeError);
  await assert.rejects(() => f.client.submitActivity(f.wallets, null), TypeError);
});

test('관찰 snapshot의 저장 전 사실을 보존하고 create intent/승인 전 실패의 UNKNOWN/FAILED를 구분한다', async () => {
  const f = userActivityFixture(), store = f.journal.store.bind(f.journal);
  f.journal.store = async (key, state) => { if (key.startsWith('operation:') && state.phase === 'EVIDENCE_SIGNED') throw new DmrvnError('JOURNAL_UNAVAILABLE');
    return store(key, state); };
  const failed = await submit(f); assert.equal(failed.outcome, 'FAILED'); assert.equal(failed.lastConfirmedStage, 'EVIDENCE_SIGNED');
  assert.ok(failed.confirmed.evidenceHash); assert.ok(!Object.hasOwn(failed.confirmed, 'evidenceLocation')); assert.equal(f.counts.creates, 0);
  const g = userActivityFixture(); g.storage.create = async () => { throw new Error('provider-secret'); };
  const uncertain = await submit(g); assert.equal(uncertain.outcome, 'UNKNOWN'); assert.equal(uncertain.lastConfirmedStage, 'EVIDENCE_SIGNED'); noSecrets(uncertain);
  const h = userActivityFixture(); h.signer.signTypedData = async () => { throw new DmrvnError('UNAUTHORIZED_SIGNER'); };
  const denied = await submit(h); assert.equal(denied.outcome, 'FAILED'); assert.equal(denied.lastConfirmedStage, 'CLAIM_APPROVED');
  assert.equal(denied.confirmed.storageStatus, 'SEALED'); assert.equal(h.facts.sends, 0);
});

test('confirmed 저장 후 예약 해제 실패는 CONFIRMED와 errorCode를 함께 반환한다', async () => {
  const f = userActivityFixture(), store = f.journal.store.bind(f.journal);
  f.journal.store = async (key, value) => { if (key.startsWith('claim-nonce:') && Object.keys(value).length === 0) throw new DmrvnError('JOURNAL_UNAVAILABLE');
    await store(key, value); };
  const result = await submit(f); assert.equal(result.outcome, 'CONFIRMED'); assert.equal(result.lastConfirmedStage, 'SUBMISSION_CONFIRMED');
  assert.equal(result.errorCode, 'JOURNAL_UNAVAILABLE'); assert.equal(result.confirmed.chainStatus, 'PENDING'); noSecrets(result);
});

test('같은 request 재호출은 새 ID이고 공유 journal 예약이 자동 재개하지 않으며 미공유 메모리는 호출마다 독립이다', async () => {
  const f = userActivityFixture(), r = request(); const first = await submit(f, r), second = await submit(f, r);
  assert.notEqual(first.confirmed.operationId, second.confirmed.operationId); assert.notEqual(first.confirmed.claimId, second.confirmed.claimId);
  assert.equal(first.outcome, 'CONFIRMED'); assert.equal(second.outcome, 'FAILED'); assert.equal(second.errorCode, 'NONCE_CONFLICT');
  assert.equal(f.facts.sends, 1);
  const g = userActivityFixture(false), one = await submit(g, r), two = await submit(g, r);
  assert.equal(one.outcome, 'CONFIRMED'); assert.equal(two.outcome, 'CONFIRMED'); assert.equal(g.facts.sends, 2);
  assert.notEqual(one.confirmed.operationId, two.confirmed.operationId);
});

test('확인 대기 중 취소는 intent를 보존한 UNKNOWN/INTERRUPTED이며 재전송하지 않는다', async () => {
  const f = userActivityFixture(), controller = new AbortController(); f.facts.claimStatus = 0;
  const call = f.rpc.call.bind(f.rpc);
  f.rpc.call = async (...args) => { const result = await call(...args); if (f.facts.claimReads > 0) controller.abort(); return result; };
  const result = await submit(f, request({ confirmationTimeoutMs: 1000, pollIntervalMs: 10 }), controller.signal);
  assert.equal(result.outcome, 'UNKNOWN'); assert.equal(result.errorCode, 'INTERRUPTED'); assert.equal(f.facts.sends, 1);
  assert.equal(result.lastConfirmedStage, 'SUBMISSION_BROADCAST');
});

test('명시 claim/path를 유지하고 Evidence 버전 미설정이면 회원 지갑 확보 전에 중단한다', async () => {
  const f = userActivityFixture(), claimId = '0x' + 'ab'.repeat(32), objectName = 'partners/101/custom.json';
  const result = await submit(f, request({ claimId, objectName }));
  assert.equal(result.confirmed.claimId, claimId); assert.equal(result.confirmed.evidenceLocation.objectName, objectName);
  const g = userActivityFixture(), wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const manifest = { activityId: 1003, methodology: { id: 2003, version: 1 }, wasmHash: DmrvnCrypto.keccak(wasm) };
  const legacy = new DeclaredMethodology(DmrvnJson.bytes(manifest), wasm, DmrvnJson.hash(manifest), () => true);
  g.client = new DmrvnClient(g.config, g.rpc, g.operator, g.storage, legacy, g.journal);
  const failed = await submit(g);
  assert.equal(failed.outcome, 'FAILED'); assert.equal(failed.errorCode, 'EVIDENCE_CONTRACT_UNCONFIGURED'); assert.equal(g.facts.walletCalls, 0);
});

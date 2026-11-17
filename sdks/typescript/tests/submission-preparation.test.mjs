import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { DmrvnError, DmrvnProtocol } from '../dist/index.js';

import { DmrvnAbi } from '../dist/dmrvn-abi.js';
import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';

const operation = 'operation-one', key = 'operation:' + operation;
const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);
async function fixture() { const f = workflowFixture(); await f.prepare(); await f.client.approveClaim(operation); return f; }
async function sign(value, wallet = new Wallet('0x' + '00'.repeat(31) + '01')) {
  const types = { ...value.types }; delete types.EIP712Domain;
  return wallet.signTypedData(value.domain, types, value.forwardRequest);
}

test('대납 준비는 Claim calldata·Forwarder nonce·signed target gas를 고정하고 별도 typed data를 반환한다', async () => {
  const f = await fixture(); f.state.forwardNonce = '9007199254740997';
  const values = await Promise.all(Array.from({ length: 16 }, () => f.client.prepareSponsored(operation, '100000')));
  const value = values[0]; for (const v of values) assert.deepEqual(v, value);
  const state = await f.client.operation(operation), forward = value.forwardRequest;
  assert.equal(state.phase, 'APPROVED'); assert.equal(state.submissionMode, 'SPONSORED');
  assert.deepEqual(forward, DmrvnJson.copy({ from: f.beneficiary, to: f.target, value: '0', gas: '100000', nonce: '9007199254740997',
    deadline: state.approved.claimRequest.deadline, data: DmrvnProtocol.submitCalldata(state.approved) }));
  assert.deepEqual(DmrvnAbi.CLAIM.decodeCall('submitClaim', forward.data).request, state.approved.claimRequest);
  assert.equal(value.primaryType, 'ForwardRequest'); assert.equal(value.domain.verifyingContract, f.forwarder);
  assert.equal(value.forwardDigest, DmrvnProtocol.digest('ForwardRequest', value.domain, forward));
  assert.equal(DmrvnProtocol.recover(value.forwardDigest, await sign(value)), f.beneficiary);
  assert.equal(f.counts.typed, 1); forward.gas = '200000';
  assert.equal((await f.client.prepareSponsored(operation, '100000')).forwardRequest.gas, '100000');
  assert.ok(!f.calls.some(c => c.method === 'eth_estimateGas' || c.method === 'eth_sendRawTransaction'));
});

test('target gas 범위·정규 십진 문자열을 검사하고 fastpath는 gas 변경 거부·배포 재확인을 유지한다', async () => {
  const f = await fixture();
  for (const gas of ['99999', '2000001', '0100000', '0x186a0', '+100000', '100000.0', 100000, null]) {
    const count = f.calls.length; await rejects(() => f.client.prepareSponsored(operation, gas), 'INVALID_INPUT'); assert.equal(f.calls.length, count);
  }
  const value = await f.client.prepareSponsored(operation, '2000000');
  await rejects(() => f.client.prepareSponsored(operation, '100000'), 'SUBMISSION_INPUT_CHANGED');
  f.state.timestamp = 100000n; f.state.claimNonce = '0'; f.state.forwardNonce = '0'; f.state.role = false;
  assert.deepEqual(await f.client.prepareSponsored(operation, '2000000'), value);
  f.state.version = 'not-approved'; await rejects(() => f.client.prepareSponsored(operation, '2000000'), 'UNAPPROVED_IMPLEMENTATION');
});

test('직접 제출은 intent를 반환 전에 저장하고 같은 calldata를 반환하며 대납 mode와 양방향 충돌한다', async () => {
  const f = await fixture();
  const tx = await f.client.prepareSelfPaid(operation), state = await f.client.operation(operation);
  assert.deepEqual(tx, { chainId: 421614, to: f.target, value: '0', data: DmrvnProtocol.submitCalldata(state.approved) });
  assert.equal(state.submissionMode, 'SELF_PAID'); assert.equal(state.submitFromBlock, 100); assert.equal(state.phase, 'BROADCAST_INTENT');
  f.state.timestamp = 100000n; f.state.role = false; f.state.claimNonce = '0';
  assert.deepEqual(await f.client.prepareSelfPaid(operation), tx);
  await rejects(() => f.client.prepareSponsored(operation, '100000'), 'SUBMISSION_INPUT_CHANGED');
  const g = await fixture(); await g.client.prepareSponsored(operation, '100000');
  await rejects(() => g.client.prepareSelfPaid(operation), 'SUBMISSION_INPUT_CHANGED');
});

test('새 제출 준비는 승인 서명·Evidence 출처·역할·체인 시각·Claim nonce를 검사하되 registry/storage를 반복하지 않는다', async () => {
  const mutations = [
    ['SIGNATURE_INVALID', async f => { const s = await f.journal.load(key); s.approved.approvalSignature = '0x12'; await f.journal.store(key, s); }],
    ['SIGNATURE_INVALID', async f => { const s = await f.journal.load(key); s.evidence.inputs = {}; await f.journal.store(key, s); }],
    ['UNAUTHORIZED_SIGNER', f => { f.state.role = false; }],
    ['REQUEST_EXPIRED', f => { f.state.timestamp = 1191n; }],
    ['NONCE_CONFLICT', f => { f.state.claimNonce = '2'; }],
  ];
  for (const method of ['prepareSelfPaid', 'prepareSponsored']) for (const [code, mutate] of mutations) {
    const f = await fixture(); await mutate(f);
    await rejects(() => f.client[method](operation, ...(method === 'prepareSponsored' ? ['100000'] : [])), code);
    assert.ok(!Object.hasOwn(await f.client.operation(operation), 'submissionMode'));
  }
  const f = await fixture(); f.status.active = false;
  f.storage.read = f.storage.head = async () => assert.fail('제출 준비에서 storage 재조회');
  await f.client.prepareSponsored(operation, '100000');
});

test('beneficiary 서명 기록은 broadcast 없이 fingerprint를 고정하고 원래 phase를 유지한다', async () => {
  const f = await fixture(), sponsored = await f.client.prepareSponsored(operation, '100000');
  const signature = await sign(sponsored);
  const recorded = await f.client.recordSponsoredSignature(operation, sponsored.forwardRequest, signature);
  assert.equal(recorded.userSignature, signature); assert.equal(recorded.forwardDigest, sponsored.forwardDigest);
  assert.deepEqual(recorded.deployment, (await f.client.operation(operation)).deployment);
  const state = await f.client.operation(operation);
  assert.equal(state.phase, 'APPROVED'); assert.ok(!Object.hasOwn(state, 'submitFromBlock'));
  assert.equal(state.submissionFingerprint, DmrvnJson.hash({ forwardRequest: sponsored.forwardRequest, userSignature: signature }));
  assert.deepEqual(await f.client.recordSponsoredSignature(operation, sponsored.forwardRequest, signature), recorded);
  recorded.forwardRequest.gas = '33'; assert.equal((await f.client.operation(operation)).forwardRequest.gas, '100000');
  // 같은 서명의 v=0/1 표현도 유효하지만 저장한 fingerprint와 다르면 교체하지 않는다.
  const bytes = DmrvnCrypto.hexBytes(signature); bytes[64] -= 27;
  const equivalent = DmrvnCrypto.hexString(bytes);
  assert.equal(DmrvnProtocol.recover(sponsored.forwardDigest, equivalent), f.beneficiary);
  await rejects(() => f.client.recordSponsoredSignature(operation, sponsored.forwardRequest, equivalent), 'SUBMISSION_INPUT_CHANGED');
});

test('서명 기록은 mode·intent·요청 일치·beneficiary·forwarder nonce를 차례로 검사한다', async () => {
  const f = await fixture();
  await rejects(() => f.client.recordSponsoredSignature(operation, {}, '0x'), 'OPERATION_NOT_PREPARED');
  const value = await f.client.prepareSponsored(operation, '100000'), sig = await sign(value);
  await rejects(() => f.client.recordSponsoredSignature(operation, { ...value.forwardRequest, gas: '100001' }, sig), 'SUBMISSION_INPUT_CHANGED');
  const wrongSignature = await sign(value, f.wallet);
  await rejects(() => f.client.recordSponsoredSignature(operation, value.forwardRequest, wrongSignature), 'SIGNATURE_INVALID');
  f.state.forwardNonce = '0';
  await rejects(() => f.client.recordSponsoredSignature(operation, value.forwardRequest, sig), 'NONCE_CONFLICT');
  f.state.forwardNonce = value.forwardRequest.nonce;
  const state = await f.journal.load(key); state.submitFromBlock = 0; await f.journal.store(key, state);
  await rejects(() => f.client.recordSponsoredSignature(operation, value.forwardRequest, sig), 'SUBMISSION_UNRESOLVED');
  assert.ok(!Object.hasOwn(await f.client.operation(operation), 'userSignature'));
});

test('서명 기록에도 현재 Claim 유효성·승인자 권한·배포 검증을 요구한다', async () => {
  const f = await fixture(), value = await f.client.prepareSponsored(operation, '100000'), signature = await sign(value);
  f.state.timestamp = 1191n; await rejects(() => f.client.recordSponsoredSignature(operation, value.forwardRequest, signature), 'REQUEST_EXPIRED');
  f.state.timestamp = 291n; f.state.role = false; await rejects(() => f.client.recordSponsoredSignature(operation, value.forwardRequest, signature), 'UNAUTHORIZED_SIGNER');
  f.state.role = true; f.state.version = 'wrong'; await rejects(() => f.client.recordSponsoredSignature(operation, value.forwardRequest, signature), 'UNAPPROVED_IMPLEMENTATION');
  assert.ok(!Object.hasOwn(await f.client.operation(operation), 'userSignature'));
});

test('직접 intent 저장 응답 유실은 intent를 지우지 않고 이후 같은 거래만 반환한다', async () => {
  const f = await fixture(), store = f.journal.store.bind(f.journal); let fail = true;
  f.journal.store = async (name, state) => { await store(name, state); if (name === key && state.submitFromBlock !== undefined && fail) { fail = false; throw new DmrvnError('JOURNAL_UNAVAILABLE'); } };
  await rejects(() => f.client.prepareSelfPaid(operation), 'JOURNAL_UNAVAILABLE');
  const saved = await f.client.operation(operation); assert.equal(saved.submissionMode, 'SELF_PAID');
  f.state.timestamp = 100000n; f.state.claimNonce = '0';
  assert.equal((await f.client.prepareSelfPaid(operation)).data, DmrvnProtocol.submitCalldata(saved.approved));
});

test('기록 입력 snapshot은 잠금 대기 중 호출자 변경과 분리한다', async () => {
  const f = await fixture(), value = await f.client.prepareSponsored(operation, '100000'), signature = await sign(value);
  let unlock, entered; const started = new Promise(resolve => { entered = resolve; });
  const held = f.journal.withLock('other', async () => { entered(); await new Promise(resolve => { unlock = resolve; }); });
  await started;
  const pending = f.client.recordSponsoredSignature(operation, value.forwardRequest, signature);
  value.forwardRequest.gas = '2000000'; unlock(); await held;
  assert.equal((await pending).forwardRequest.gas, '100000');
});

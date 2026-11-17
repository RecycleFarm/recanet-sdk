import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { DmrvnAbi, DmrvnCrypto, DmrvnError, DmrvnJson } from '../dist/index.js';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';
import { resolutionFixture } from './helpers/dmrvn-resolution.mjs';

const operation = 'operation-one', key = 'operation:' + operation;
const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);
function beneficiarySigner() {
  const wallet = new Wallet('0x' + '00'.repeat(31) + '01'), counts = { signed: 0 };
  const signer = { address: wallet.address, async signTypedData(value) { counts.signed++; const types = { ...value.types }; delete types.EIP712Domain;
    return wallet.signTypedData(value.domain, types, value.message); }, async signMessage() { assert.fail('unexpected message'); },
    async sendTransaction() { assert.fail('beneficiary는 이 조합에서 거래를 보내지 않는다'); } };
  return { signer, counts };
}
function fixture() {
  const f = workflowFixture(), b = beneficiarySigner(), status = { sends: 0, simulationError: null };
  const call = f.rpc.call.bind(f.rpc);
  f.rpc.call = async (method, params, signal) => {
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_gasPrice') return '0xa';
    if (method === 'eth_getBalance') return '0xffffffffff';
    if (method === 'eth_getTransactionCount') return '0x3';
    if (method === 'eth_call' && params[1] === 'pending') { if (status.simulationError) throw status.simulationError; return '0x'; }
    if (method === 'eth_call' && params[0].to === f.forwarder && params[0].data.startsWith(DmrvnAbi.FORWARDER.topic('verify').slice(0, 10))) {
      return f.result(DmrvnAbi.FORWARDER, 'verify', { '': true });
    }
    if (method === 'eth_call' && params[0].to === f.target && params[0].data.startsWith(DmrvnAbi.CLAIM.topic('getClaim').slice(0, 10))) {
      const s = await f.journal.load(key), request = s.approved.claimRequest;
      return f.result(DmrvnAbi.CLAIM, 'getClaim', { '': { ...request, status: 0, approver: f.wallet.address,
        evidenceLocationHash: DmrvnCrypto.ZERO_BYTES32, outputHash: DmrvnCrypto.ZERO_BYTES32, reportHash: DmrvnCrypto.ZERO_BYTES32,
        requestedAt: '0', finalizedAt: '0' } });
    }
    return call(method, params, signal);
  };
  f.operator.sendTransaction = async () => { status.sends++; return '0x' + 'cd'.repeat(32); };
  const submit = () => f.client.submitActivity(b.signer, operation, f.claimId, f.objectName, f.body, '100000');
  return { ...f, b, status, submit };
}

test('활동 조합은 Evidence→승인→beneficiary 서명→relay 전송을 순서대로 실행하고 최초 broadcast 후 polling하지 않는다', async () => {
  const f = fixture(); const result = await f.submit();
  assert.equal(result.status, 'BROADCAST'); assert.equal(result.recovered, false);
  assert.equal(f.counts.messages, 1); assert.equal(f.counts.typed, 1); assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 1);
  assert.equal(f.b.counts.signed, 1); assert.equal(f.status.sends, 1);
  const state = await f.client.operation(operation); assert.equal(state.phase, 'SUBMITTED'); assert.ok(state.userSignature);
  assert.ok(!Object.hasOwn(state, 'submissionStatus'));
  await rejects(f.submit, 'SUBMISSION_UNRESOLVED'); assert.equal(f.b.counts.signed, 1); assert.equal(f.status.sends, 1);
});

test('회원 기반 명시 활동은 기존 signer 조회에 취소 신호를 전달하고 대기 중 본문 변경과 분리한다', async () => {
  const f = fixture(), original = DmrvnJson.copy(f.body), controller = new AbortController();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const wallets = { async signerFor(userId, signal) {
    assert.equal(userId, 'member-1'); assert.equal(signal, controller.signal);
    await waiting; return f.b.signer;
  }, async getOrCreateWallet() { assert.fail('명시 활동은 회원 지갑을 생성하지 않는다'); } };
  const pending = f.client.submitActivity(wallets, 'member-1', operation, f.claimId, f.objectName, f.body, '100000', controller.signal);
  f.body.inputs.changed = true; release();
  assert.equal((await pending).status, 'BROADCAST');
  assert.deepEqual((await f.client.operation(operation)).body, original);
  assert.equal(f.b.counts.signed, 1); assert.equal(f.status.sends, 1);
});

test('회원 signer 조회의 거부·미발견은 그대로 전파하고 Evidence/relay 부작용을 시작하지 않는다', async () => {
  for (const error of [new DmrvnError('UNAUTHORIZED_SIGNER'), new DmrvnError('INTERRUPTED'), new Error('policy unavailable')]) {
    const f = fixture();
    const wallets = { async signerFor() { throw error; }, async getOrCreateWallet() { assert.fail('자동 생성'); } };
    await assert.rejects(f.client.submitActivity(wallets, 'missing', operation, f.claimId, f.objectName, f.body, '100000'),
      seen => seen === error);
    assert.equal(f.calls.length, 0); assert.equal(f.counts.creates, 0); assert.equal(f.counts.messages, 0);
    assert.equal(f.status.sends, 0); assert.equal(await f.journal.load(key), null);
  }
});

test('16개 동시 활동 호출은 서명과 전송을 한 번만 수행하고 이후 호출은 미확정 조회로 끝난다', async () => {
  const f = fixture(), values = await Promise.allSettled(Array.from({ length: 16 }, () => f.submit()));
  assert.equal(values.filter(v => v.status === 'fulfilled').length, 1);
  assert.ok(values.filter(v => v.status === 'rejected').every(v => v.reason.code === 'SUBMISSION_UNRESOLVED'));
  assert.equal(f.b.counts.signed, 1); assert.equal(f.status.sends, 1); assert.equal(f.counts.typed, 1); assert.equal(f.counts.creates, 1);
});

test('beneficiary 서명 실패는 이미 준비한 요청을 유지하고 전송 전 시뮬레이션 실패 후에는 저장 서명을 재사용한다', async () => {
  const f = fixture(), sign = f.b.signer.signTypedData;
  f.b.signer.signTypedData = async () => { throw new Error('user declined'); };
  await assert.rejects(f.submit, /user declined/);
  const before = await f.client.operation(operation); assert.ok(before.sponsored); assert.ok(!Object.hasOwn(before, 'userSignature'));
  assert.equal(f.status.sends, 0);
  f.b.signer.signTypedData = sign; f.status.simulationError = new DmrvnError('GAS_ESTIMATION_FAILED');
  await rejects(f.submit, 'GAS_ESTIMATION_FAILED'); assert.equal(f.b.counts.signed, 1);
  const saved = await f.client.operation(operation); assert.ok(saved.userSignature); assert.ok(!Object.hasOwn(saved, 'submitFromBlock'));
  f.status.simulationError = null;
  assert.equal((await f.submit()).status, 'BROADCAST');
  assert.equal(f.b.counts.signed, 1); assert.equal(f.counts.typed, 1); assert.equal(f.counts.creates, 1);
  assert.deepEqual((await f.client.operation(operation)).sponsored, before.sponsored);
});

test('저장된 intent 재개는 만료·권한 철회 후에도 새 서명 없이 원래 거래만 확인하고 gas 변경을 거부한다', async () => {
  const f = await resolutionFixture(true), b = beneficiarySigner();
  b.signer.signTypedData = async () => assert.fail('재개에서 재서명');
  f.state.timestamp = 100000n; f.state.claimNonce = '0'; f.state.forwardNonce = '0'; f.state.role = false; f.status.active = false;
  f.storage.head = f.storage.read = async () => assert.fail('재개에서 저장소 재조회');
  const result = await f.client.submitActivity(b.signer, operation, f.claimId, f.objectName, f.body, '100000');
  assert.equal(result.status, 'CONFIRMED'); assert.equal(f.counts.typed, 1);
  await rejects(() => f.client.submitActivity(b.signer, operation, f.claimId, f.objectName, f.body, '100001'), 'SUBMISSION_INPUT_CHANGED');
});

test('intent에 서명이 없으면 재서명하지 않고 직접 제출 mode에서도 대납으로 전환하지 않는다', async () => {
  const f = await resolutionFixture(true), b = beneficiarySigner(), state = await f.journal.load(key);
  delete state.userSignature; await f.journal.store(key, state);
  await rejects(() => f.client.submitActivity(b.signer, operation, f.claimId, f.objectName, f.body, '100000'), 'SUBMISSION_UNRESOLVED');
  assert.equal(b.counts.signed, 0);
  const g = await resolutionFixture(false);
  await rejects(() => g.client.submitActivity(b.signer, operation, g.claimId, g.objectName, g.body, '100000'), 'SUBMISSION_INPUT_CHANGED');
  assert.equal(b.counts.signed, 0);
});

test('잘못된 gas는 저장/외부 호출 전에 거부하고 본문 snapshot은 workflow 잠금 대기 중 변경과 분리한다', async () => {
  const f = fixture();
  await rejects(() => f.client.submitActivity(f.b.signer, operation, f.claimId, f.objectName, f.body, '99999'), 'INVALID_INPUT');
  assert.equal(f.calls.length, 0); assert.equal(await f.journal.load(key), null);
  let release, start; const entered = new Promise(resolve => { start = resolve; });
  const lock = f.journal.withLock('other', async () => { start(); await new Promise(resolve => { release = resolve; }); });
  await entered; const original = DmrvnJson.copy(f.body), pending = f.submit(); f.body.inputs.changed = true;
  release(); await lock; await pending;
  assert.deepEqual((await f.client.operation(operation)).body, original);
});

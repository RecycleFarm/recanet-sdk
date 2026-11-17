import test from 'node:test';
import assert from 'node:assert/strict';
import { DmrvnAbi, DmrvnCrypto, DmrvnError, DmrvnJson, DmrvnProtocol } from '../dist/index.js';
import { resolutionFixture } from './helpers/dmrvn-resolution.mjs';

const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);
async function fixture() {
  const f = await resolutionFixture(true), state = await f.journal.load(f.key);
  delete state.submitFromBlock; state.phase = 'APPROVED'; await f.journal.store(f.key, state);
  const relay = { verify: true, estimate: 100001n, price: 10n, balance: 1000000000000000000n,
    pendingNonce: 9007199254740999n, latestNonce: 9007199254740999n, simulationError: null, sends: 0, transactions: [], key: null };
  const call = f.rpc.call.bind(f.rpc), calls = [];
  f.rpc.call = async (method, params, signal) => {
    calls.push({ method, params: DmrvnJson.copy(params) });
    if (method === 'eth_estimateGas') return '0x' + relay.estimate.toString(16);
    if (method === 'eth_gasPrice') return '0x' + relay.price.toString(16);
    if (method === 'eth_getBalance') return '0x' + relay.balance.toString(16);
    if (method === 'eth_getTransactionCount') return '0x' + (params[1] === 'pending' ? relay.pendingNonce : relay.latestNonce).toString(16);
    if (method === 'eth_call' && params[1] === 'pending') { if (relay.simulationError) throw relay.simulationError; return '0x'; }
    if (method === 'eth_call' && params[0].to === f.forwarder && params[0].data.startsWith(DmrvnAbi.FORWARDER.topic('verify').slice(0, 10))) {
      return DmrvnAbi.encodeTuple(DmrvnAbi.FORWARDER.outputs('verify'), { '': relay.verify });
    }
    return call(method, params, signal);
  };
  f.operator.sendTransaction = async (chainId, tx, key) => {
    relay.sends++; relay.transactions.push(DmrvnJson.copy(tx)); relay.key = key;
    const saved = await f.journal.load(f.key);
    assert.equal(chainId, 421614); assert.equal(saved.phase, 'BROADCAST_INTENT'); assert.equal(saved.submitFromBlock, 100);
    assert.deepEqual(saved.relayTransaction, DmrvnJson.copy(tx)); assert.equal(saved.relayIdempotencyKey, key);
    return f.hash;
  };
  const submit = () => f.client.submitSponsored(f.operation, f.forward, f.signature);
  return { ...f, relay, relayCalls: calls, submit };
}

test('대납은 완성 거래와 intent를 먼저 저장하고 gas 130% floor·비용·nonce·시뮬레이션 후 한 번 보낸다', async () => {
  const f = await fixture(), result = await f.submit();
  assert.deepEqual(result, { operationId: f.operation, deploymentId: f.config.deploymentId(), claimId: f.claimId,
    txHash: f.hash, status: 'BROADCAST', recovered: false });
  assert.equal(f.relay.sends, 1);
  const state = await f.client.operation(f.operation), tx = f.relay.transactions[0];
  assert.deepEqual(tx, DmrvnJson.copy({ from: f.wallet.address.toLowerCase(), to: f.forwarder, value: '0x0',
    data: DmrvnProtocol.executeCalldata(f.forward, f.signature), gas: '0x1fbd1', gasPrice: '0xa', nonce: '0x20000000000007' }));
  assert.equal(state.forwardRequest.gas, '100000'); assert.equal(state.phase, 'SUBMITTED');
  assert.equal(state.txHash, f.hash); assert.equal(state.relayIdempotencyKey,
    DmrvnCrypto.textHash(f.config.deploymentId() + ':' + f.operation + ':' + state.submissionFingerprint));
  const fees = f.relayCalls.filter(c => ['eth_estimateGas', 'eth_gasPrice', 'eth_getBalance', 'eth_getTransactionCount'].includes(c.method));
  assert.deepEqual(fees.map(c => c.method), ['eth_estimateGas', 'eth_gasPrice', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getTransactionCount']);
  assert.equal(fees[2].params[1], 'pending'); assert.equal(fees[3].params[1], 'pending'); assert.equal(fees[4].params[1], 'latest');
  const simulation = f.relayCalls.find(c => c.method === 'eth_call' && c.params[1] === 'pending');
  assert.deepEqual(simulation.params[0], tx);
  assert.equal((await f.submit()).status, 'CONFIRMED'); assert.equal(f.relay.sends, 1);
});

test('동일 작업 16개 동시 전송은 최초 broadcast 하나와 원래 거래 조회만 수행한다', async () => {
  const f = await fixture(); const results = await Promise.all(Array.from({ length: 16 }, () => f.submit()));
  assert.equal(results[0].status, 'BROADCAST'); assert.ok(results.slice(1).every(v => v.status === 'CONFIRMED'));
  assert.equal(f.relay.sends, 1); assert.equal(f.relayCalls.filter(c => c.method === 'eth_estimateGas').length, 1);
  assert.equal(f.counts.typed, 1);
});

test('전송 전 forwarder verify·비용·잔액·계정 nonce·시뮬레이션 실패는 intent 없이 같은 요청 재개를 허용한다', async () => {
  const cases = [
    ['SIGNATURE_INVALID', f => { f.relay.verify = false; }],
    ['INSUFFICIENT_FUNDS', f => { f.relay.price = 1000000000000000000n; }],
    ['INSUFFICIENT_FUNDS', f => { f.relay.balance = 0n; }],
    ['NONCE_CONFLICT', f => { f.relay.latestNonce = 0n; }],
    ['GAS_ESTIMATION_FAILED', f => { f.relay.simulationError = new DmrvnError('GAS_ESTIMATION_FAILED'); }],
  ];
  for (const [code, alter] of cases) {
    const f = await fixture(); alter(f); await rejects(f.submit, code);
    assert.equal(f.relay.sends, 0); assert.ok(!Object.hasOwn(await f.client.operation(f.operation), 'submitFromBlock'));
    f.relay.verify = true; f.relay.price = 10n; f.relay.balance = 1000000000000000000n;
    f.relay.latestNonce = f.relay.pendingNonce; f.relay.simulationError = null;
    assert.equal((await f.submit()).status, 'BROADCAST');
  }
});

test('다른 작업의 relay 예약은 거래 계산 전에 거부하며 beneficiary 서명은 보존한다', async () => {
  const f = await fixture(), relayKey = `relay-nonce:421614:${f.wallet.address.toLowerCase()}`;
  await f.journal.store(relayKey, { operationId: 'another-operation' });
  await rejects(f.submit, 'NONCE_CONFLICT'); assert.equal(f.relay.sends, 0);
  assert.ok(!f.relayCalls.some(c => c.method === 'eth_estimateGas'));
  assert.equal((await f.client.operation(f.operation)).userSignature, f.signature);
  await f.journal.store(relayKey, {}); assert.equal((await f.submit()).status, 'BROADCAST');
});

test('send의 일반 오류·명백 거절 flags·잘못된 hash 모두 intent를 보존하며 다음 호출은 재전송하지 않는다', async () => {
  const callbacks = [
    async () => { throw new Error('provider credentials must not leak'); },
    async () => { throw new DmrvnError('RPC_UNAVAILABLE', { definitelyRejected: true, definitelyNotBroadcast: true }); },
    async () => 'not-a-hash', async () => null,
  ];
  for (const callback of callbacks) {
    const f = await fixture(); f.observed.claim.status = 0;
    f.operator.sendTransaction = async () => { f.relay.sends++; return callback(); };
    await rejects(f.submit, 'SUBMISSION_UNRESOLVED'); assert.equal(f.relay.sends, 1);
    const state = await f.client.operation(f.operation); assert.equal(state.phase, 'BROADCAST_INTENT'); assert.ok(state.relayTransaction);
    f.state.timestamp = 100000n; f.state.claimNonce = '0'; f.state.forwardNonce = '0'; f.state.role = false;
    await rejects(f.submit, 'SUBMISSION_UNRESOLVED'); assert.equal(f.relay.sends, 1);
    f.observed.claim.status = 1;
    assert.equal((await f.submit()).status, 'CONFIRMED'); assert.equal(f.relay.sends, 1);
  }
});

test('intent 저장 실패는 send 전에 멈추고, hash 저장 실패도 원래 intent로 복구한다', async () => {
  for (const failPhase of ['BROADCAST_INTENT', 'SUBMITTED']) {
    const f = await fixture(), store = f.journal.store.bind(f.journal); let fail = true;
    f.journal.store = async (key, value) => { await store(key, value); if (key === f.key && value.phase === failPhase && fail) {
      fail = false; throw new DmrvnError('JOURNAL_UNAVAILABLE');
    } };
    await rejects(f.submit, failPhase === 'BROADCAST_INTENT' ? 'JOURNAL_UNAVAILABLE' : 'SUBMISSION_UNRESOLVED');
    assert.equal(f.relay.sends, failPhase === 'BROADCAST_INTENT' ? 0 : 1);
    const sends = f.relay.sends;
    assert.equal((await f.submit()).status, 'CONFIRMED'); assert.equal(f.relay.sends, sends);
  }
});

test('mode/요청/fingerprint 변경은 전송과 조회 전에 거부하고 기록 없는 서명도 검증 후 고정한다', async () => {
  const f = await fixture();
  const count = f.relayCalls.length;
  await rejects(() => f.client.submitSponsored(f.operation, { ...f.forward, gas: '100001' }, f.signature), 'SUBMISSION_INPUT_CHANGED');
  const bytes = DmrvnCrypto.hexBytes(f.signature); bytes[64] -= 27;
  await rejects(() => f.client.submitSponsored(f.operation, f.forward, DmrvnCrypto.hexString(bytes)), 'SUBMISSION_INPUT_CHANGED');
  assert.equal(f.relayCalls.length, count);
  const state = await f.journal.load(f.key); delete state.submissionFingerprint; delete state.userSignature; delete state.forwardRequest;
  await f.journal.store(f.key, state);
  assert.equal((await f.submit()).status, 'BROADCAST');
  const saved = await f.client.operation(f.operation); assert.equal(saved.userSignature, f.signature); assert.ok(saved.submissionFingerprint);
});

test('send adapter에 넘긴 거래 변경은 journal의 완성 거래와 고정 요청을 바꾸지 않는다', async () => {
  const f = await fixture();
  f.operator.sendTransaction = async (_chain, tx) => { tx.gas = '0x0'; tx.data = '0x'; return f.hash; };
  await f.submit(); const saved = await f.client.operation(f.operation);
  assert.equal(saved.relayTransaction.gas, '0x1fbd1');
  assert.equal(saved.relayTransaction.data, DmrvnProtocol.executeCalldata(f.forward, f.signature));
});

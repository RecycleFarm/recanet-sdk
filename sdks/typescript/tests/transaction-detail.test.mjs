import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { DmrvnError, EvmTransactionClient, TransactionQueryError } from '../dist/index.js';



const hash = '0x' + 'AB'.repeat(32);
const blockHash = '0x' + 'CD'.repeat(32);
const from = '0x' + 'aB'.repeat(20);
const to = '0x' + 'eF'.repeat(20);
const tx = () => ({ hash, from, to, value: '0x20000000000001', nonce: '0x3', input: '0xaBcD', gas: '0x5208',
  gasPrice: '0x5', maxFeePerGas: '0x7', maxPriorityFeePerGas: '0x2', chainId: '0x66eee',
  blockNumber: '0xa', blockHash, transactionIndex: '0x0', extra: { nested: ['retained'] } });
const receipt = () => ({ transactionHash: hash, from, to, blockNumber: '0xa', blockHash, transactionIndex: '0x0',
  status: '0x1', gasUsed: '0x5208', l1Fee: '0x999', logs: [{ topics: ['original'] }] });
const code = expected => error => {
  assert.ok(error instanceof TransactionQueryError);
  assert.equal(error.code, expected);
  assert.equal(error.cause, undefined);
  assert.ok(!inspect(error).includes('provider-secret'));
  return true;
};
function fixture(overrides = {}) {
  const values = { eth_chainId: '0x66eee', eth_getTransactionByHash: tx(), eth_getTransactionReceipt: receipt(),
    eth_blockNumber: '0xc', eth_getBlockByNumber: { number: '0xa', hash: blockHash }, ...overrides };
  const calls = [];
  const client = new EvmTransactionClient(421614, { async call(method, params) {
    calls.push({ method, params });
    const value = values[method];
    if (value instanceof Error) throw value;
    return value;
  } });
  return { client, values, calls };
}

test('거래 상세는 정확한 수치·정규화 필드·원본 JSON과 확인 수를 보존한다', async () => {
  const { client, values, calls } = fixture();
  const detail = await client.getTransaction(hash);
  assert.equal(detail.chainId, 421614n);
  assert.equal(detail.hash, hash.toLowerCase());
  assert.equal(detail.from, from.toLowerCase());
  assert.equal(detail.to, to.toLowerCase());
  assert.equal(detail.valueWei, 9007199254740993n);
  assert.equal(detail.input, '0xaBcD');
  assert.equal(detail.nonce, 3n);
  assert.equal(detail.gasLimit, 21000n);
  assert.equal(detail.gasPriceWei, 5n);
  assert.equal(detail.maxFeePerGasWei, 7n);
  assert.equal(detail.maxPriorityFeePerGasWei, 2n);
  assert.equal(detail.status.state, 'SUCCEEDED');
  assert.equal(detail.status.confirmations, 3n);
  assert.equal(detail.blockNumber, 10n);
  assert.equal(detail.transactionIndex, 0);
  assert.equal(detail.transaction.hash, hash);
  assert.equal(detail.receipt.l1Fee, '0x999');
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
    'eth_blockNumber', 'eth_getBlockByNumber']);
  assert.deepEqual(calls[1].params, [hash.toLowerCase()]);
  assert.deepEqual(calls[4].params, ['0xa', false]);
  values.eth_getTransactionByHash.extra.nested[0] = 'mutated';
  values.eth_getTransactionReceipt.logs[0].topics[0] = 'mutated';
  assert.equal(detail.transaction.extra.nested[0], 'retained');
  assert.equal(detail.receipt.logs[0].topics[0], 'original');
  assert.ok(Object.isFrozen(detail) && Object.isFrozen(detail.status) && Object.isFrozen(detail.receipt.logs[0].topics));
  assert.throws(() => { detail.receipt.logs[0].topics[0] = 'not-allowed'; }, TypeError);
});

test('미발견과 pending은 receipt·head·block을 읽지 않으며 계약 생성 to=null을 보존한다', async () => {
  const missing = fixture({ eth_getTransactionByHash: null });
  assert.equal(await missing.client.getTransaction(hash), null);
  assert.equal((await missing.client.getTransactionStatus(hash)).state, 'NOT_FOUND');
  assert.ok(missing.calls.every(call => ['eth_chainId', 'eth_getTransactionByHash'].includes(call.method)));
  const pendingTx = tx();
  Object.assign(pendingTx, { to: null, blockNumber: null, blockHash: null, transactionIndex: null });
  delete pendingTx.gasPrice; delete pendingTx.maxFeePerGas; delete pendingTx.maxPriorityFeePerGas;
  const pending = fixture({ eth_getTransactionByHash: pendingTx });
  const result = await pending.client.getTransaction(hash);
  assert.equal(result.status.state, 'PENDING');
  assert.equal(result.status.confirmations, 0n);
  assert.equal(result.blockNumber, null);
  assert.equal(result.to, null);
  assert.equal(result.receipt, null);
  assert.equal(result.gasPriceWei, null);
  assert.equal(pending.calls.length, 2);
});

test('receipt 부재/status 부재는 MINED, status 0/1은 실행 결과로 구분한다', async () => {
  for (const [value, expected] of [[null, 'MINED'], [{ ...receipt(), status: null }, 'MINED'],
    [{ ...receipt(), status: undefined }, 'MINED'], [{ ...receipt(), status: '0x0' }, 'REVERTED'], [receipt(), 'SUCCEEDED']]) {
    if (value && value.status === undefined) delete value.status;
    assert.equal((await fixture({ eth_getTransactionReceipt: value }).client.getTransactionStatus(hash)).state, expected);
  }
});

test('receipt의 거래 필드 오류와 블록 결속 변경을 구분한다', async () => {
  for (const [field, value, expected] of [
    ['transactionHash', '0x' + '01'.repeat(32), 'INVALID_RESPONSE'], ['from', '0x' + '01'.repeat(20), 'INVALID_RESPONSE'],
    ['to', null, 'INVALID_RESPONSE'], ['transactionIndex', '0x1', 'INVALID_RESPONSE'], ['status', '0x2', 'INVALID_RESPONSE'],
    ['blockNumber', '0x9', 'CHAIN_CHANGED'], ['blockHash', '0x' + '01'.repeat(32), 'CHAIN_CHANGED'],
  ]) await assert.rejects(fixture({ eth_getTransactionReceipt: { ...receipt(), [field]: value } }).client.getTransaction(hash), code(expected));
});

test('quantity·input·블록 필드·chain 응답의 형식과 범위를 검사한다', async () => {
  for (const [field, value] of [['value', '0x00'], ['nonce', '0X1'], ['gas', '0x' + '1'.repeat(65)],
    ['input', '0xabc'], ['chainId', '0x1'], ['transactionIndex', '0x80000000'],
    ['blockNumber', '0x8000000000000000'], ['hash', 'wallet-id']]) {
    await assert.rejects(fixture({ eth_getTransactionByHash: { ...tx(), [field]: value } }).client.getTransaction(hash), code('INVALID_RESPONSE'));
  }
  const partial = fixture({ eth_getTransactionByHash: { ...tx(), blockNumber: null } });
  await assert.rejects(partial.client.getTransaction(hash), code('INVALID_RESPONSE'));
  assert.equal(partial.calls.length, 2);
  await assert.rejects(fixture({ eth_chainId: '0x1' }).client.getTransaction(hash), code('WRONG_CHAIN'));
  await assert.rejects(fixture({ eth_chainId: '0x00' }).client.getTransaction(hash), code('INVALID_RESPONSE'));
});

test('head 후퇴·block hash 변경은 CHAIN_CHANGED, unavailable 블록은 RPC 오류다', async () => {
  await assert.rejects(fixture({ eth_blockNumber: '0x9' }).client.getTransaction(hash), code('CHAIN_CHANGED'));
  await assert.rejects(fixture({ eth_getBlockByNumber: { number: '0xa', hash: '0x' + 'ef'.repeat(32) } })
    .client.getTransaction(hash), code('CHAIN_CHANGED'));
  await assert.rejects(fixture({ eth_getBlockByNumber: null }).client.getTransaction(hash), code('RPC_UNAVAILABLE'));
  await assert.rejects(fixture({ eth_getBlockByNumber: { number: '0x9', hash: blockHash } }).client.getTransaction(hash), code('INVALID_RESPONSE'));
  await assert.rejects(fixture({ eth_blockNumber: '0x7fffffffffffffff', eth_getTransactionByHash: { ...tx(), blockNumber: '0x0' },
    eth_getTransactionReceipt: null, eth_getBlockByNumber: { number: '0x0', hash: blockHash } }).client.getTransaction(hash), code('INVALID_RESPONSE'));
});

test('입력과 외부 RPC 오류는 조회 모델로 정리하고 부재로 바꾸지 않는다', async () => {
  const item = fixture();
  await assert.rejects(item.client.getTransaction('wallet-id'), TypeError);
  assert.equal(item.calls.length, 0);
  for (const [error, expected] of [[new DmrvnError('INVALID_INPUT'), 'INVALID_RESPONSE'],
    [new DmrvnError('GAS_ESTIMATION_FAILED'), 'RPC_UNAVAILABLE'], [new DmrvnError('INTERRUPTED'), 'INTERRUPTED'],
    [new Error('provider-secret'), 'RPC_UNAVAILABLE'],
    [new Error('provider-secret', { cause: new DOMException('cancelled', 'AbortError') }), 'INTERRUPTED']]) {
    await assert.rejects(fixture({ eth_getTransactionByHash: error }).client.getTransaction(hash), code(expected));
  }
  const cancelled = fixture();
  await assert.rejects(cancelled.client.getTransaction(hash, AbortSignal.abort()), code('INTERRUPTED'));
  assert.equal(cancelled.calls.length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EvmTransactionClient } from '../dist/index.js';
import { decodeCursor, encodeCursor, transactionRange } from '../dist/internal/transaction-cursor.js';

const address = '0x' + 'ab'.repeat(20);
const other = '0x' + 'cd'.repeat(20);
const quantity = n => '0x' + BigInt(n).toString(16);
const hash = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const blockHash = n => hash(n < 0 ? 0 : 10000 + n);
function transaction(block, index, extra = {}) {
  return { hash: hash(block * 100 + index + 1), from: address, to: other, value: '0x1', nonce: '0x0',
    input: '0x', gas: '0x5208', blockNumber: quantity(block), blockHash: blockHash(block), transactionIndex: quantity(index), ...extra };
}
const code = expected => error => { assert.equal(error.code, expected); return true; };

function chain(head = 10) {
  const blocks = new Map();
  for (let i = 0; i <= head; i++) blocks.set(i, { number: quantity(i), hash: blockHash(i), parentHash: blockHash(i - 1), transactions: [] });
  const calls = [];
  const state = { head, reorgAfterFull: false, sawFull: false };
  const rpc = { async call(method, params) {
    calls.push({ method, params });
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_blockNumber') return quantity(state.head);
    if (method === 'eth_getBlockByNumber') {
      const block = blocks.get(Number(BigInt(params[0])));
      if (!block) return null;
      if (params[1]) state.sawFull = true;
      if (!params[1] && state.reorgAfterFull && state.sawFull) return { ...block, hash: hash(9999) };
      return block;
    }
    if (method === 'eth_getTransactionReceipt') {
      const tx = [...blocks.values()].flatMap(block => block.transactions).find(tx => tx.hash === params[0]);
      assert.ok(tx, 'receipt는 체인에서 찾은 거래만 조회한다');
      return { transactionHash: tx.hash, from: tx.from, to: tx.to, blockNumber: tx.blockNumber, blockHash: tx.blockHash,
        transactionIndex: tx.transactionIndex, status: tx.revert ? '0x0' : '0x1' };
    }
    throw new Error('unexpected RPC ' + method);
  } };
  return { client: new EvmTransactionClient(1, rpc), blocks, calls, state };
}

test('Java 편의 목록 호출은 genesis/latest 범위와 cursor를 유지하고 취소를 전달한다', async () => {
  const item = chain(1);
  item.blocks.get(1).transactions = [transaction(1, 0), transaction(1, 1)];
  item.blocks.get(0).transactions = [transaction(0, 0)];
  const first = await item.client.listTransactions(address, 1);
  assert.deepEqual(first, await chainWithTransactions().client.listTransactions(address,
    { fromBlock: 0n, toBlock: null, limit: 1 }));
  const second = await item.client.listTransactions(address, 100, first.nextCursor);
  assert.deepEqual(second.transactions.map(tx => tx.blockNumber), [1n, 0n]);
  assert.equal(second.nextCursor, null);
  assert.equal(second.fromBlock, 0n);
  assert.equal(second.toBlock, 1n);
  const before = item.calls.length;
  for (const limit of [0, 101, 1.5, NaN]) await assert.rejects(item.client.listTransactions(address, limit), TypeError);
  await assert.rejects(item.client.listTransactions(address, 1, 'invalid'), TypeError);
  await assert.rejects(item.client.listTransactions(address, 1, null, AbortSignal.abort()), code('INTERRUPTED'));
  assert.equal(item.calls.length, before);
  function chainWithTransactions() {
    const expected = chain(1);
    expected.blocks.get(1).transactions = [transaction(1, 0), transaction(1, 1)];
    expected.blocks.get(0).transactions = [transaction(0, 0)];
    return expected;
  }
});

test('명세 cursor 발급 벡터 3개의 ASCII·base64url bytes가 일치한다', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/transaction-cursors.json', import.meta.url), 'utf8'));
  for (const entry of fixture.cases) {
    const query = transactionRange({ fromBlock: entry.queryFromBlock, toBlock: entry.queryToBlock, limit: 20 });
    const cursor = decodeCursor(entry.cursor, BigInt(entry.chainId), entry.walletAddress, query);
    assert.equal(cursor.snapshot, BigInt(entry.snapshot));
    assert.equal(cursor.nextBlock, BigInt(entry.nextBlock));
    assert.equal(cursor.nextIndex, entry.nextIndex);
    assert.equal(encodeCursor(cursor, BigInt(entry.chainId), entry.walletAddress, query), entry.cursor);
    assert.equal(Buffer.from(entry.cursor, 'base64url').toString('ascii'), entry.ascii);
    const parts = entry.ascii.split(':');
    parts[5] = '+' + entry.snapshot.toString().padStart(5, '0');
    parts[7] = '+' + entry.nextBlock.toString().padStart(5, '0');
    parts[8] = entry.nextIndex < 0 ? '-01' : '+' + entry.nextIndex.toString().padStart(3, '0');
    const noncanonical = Buffer.from(parts.join(':')).toString('base64url');
    const padded = noncanonical + '='.repeat((4 - noncanonical.length % 4) % 4);
    assert.deepEqual(decodeCursor(padded, BigInt(entry.chainId), entry.walletAddress, query), cursor);
  }
});

test('블록 내부 페이지는 발신자만 역순 반환하며 limit 변경·genesis 경계를 보존한다', async () => {
  const item = chain();
  item.blocks.get(10).transactions = [transaction(10, 0, { to: null, revert: true }),
    transaction(10, 1, { from: other, value: 'invalid-skipped-quantity' }), transaction(10, 2), transaction(10, 3)];
  const query = { fromBlock: 10, toBlock: 10, limit: 2 };
  const first = await item.client.listTransactions(address.toUpperCase().replace('0X', '0x'), query);
  assert.deepEqual(first.transactions.map(tx => tx.transactionIndex), [3, 2]);
  assert.equal(first.scannedBlocks, 1);
  assert.equal(first.fromBlock, 10n);
  assert.equal(first.toBlock, 10n);
  assert.ok(first.nextCursor);
  const last = await item.client.listTransactions(address, { ...query, limit: 100, cursor: first.nextCursor });
  assert.deepEqual(last.transactions.map(tx => tx.transactionIndex), [0]);
  assert.equal(last.transactions[0].to, null);
  assert.equal(last.transactions[0].status.state, 'REVERTED');
  assert.equal(last.nextCursor, null);
  assert.equal(last.scannedBlocks, 1);
  assert.equal(item.calls.filter(call => call.method === 'eth_getTransactionReceipt').length, 3);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.transactions));
  const genesis = chain(0);
  genesis.blocks.get(0).transactions = [transaction(0, 0)];
  const page = await genesis.client.listTransactions(address, { fromBlock: 0, limit: 1 });
  assert.equal(page.transactions.length, 1);
  assert.equal(page.nextCursor, null);
  assert.equal(page.scannedBlocks, 1);
});

test('latest 범위는 첫 upper를 고정하고 head가 늘어도 새 블록을 섞지 않는다', async () => {
  const item = chain(11);
  item.state.head = 10;
  item.blocks.get(10).transactions = [transaction(10, 0), transaction(10, 1)];
  item.blocks.get(11).transactions = [transaction(11, 0)];
  const query = { fromBlock: 10, limit: 1 };
  const first = await item.client.listTransactions(address, query);
  assert.equal(first.transactions[0].status.confirmations, 1n);
  item.state.head = 11;
  const second = await item.client.listTransactions(address, { ...query, cursor: first.nextCursor });
  assert.equal(second.transactions[0].blockNumber, 10n);
  assert.equal(second.transactions[0].status.confirmations, 2n);
  assert.equal(second.toBlock, 10n);
  assert.equal(second.nextCursor, null);
});

test('빈 페이지도 100개 블록 뒤 cursor를 발급하고 genesis까지 계속 탐색한다', async () => {
  const item = chain(100);
  const query = { fromBlock: 0, limit: 20 };
  const first = await item.client.listTransactions(address, query);
  assert.equal(first.transactions.length, 0);
  assert.equal(first.scannedBlocks, 100);
  assert.ok(first.nextCursor);
  assert.equal(item.calls.filter(call => call.method === 'eth_getBlockByNumber' && call.params[1]).length, 100);
  const second = await item.client.listTransactions(address, { ...query, cursor: first.nextCursor });
  assert.equal(second.transactions.length, 0);
  assert.equal(second.scannedBlocks, 1);
  assert.equal(second.nextCursor, null);
});

test('범위/cursor 불일치는 RPC 전 거부하고 head를 넘는 범위는 첫 조회에서 거부한다', async () => {
  const item = chain(10);
  item.blocks.get(10).transactions = [transaction(10, 0), transaction(10, 1)];
  const query = { fromBlock: 0, toBlock: 10, limit: 1 };
  const page = await item.client.listTransactions(address, query);
  item.calls.length = 0;
  for (const bad of [{ ...query, fromBlock: 1, cursor: page.nextCursor }, { ...query, toBlock: null, cursor: page.nextCursor },
    { ...query, cursor: 'invalid-cursor' }, { ...query, cursor: ' ' }, { ...query, cursor: 'x'.repeat(2049) },
    { ...query, limit: 0 }, { ...query, limit: 101 }, { ...query, fromBlock: -1 }]) {
    await assert.rejects(item.client.listTransactions(address, bad), TypeError);
  }
  await assert.rejects(item.client.listTransactions(other, { ...query, cursor: page.nextCursor }), TypeError);
  assert.equal(item.calls.length, 0);
  await assert.rejects(item.client.listTransactions(address, { fromBlock: 0, toBlock: 11, limit: 1 }), TypeError);
});

test('페이지 사이 reorg·head 후퇴·반환 직전 anchor 변경은 전체 페이지를 실패시킨다', async () => {
  for (const mode of ['anchor', 'head', 'final-anchor']) {
    const item = chain(10);
    item.blocks.get(10).transactions = [transaction(10, 0), transaction(10, 1)];
    const query = { fromBlock: 10, limit: 1 };
    const first = await item.client.listTransactions(address, query);
    if (mode === 'anchor') item.blocks.get(10).hash = hash(9000);
    if (mode === 'head') item.state.head = 9;
    if (mode === 'final-anchor') { item.state.sawFull = false; item.state.reorgAfterFull = true; }
    await assert.rejects(item.client.listTransactions(address, { ...query, cursor: first.nextCursor }), code('CHAIN_CHANGED'));
  }
});

test('과거 블록 부재·parent 연속성·거래 위치/index·cursor index를 검사한다', async () => {
  const missing = chain(1);
  missing.blocks.delete(0);
  await assert.rejects(missing.client.listTransactions(address, { fromBlock: 0, limit: 20 }), code('RPC_UNAVAILABLE'));
  const discontinuity = chain(1);
  discontinuity.blocks.get(1).parentHash = hash(999);
  await assert.rejects(discontinuity.client.listTransactions(address, { fromBlock: 0, limit: 20 }), code('CHAIN_CHANGED'));
  for (const extra of [{ blockNumber: '0x0' }, { transactionIndex: '0x1' }, { blockHash: hash(999) }]) {
    const item = chain(1);
    item.blocks.get(1).transactions = [transaction(1, 0, extra)];
    await assert.rejects(item.client.listTransactions(address, { fromBlock: 0, limit: 20 }), code('INVALID_RESPONSE'));
  }
  const item = chain(1);
  item.blocks.get(1).transactions = [transaction(1, 0), transaction(1, 1)];
  const first = await item.client.listTransactions(address, { fromBlock: 1, limit: 1 });
  const parts = Buffer.from(first.nextCursor, 'base64url').toString('ascii').split(':');
  parts[8] = '2';
  await assert.rejects(item.client.listTransactions(address, { fromBlock: 1, limit: 1,
    cursor: Buffer.from(parts.join(':')).toString('base64url') }), code('INVALID_RESPONSE'));
});

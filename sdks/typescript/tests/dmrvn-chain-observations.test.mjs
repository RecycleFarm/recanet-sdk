import test from 'node:test';
import assert from 'node:assert/strict';
import { DmrvnError } from '../dist/index.js';

import { DmrvnAbi } from '../dist/dmrvn-abi.js';
import { DmrvnChain } from '../dist/dmrvn-chain.js';
import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { chainFixture, address } from './helpers/dmrvn-chain.mjs';
import { eventLog } from './helpers/dmrvn-events.mjs';

const id = '0x' + 'ab'.repeat(32), hash = '0x' + 'cd'.repeat(32), blockHash = '0x' + 'ef'.repeat(32);
const otherId = '0x' + '11'.repeat(32);
const values = { claimId: id, partnerId: 101, activityId: 1003, beneficiary: address('a'), methodologyId: 2003,
  methodologyVersion: 1, methodologyHash: DmrvnCrypto.ZERO_BYTES32, evidenceHash: DmrvnCrypto.ZERO_BYTES32, nonce: '9007199254740993' };
const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);
function fixture() {
  const base = chainFixture(), calls = [], state = { receipt: null, logs: [] };
  const chain = new DmrvnChain(base.config, { async call(method, params, signal) {
    calls.push({ method, params });
    if (method === 'eth_getTransactionReceipt') return state.receipt;
    if (method === 'eth_getBlockByNumber') return { number: params[0], hash: blockHash };
    if (method === 'eth_getLogs') return typeof state.logs === 'function' ? state.logs(params[0]) : state.logs;
    return base.rpc.call(method, params, signal);
  } });
  const log = (overrides = {}, extra = {}) => eventLog(DmrvnAbi.CLAIM, 'MrvClaimRequested', { ...values, ...overrides }, base.target,
    { transactionHash: hash, ...extra });
  return { ...base, chain, calls, state, log };
}

test('receipt 부재·확인 높이 초과는 null이고 거래 hash·원시 blockHash 결속을 요구한다', async () => {
  const f = fixture(); assert.equal(await f.chain.receipt(hash, 100n), null);
  f.state.receipt = { transactionHash: hash, blockNumber: '0x65', blockHash };
  assert.equal(await f.chain.receipt(hash, 100n), null);
  assert.equal(f.calls.filter(c => c.method === 'eth_getBlockByNumber').length, 0);
  f.state.receipt.blockNumber = '0x64'; f.state.receipt.transactionHash = hash.toUpperCase();
  assert.equal(await f.chain.receipt(hash, 100n), f.state.receipt);
  f.state.receipt.transactionHash = id; await rejects(() => f.chain.receipt(hash, 100n), 'SUBMISSION_UNRESOLVED');
  f.state.receipt.transactionHash = hash; f.state.receipt.blockHash = blockHash.toUpperCase();
  await rejects(() => f.chain.receipt(hash, 100n), 'SUBMISSION_UNRESOLVED');
  f.state.receipt.blockNumber = '0x8000000000000000'; await assert.rejects(() => f.chain.receipt(hash, 100n), RangeError);
});

test('event는 Claim 주소·topic0·claimId로 고르고 다른 로그를 건너뛰며 첫 일치 event를 반환한다', () => {
  const f = fixture(), matching = f.log();
  const receipt = { logs: [f.log({}, { address: address('9'), topics: 'not read' }), f.log({}, { topics: [] }),
    f.log({}, { topics: [DmrvnCrypto.ZERO_BYTES32] }), f.log({ claimId: otherId }), matching, f.log({ nonce: '9' })] };
  const decoded = f.chain.event('MrvClaimRequested', receipt, id.toUpperCase());
  assert.equal(decoded.nonce, '9007199254740993'); assert.equal(decoded.beneficiary, values.beneficiary);
  assert.equal(f.chain.event('MrvClaimRequested', { logs: [f.log({ claimId: otherId })] }, id), null);
  assert.throws(() => f.chain.event('MrvClaimRequested', { logs: [f.log({}, { topics: [DmrvnAbi.CLAIM.topic('MrvClaimRequested')] })] }, id), DmrvnError);
});

test('로그 검색은 1000블록 창·최초 일치 nonce·종료 경계를 유지하며 큰 nonce를 정확히 비교한다', async () => {
  const f = fixture();
  f.state.logs = filter => filter.fromBlock === '0x3e8' ? [f.log({ nonce: '3' }), f.log({ claimId: otherId }), f.log(), f.log({}, { transactionHash: otherId })] : [];
  assert.equal(await f.chain.findTransaction('MrvClaimRequested', id, 0n, 2000n, 'nonce', values.nonce), hash);
  const filters = f.calls.filter(c => c.method === 'eth_getLogs').map(c => c.params[0]);
  assert.deepEqual(filters.map(f => [f.fromBlock, f.toBlock]), [['0x0', '0x3e7'], ['0x3e8', '0x7cf']]);
  assert.deepEqual(filters[0].topics, [DmrvnAbi.CLAIM.topic('MrvClaimRequested'), id]);
  f.calls.length = 0; f.state.logs = [];
  assert.equal(await f.chain.findTransaction('MrvClaimRequested', id, 0n, 2000n, 'nonce', values.nonce), null);
  assert.equal(f.calls.at(-1).params[0].toBlock, '0x7d0');
  assert.equal(f.calls.length, 3);
});

test('검색 범위 100000 차이는 허용하며 초과·역순·음수는 RPC 전에 거부한다', async () => {
  const f = fixture();
  for (const [from, to] of [[0n, 100001n], [2n, 1n], [-1n, 0n]]) {
    await rejects(() => f.chain.findTransaction('MrvClaimRequested', id, from, to, 'nonce', values.nonce), 'REPORT_LOOKUP_RANGE');
  }
  assert.equal(f.calls.length, 0);
  assert.equal(await f.chain.findTransaction('MrvClaimRequested', id, 0n, 100000n, 'nonce', values.nonce), null);
  assert.equal(f.calls.length, 101); assert.equal(f.calls.at(-1).params[0].fromBlock, '0x186a0');
});

test('검색 결과의 removed/다른 주소를 RPC 오류로 거부하고 malformed event·취소를 누락으로 바꾸지 않는다', async () => {
  const f = fixture();
  for (const extra of [{ removed: true }, { address: address('9') }]) {
    f.state.logs = [f.log({}, extra)];
    await rejects(() => f.chain.findTransaction('MrvClaimRequested', id, 1n, 1n, 'nonce', values.nonce), 'RPC_UNAVAILABLE');
  }
  f.state.logs = [f.log({}, { data: '0x' })];
  await assert.rejects(() => f.chain.findTransaction('MrvClaimRequested', id, 1n, 1n, 'nonce', values.nonce), DmrvnError);
  const controller = new AbortController(); controller.abort();
  await rejects(() => f.chain.findTransaction('MrvClaimRequested', id, 1n, 1n, 'nonce', values.nonce, controller.signal), 'INTERRUPTED');
});

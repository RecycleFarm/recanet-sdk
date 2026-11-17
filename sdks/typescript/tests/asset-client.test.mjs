import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetClient, DmrvnError } from '../dist/index.js';

const address = '0x' + 'aB'.repeat(20);
const recipient = '0x' + 'Cd'.repeat(20);
const hash = '0x' + 'aB'.repeat(32);
const code = expected => error => { assert.ok(error instanceof DmrvnError); assert.equal(error.code, expected); return true; };

function fixture(overrides = {}, send = async () => hash) {
  const calls = [];
  let sends = 0;
  const rpc = { async call(method, params) {
    calls.push({ method, params });
    const value = { eth_chainId: '0x66eee', eth_getBalance: '0x20000000000001', eth_estimateGas: '0x5208',
      eth_gasPrice: '0x5', eth_getTransactionCount: '0x3', ...overrides }[method];
    if (value instanceof Error) throw value;
    return value;
  } };
  const signer = { address, async sendTransaction(...args) { sends++; return send(...args); } };
  return { client: new AssetClient(rpc), calls, signer, sends: () => sends };
}

test('ETH 잔액과 전송은 정확한 큰 wei·주소 표기·gas/price/pending nonce를 보존한다', async () => {
  const amount = 9007199254740993n;
  const { client, calls, signer } = fixture({}, async (chain, tx, key) => {
    assert.equal(chain, 421614n);
    assert.equal(key, 'operation');
    assert.deepEqual(tx, { to: recipient, value: '0x20000000000001', data: '0x', gas: '0x5208', gasPrice: '0x5', nonce: '0x3' });
    assert.ok(Object.isFrozen(tx));
    return hash;
  });
  assert.equal(await client.getBalance(address), amount);
  assert.equal(await client.transfer(signer, recipient, amount, 'operation'), hash);
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_getBalance', 'eth_chainId',
    'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionCount']);
  assert.deepEqual(calls[1].params, [address, 'latest']);
  assert.deepEqual(calls[3].params, [{ from: address, to: recipient, value: '0x20000000000001', data: '0x' }]);
  assert.deepEqual(calls[5].params, [address, 'pending']);
  assert.equal(AssetClient.DECIMALS, 18);
  assert.equal(AssetClient.SYMBOL, 'ETH');
});

test('잘못된 주소·금액·key는 RPC 전에 거부한다', async () => {
  const { client, signer, calls } = fixture();
  for (const amount of [0n, -1n, 1n << 256n, 1, '1', null]) {
    await assert.rejects(client.transfer(signer, recipient, amount, 'operation'), TypeError);
  }
  for (const bad of ['wallet-id', '0X' + 'ab'.repeat(20), null]) await assert.rejects(client.getBalance(bad), TypeError);
  await assert.rejects(client.transfer(signer, recipient, 1n, ' '), TypeError);
  assert.equal(calls.length, 0);
});

test('체인 불일치와 잘못된 quantity는 signer 전에 실패한다', async () => {
  const wrong = fixture({ eth_chainId: '0x1' });
  await assert.rejects(wrong.client.transfer(wrong.signer, recipient, 1n, 'operation'), code('WRONG_CHAIN'));
  assert.equal(wrong.calls.length, 1);
  for (const value of ['0x00', '0X1', '-0x1', 1, '0x' + '1'.repeat(65)]) {
    const item = fixture({ eth_getBalance: value });
    await assert.rejects(item.client.getBalance(address), code('RPC_UNAVAILABLE'));
  }
  const zero = fixture({ eth_getBalance: '0x0' });
  assert.equal(await zero.client.getBalance(address), 0n);
});

test('gas/price 0도 nonce 조회까지 수행한 후 거부하고 nonce 0은 허용한다', async () => {
  for (const field of ['eth_estimateGas', 'eth_gasPrice']) {
    const item = fixture({ [field]: '0x0' });
    await assert.rejects(item.client.transfer(item.signer, recipient, 1n, 'operation'), code('RPC_UNAVAILABLE'));
    assert.deepEqual(item.calls.map(call => call.method), ['eth_chainId', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionCount']);
    assert.equal(item.sends(), 0);
  }
  const zeroNonce = fixture({ eth_getTransactionCount: '0x0' }, async (_, tx) => { assert.equal(tx.nonce, '0x0'); return hash; });
  await zeroNonce.client.transfer(zeroNonce.signer, recipient, 1n, 'operation');
});

test('signer 호출 전 오류는 보존하고 호출 후 모든 오류·잘못된 hash는 미확정으로 반환한다', async () => {
  const estimation = fixture({ eth_estimateGas: new DmrvnError('GAS_ESTIMATION_FAILED') });
  await assert.rejects(estimation.client.transfer(estimation.signer, recipient, 1n, 'operation'), code('GAS_ESTIMATION_FAILED'));
  assert.equal(estimation.sends(), 0);
  for (const error of [new DmrvnError('RPC_UNAVAILABLE'), new DmrvnError('INTERRUPTED'), new DmrvnError('UNAUTHORIZED_SIGNER')]) {
    const item = fixture({}, async () => { throw error; });
    await assert.rejects(item.client.transfer(item.signer, recipient, 1n, 'operation'), code('SUBMISSION_UNRESOLVED'));
    assert.equal(item.sends(), 1);
  }
  for (const invalid of [null, '', 'transaction-id', '0X' + 'ab'.repeat(32)]) {
    const item = fixture({}, async () => invalid);
    await assert.rejects(item.client.transfer(item.signer, recipient, 1n, 'operation'), code('SUBMISSION_UNRESOLVED'));
    assert.equal(item.sends(), 1);
  }
});

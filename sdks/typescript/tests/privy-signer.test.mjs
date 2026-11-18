import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from 'node:crypto';
import { inspect } from 'node:util';
import { BackendWalletRegistration, DmrvnError, PrivyClient } from '../dist/index.js';


import { canonicalPrivy059 } from '../dist/internal/authorization.js';

const registration = BackendWalletRegistration.generate();
const address = '0x' + '11'.repeat(20);
const transaction = { to: '0x' + '22'.repeat(20), value: '0x0', data: '0x1234',
  gas: '0x100000', gasPrice: '0x1', nonce: '0x0' };
const typed = { domain: { name: 'Test', version: '1', chainId: 421614 },
  types: { Test: [{ name: 'amount', type: 'uint256', ignored: true }] },
  primaryType: 'Test', message: { amount: '9007199254740993' } };
const makeClient = fetch => new PrivyClient({ appId: 'app', appSecret: 'secret', fetch });
const wallet = { id: 'wallet-test', address, chain_type: 'ethereum', public_key: 'different-blockchain-key' };
const code = expected => error => {
  assert.ok(error instanceof DmrvnError);
  assert.equal(error.code, expected);
  assert.equal(error.cause, undefined);
  assert.ok(!inspect(error).includes('leaked-secret'));
  return true;
};

test('승인키로 서명자를 확보하고 3개 RPC의 정확한 body·header·DER 결속을 확인한다', async () => {
  const bodies = [];
  let lists = 0;
  const client = makeClient(async (url, init) => {
    assert.ok(!url.includes('/export'));
    if (init.method === 'GET') {
      lists++;
      assert.equal(new URL(url).searchParams.get('authorization_key'), registration.publicKey);
      return Response.json({ data: [wallet] });
    }
    assert.equal(url, 'https://api.privy.io/v1/wallets/wallet-test/rpc');
    assert.equal(init.headers.authorization, 'Basic YXBwOnNlY3JldA==');
    assert.equal(init.headers['content-type'], 'application/json');
    assert.equal(init.headers['privy-request-expiry'], undefined);
    assert.ok(!init.body.includes(registration.privateKey));
    const body = JSON.parse(init.body);
    bodies.push(body);
    const headers = { 'privy-app-id': 'app' };
    if (body.method === 'eth_sendTransaction') headers['privy-idempotency-key'] = 'operation';
    else assert.equal(init.headers['privy-idempotency-key'], undefined);
    const canonical = canonicalPrivy059({ version: 1, method: 'POST', url, body, headers });
    assert.ok(verify('sha256', Buffer.from(canonical), registration.publicKey,
      Buffer.from(init.headers['privy-authorization-signature'], 'base64')));
    return Response.json({ method: body.method,
      data: body.method === 'eth_sendTransaction' ? { hash: 'unvalidated-hash' } : { signature: 'unvalidated-signature', encoding: 'hex' } });
  });
  const signer = await client.signerForWallet('wallet-test', registration);
  assert.equal(signer.address, address);
  assert.ok(Object.isFrozen(signer));
  assert.equal(await signer.signMessage('0x1234'), 'unvalidated-signature');
  assert.equal(await signer.signTypedData(typed), 'unvalidated-signature');
  assert.equal(await signer.sendTransaction(421614, { ...transaction, from: 'wrong', type: '0x2', maxFeePerGas: '0x999' }, 'operation'), 'unvalidated-hash');
  assert.equal(lists, 1);
  assert.deepEqual(bodies, [
    { method: 'personal_sign', params: { message: '0x1234', encoding: 'utf-8' } },
    { method: 'eth_signTypedData_v4', chain_type: 'ethereum', params: { typed_data: {
      domain: typed.domain, types: { Test: [{ name: 'amount', type: 'uint256' }] }, primary_type: 'Test', message: typed.message,
    } } },
    { method: 'eth_sendTransaction', chain_type: 'ethereum', caip2: 'eip155:421614', params: { transaction: {
      from: address, to: transaction.to, chain_id: '0x66eee', value: '0x0', data: '0x1234',
      gas_limit: '0x100000', gas_price: '0x1', nonce: '0x0',
    } } },
  ]);
});

test('승인키 목록에 없거나 ethereum이 아니면 서명 요청 전에 거부한다', async () => {
  for (const wallets of [[], [{ ...wallet, id: 'other' }], [{ ...wallet, chain_type: 'solana' }]]) {
    let calls = 0;
    const client = makeClient(async (_, init) => { calls++; assert.equal(init.method, 'GET'); return Response.json({ data: wallets }); });
    await assert.rejects(client.signerForWallet('wallet-test', registration), code('UNAUTHORIZED_SIGNER'));
    assert.equal(calls, 1);
  }
  const denied = makeClient(async () => new Response('leaked-secret', { status: 403 }));
  await assert.rejects(denied.signerForWallet('wallet-test', registration), code('RPC_UNAVAILABLE'));
});

test('호출의 401/403·503·응답 유형 오류·취소를 구분하고 재시도하지 않는다', async () => {
  for (const [status, expected] of [[401, 'UNAUTHORIZED_SIGNER'], [403, 'UNAUTHORIZED_SIGNER'], [503, 'RPC_UNAVAILABLE'],
    [200, 'RPC_UNAVAILABLE'], ['network', 'RPC_UNAVAILABLE'], ['cancel', 'INTERRUPTED']]) {
    let calls = 0;
    const client = makeClient(async (_, init) => {
      if (init.method === 'GET') return Response.json({ data: [wallet] });
      calls++;
      if (status === 'network') throw new Error('leaked-secret');
      if (status === 'cancel') return new Promise(() => {});
      return new Response(status === 200 ? '{"method":"wrong","data":{"signature":"value","encoding":"hex"}}' : 'leaked-secret', { status });
    });
    const signer = await client.signerForWallet('wallet-test', registration);
    const controller = new AbortController();
    const pending = signer.signMessage('test', controller.signal);
    if (status === 'cancel') controller.abort('leaked-secret');
    await assert.rejects(pending, code(expected));
    assert.equal(calls, 1);
  }
});

test('전송은 null 선택 필드를 생략하고 Quantity 문법을 추가 검사하지 않는다', async () => {
  const bodies = [];
  const client = makeClient(async (_, init) => {
    if (init.method === 'GET') return Response.json({ data: [wallet] });
    bodies.push(JSON.parse(init.body));
    assert.equal(init.headers['privy-idempotency-key'], undefined);
    return Response.json({ method: 'eth_sendTransaction', data: { hash: 'result' } });
  });
  const signer = await client.signerForWallet('wallet-test', registration);
  await signer.sendTransaction(9223372036854775807n, { ...transaction, to: null, data: null, value: 'not-hex' });
  const body = bodies[0];
  assert.equal(body.caip2, 'eip155:9223372036854775807');
  assert.equal(body.params.transaction.chain_id, '0x7fffffffffffffff');
  assert.equal(body.params.transaction.value, 'not-hex');
  assert.equal(Object.hasOwn(body.params.transaction, 'to'), false);
  assert.equal(Object.hasOwn(body.params.transaction, 'data'), false);
});

test('typed data는 대기 중 호출자 변경과 분리하고 필드 배열 순서를 보존한다', async () => {
  let resolveResponse;
  let captured;
  const client = makeClient(async (_, init) => {
    if (init.method === 'GET') return Response.json({ data: [wallet] });
    captured = JSON.parse(init.body);
    return new Promise(resolve => { resolveResponse = resolve; });
  });
  const signer = await client.signerForWallet('wallet-test', registration);
  const input = structuredClone(typed);
  input.types.Test.push({ name: 'second', type: 'string' });
  const pending = signer.signTypedData(input);
  input.message.amount = 'changed';
  input.types.Test.reverse();
  resolveResponse(Response.json({ method: 'eth_signTypedData_v4', data: { signature: 'result', encoding: 'hex' } }));
  assert.equal(await pending, 'result');
  assert.equal(captured.params.typed_data.message.amount, '9007199254740993');
  assert.deepEqual(captured.params.typed_data.types.Test.map(field => field.name), ['amount', 'second']);
});

test('Java처럼 원래 idempotency key를 승인 payload에 결속한다', async () => {
  const client = makeClient(async (url, init) => {
    if (init.method === 'GET') return Response.json({ data: [wallet] });
    const request = new Request(url, init);
    const wireKey = request.headers.get('privy-idempotency-key');
    assert.equal(wireKey, 'operation');
    const payload = { version: 1, method: 'POST', url,
      body: JSON.parse(await request.text()), headers: { 'privy-app-id': 'app', 'privy-idempotency-key': ' operation \t' } };
    assert.ok(verify('sha256', Buffer.from(canonicalPrivy059(payload)), registration.publicKey,
      Buffer.from(request.headers.get('privy-authorization-signature'), 'base64')));
    return Response.json({ method: 'eth_sendTransaction', data: { hash: 'result' } });
  });
  const signer = await client.signerForWallet('wallet-test', registration);
  assert.equal(await signer.sendTransaction(421614, transaction, ' operation \t'), 'result');
});

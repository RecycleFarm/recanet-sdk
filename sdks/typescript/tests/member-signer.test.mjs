import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackendWalletRegistration, DmrvnError, PrivyClient } from '../dist/index.js';

import { memberExternalId } from '../dist/member-identity.js';

const registration = BackendWalletRegistration.generate();
const transaction = { to: 'recipient', value: '0x0', gas: '0x1', gasPrice: '0x1', nonce: '0x0' };
const typed = { domain: { name: 'Test' }, types: { Test: [{ name: 'amount', type: 'uint256' }] },
  primaryType: 'Test', message: { amount: '9007199254740993' } };

function fixture() {
  const wallets = new Map();
  const calls = [];
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, method: init.method, body: init.body && JSON.parse(init.body) });
    if (init.method === 'GET') {
      const external = parsed.searchParams.get('external_id');
      return Response.json({ data: external ? [wallets.get(external)].filter(Boolean) : [...wallets.values()] });
    }
    const body = JSON.parse(init.body);
    if (parsed.pathname === '/v1/wallets') {
      const wallet = { external_id: body.external_id, id: 'wallet-' + wallets.size,
        address: '0x' + '11'.repeat(20), chain_type: 'ethereum' };
      wallets.set(body.external_id, wallet);
      return Response.json(wallet);
    }
    return Response.json({ method: body.method,
      data: body.method === 'eth_sendTransaction' ? { hash: 'result-hash' } : { signature: 'result-signature', encoding: 'hex' } });
  } });
  return { client, wallets, calls };
}
const denied = error => { assert.ok(error instanceof DmrvnError); assert.equal(error.code, 'UNAUTHORIZED_SIGNER'); return true; };

test('회원 서명은 매번 회원 및 승인키 목록을 확인하고 지갑을 자동 생성하지 않는다', async () => {
  const { client, calls } = fixture();
  const members = client.userWallets(registration, 'service');
  await assert.rejects(members.signerFor('member'), { name: 'IllegalStateException' });
  assert.equal(calls.length, 1);
  assert.ok(calls.every(call => call.method === 'GET'));
  const wallet = await members.getOrCreateWallet('member');
  calls.length = 0;
  assert.equal(await members.signMessage('member', ''), 'result-signature');
  assert.equal(await members.signTypedData('member', typed), 'result-signature');
  assert.equal(await members.sendTransaction('member', 421614, transaction, 'operation'), 'result-hash');
  assert.equal(calls.length, 9);
  for (let i = 0; i < calls.length; i += 3) {
    assert.equal(calls[i].url.searchParams.get('external_id'), memberExternalId('service', 'member'));
    assert.equal(calls[i + 1].url.searchParams.has('external_id'), false);
    assert.equal(calls[i + 2].url.pathname, `/v1/wallets/${wallet.id}/rpc`);
  }
});

test('회원 전송의 chain·key·non-null 입력 검사는 조회 전에 수행한다', async () => {
  const { client, calls } = fixture();
  const members = client.userWallets(registration, 'service');
  for (const chain of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1n << 63n]) {
    await assert.rejects(members.sendTransaction('member', chain, transaction, 'operation'), TypeError);
  }
  await assert.rejects(members.sendTransaction('member', 1, transaction, ' '), TypeError);
  await assert.rejects(members.sendTransaction('member', 1, null, 'operation'), TypeError);
  await assert.rejects(members.signMessage('member', null), TypeError);
  await assert.rejects(members.signTypedData('member', null), TypeError);
  assert.equal(calls.length, 0);
});

test('파트너 불일치·권한 거부는 Privy 호출 전에 실패하고 callback 오류는 그대로 전파한다', async () => {
  const { client, calls } = fixture();
  let authorizations = 0;
  const members = client.userWallets(registration, 'service');
  const beneficiaries = members.forPartner(101, () => { authorizations++; return false; });
  await assert.rejects(beneficiaries.getOrCreateSigner(102, 'member'), denied);
  assert.equal(authorizations, 0);
  await assert.rejects(beneficiaries.getOrCreateSigner(101, 'member'), denied);
  assert.equal(authorizations, 1);
  const policyError = new Error('policy-specific-error');
  const failure = members.forPartner(101, async () => { throw policyError; });
  await assert.rejects(failure.getOrCreateSigner(101, 'member'), error => error === policyError);
  for (const partner of [0, -1, 1.5, 4294967296]) assert.throws(() => members.forPartner(partner, () => true), TypeError);
  assert.equal(calls.length, 0);
});

test('파트너 식별자는 일반 회원 지갑과 분리하고 signer 확보 후 철회를 매 호출에 적용한다', async () => {
  const { client, calls, wallets } = fixture();
  let allowed = true;
  let authorizations = 0;
  const members = client.userWallets(registration, 'service');
  await members.getOrCreateWallet('member');
  const beneficiaries = members.forPartner(101, async (partner, user) => {
    assert.equal(partner, 101); assert.equal(user, 'member'); authorizations++; return allowed;
  });
  const signer = await beneficiaries.getOrCreateSigner(101, 'member');
  assert.equal(wallets.size, 2);
  assert.ok(wallets.has(memberExternalId('service', 'member', 101)));
  assert.equal(authorizations, 1);
  calls.length = 0;
  assert.equal(await signer.signMessage('test'), 'result-signature');
  assert.equal(await signer.signTypedData(typed), 'result-signature');
  assert.equal(await signer.sendTransaction(421614, transaction, 'operation'), 'result-hash');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url.pathname === '/v1/wallets/wallet-1/rpc'));
  const authBeforeAddress = authorizations;
  assert.equal(signer.address, '0x' + '11'.repeat(20));
  assert.equal(authorizations, authBeforeAddress);
  allowed = false;
  calls.length = 0;
  await assert.rejects(signer.signMessage('test'), denied);
  await assert.rejects(signer.signTypedData(typed), denied);
  await assert.rejects(signer.sendTransaction(421614, transaction, 'operation'), denied);
  assert.equal(calls.length, 0);
  assert.equal(authorizations, 7);
});

test('파트너 권한 확인 후 Java와 같은 시점에 typed/transaction 값을 읽는다', async () => {
  const { client, calls } = fixture();
  let resolveAuthorization;
  let delayed = false;
  const beneficiaries = client.userWallets(registration, 'service').forPartner(101,
    () => delayed ? new Promise(resolve => { resolveAuthorization = resolve; }) : true);
  const signer = await beneficiaries.getOrCreateSigner(101, 'member');
  calls.length = 0;
  delayed = true;
  const input = structuredClone(typed);
  const pending = signer.signTypedData(input);
  input.message.amount = 'changed';
  resolveAuthorization(true);
  await pending;
  assert.equal(calls[0].body.params.typed_data.message.amount, 'changed');
  const tx = { ...transaction };
  const send = signer.sendTransaction(421614, tx, 'operation');
  tx.value = 'changed';
  resolveAuthorization(true);
  await send;
  assert.equal(calls[1].body.params.transaction.value, 'changed');
});

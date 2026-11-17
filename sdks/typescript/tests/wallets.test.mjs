import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { inspect } from 'node:util';
import { PrivyClient, BackendWalletRegistration, memberExternalId } from '../dist/index.js';

const registration = new BackendWalletRegistration('public +/=\nkey', 'private-never-send');
const createClient = fetch => new PrivyClient({ appId: 'app', appSecret: 'secret', fetch });
const wallet = (extra = {}) => ({ id: 'wallet-id', address: 'OriginalAddress', chain_type: 'ethereum', ...extra });
const memberWallet = (extra = {}) => wallet({ external_id: memberExternalId('service', 'member'), ...extra });
const errorIs = (code, status = 0) => error => {
  assert.equal(error.code, code);
  assert.equal(error.statusCode, status);
  return true;
};

test('P-256 승인키는 SPKI/PKCS8 PEM이며 일반 표현에 개인키를 노출하지 않는다', () => {
  const pair = BackendWalletRegistration.generate();
  const publicKey = createPublicKey(pair.publicKey);
  const privateKey = createPrivateKey(pair.privateKey);
  assert.equal(publicKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
  assert.equal(privateKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
  const data = Buffer.from('local-key-pair-test');
  assert.ok(verify('sha256', data, publicKey, sign('sha256', data, privateKey)));
  for (const [pem, name] of [[pair.publicKey, 'PUBLIC KEY'], [pair.privateKey, 'PRIVATE KEY']]) {
    const lines = pem.split('\n');
    assert.equal(lines[0], `-----BEGIN ${name}-----`);
    assert.equal(lines.at(-1), `-----END ${name}-----`);
    for (const line of lines.slice(1, -2)) assert.equal(line.length, 64);
    assert.ok(!pem.endsWith('\n'));
  }
  assert.ok(!inspect(pair).includes(pair.privateKey));
  assert.ok(!String(pair).includes(pair.privateKey));
  assert.ok(!JSON.stringify(pair).includes(pair.privateKey));
  assert.ok(Object.isFrozen(pair));
  assert.doesNotThrow(() => new BackendWalletRegistration('not-a-key', 'not-a-key'));
  assert.throws(() => new BackendWalletRegistration(' ', 'private'), TypeError);
  assert.throws(() => new BackendWalletRegistration('public', ''), TypeError);
});

test('지갑 등록 body에 공개키만 포함하고 blank 선택 필드는 생략한다', async () => {
  let calls = 0;
  const client = createClient(async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.privy.io/v1/wallets');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'application/json');
    assert.ok(!init.body.includes(registration.privateKey));
    assert.deepEqual(JSON.parse(init.body), { chain_type: 'ethereum', owner: { public_key: registration.publicKey } });
    return Response.json(wallet());
  });
  const result = await client.registerBackendWallet(registration, { chainType: 'ethereum', displayName: ' \t', externalId: null });
  assert.deepEqual(result, { id: 'wallet-id', address: 'OriginalAddress', publicKey: null, chainType: 'ethereum' });
  assert.ok(Object.isFrozen(result));
  await assert.rejects(client.registerBackendWallet(registration, { chainType: 'Ethereum' }), TypeError);
  assert.equal(calls, 1);
});

test('등록 시 메타데이터를 그대로 전달하고 chain/주소/publicKey를 추가 정규화하지 않는다', async () => {
  const client = createClient(async (_, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.display_name, ' keep spaces ');
    assert.equal(body.external_id, 'unvalidated external id');
    return Response.json(wallet({ chain_type: 'solana', public_key: 'blockchain-key' }));
  });
  const result = await client.registerBackendWallet(registration,
    { chainType: 'solana', displayName: ' keep spaces ', externalId: 'unvalidated external id' });
  assert.equal(result.chainType, 'solana');
  assert.equal(result.publicKey, 'blockchain-key');
  const invalid = createClient(async () => Response.json({}));
  await assert.rejects(invalid.registerBackendWallet(registration, { chainType: 'ethereum' }), errorIs('INVALID_RESPONSE', 200));
});

test('회원 조회는 빈 페이지를 넘어 끝까지 확인하고 query를 정확히 인코딩한다', async () => {
  let calls = 0;
  const client = createClient(async (url, init) => {
    const query = new URL(url).searchParams;
    assert.equal(query.get('authorization_key'), registration.publicKey);
    assert.equal(query.get('external_id'), memberExternalId('service', 'member'));
    assert.equal(query.get('include_archived'), 'false');
    assert.equal(query.get('limit'), '100');
    assert.ok(!url.includes(registration.privateKey));
    assert.equal(init.method, 'GET');
    calls++;
    if (calls === 1) { assert.equal(query.has('cursor'), false); return Response.json({ data: [], next_cursor: 'a+/' }); }
    if (calls === 2) { assert.equal(query.get('cursor'), 'a+/'); return Response.json({ data: [memberWallet()], next_cursor: 'end' }); }
    assert.equal(query.get('cursor'), 'end');
    return Response.json({ data: [], next_cursor: ' ' });
  });
  const result = await client.userWallets(registration, 'service').findWallet('member');
  assert.equal(calls, 3);
  assert.deepEqual(result, { userId: 'member', id: 'wallet-id', address: 'OriginalAddress', chainType: 'ethereum' });
  assert.ok(Object.isFrozen(result));
});

test('회원 조회의 중복 지갑·다른 연결·다른 체인·반복 cursor·잘못된 구조를 거부한다', async () => {
  for (const pages of [
    [{ data: [memberWallet(), memberWallet()] }],
    [{ data: [memberWallet()], next_cursor: 'next' }, { data: [memberWallet()] }],
    [{ data: [memberWallet({ external_id: 'another-member' })] }],
    [{ data: [memberWallet({ chain_type: 'solana' })] }],
    [{ data: [], next_cursor: 'same' }, { data: [], next_cursor: 'same' }],
    [{ data: null }], [{ data: [], next_cursor: 42 }],
  ]) {
    let calls = 0;
    const client = createClient(async () => Response.json(pages[calls++]));
    await assert.rejects(client.userWallets(registration, 'service').findWallet('member'), errorIs('INVALID_RESPONSE'));
    assert.equal(calls, pages.length);
  }
});

test('기존 회원 지갑은 생성하지 않고 없는 회원만 한 번 생성한다', async () => {
  let exists = false;
  let creates = 0;
  const client = createClient(async (_, init) => {
    if (init.method === 'GET') return Response.json({ data: exists ? [memberWallet()] : [] });
    creates++;
    exists = true;
    assert.deepEqual(JSON.parse(init.body), { chain_type: 'ethereum', owner: { public_key: registration.publicKey },
      external_id: memberExternalId('service', 'member') });
    // 생성 응답 external_id는 추가 비교하지 않는다.
    return Response.json(memberWallet({ external_id: 'not-rechecked' }));
  });
  const members = client.userWallets(registration, 'service');
  assert.equal(await members.findWallet('member'), null);
  assert.equal((await members.getOrCreateWallet('member')).userId, 'member');
  await members.getOrCreateWallet('member');
  assert.equal(creates, 1);
});

test('409 경쟁 생성은 전체 재조회 한 번으로 복구하고 실패는 재생성하지 않는다', async () => {
  for (const found of [true, false, 'query-error']) {
    let reads = 0;
    let creates = 0;
    const client = createClient(async (_, init) => {
      if (init.method === 'POST') { creates++; return new Response('leaked-secret', { status: 409 }); }
      reads++;
      if (reads > 1 && found === 'query-error') return new Response('', { status: 503 });
      return Response.json({ data: reads > 1 && found ? [memberWallet()] : [] });
    });
    const pending = client.userWallets(registration, 'service').getOrCreateWallet('member');
    if (found === true) assert.equal((await pending).id, 'wallet-id');
    else await assert.rejects(pending, errorIs(found ? 'UNAVAILABLE' : 'INVALID_RESPONSE', found ? 503 : 409));
    assert.equal(creates, 1);
    assert.equal(reads, 2);
  }
});

test('503·전송 응답 유실은 조회 부재로 바꾸거나 생성 재시도하지 않는다', async () => {
  for (const failAt of ['lookup', 'create', 'network']) {
    let reads = 0;
    let creates = 0;
    const client = createClient(async (_, init) => {
      if (init.method === 'GET') {
        reads++;
        return failAt === 'lookup' ? new Response('', { status: 503 }) : Response.json({ data: [] });
      }
      creates++;
      if (failAt === 'network') throw new Error('leaked-secret');
      return new Response('', { status: 503 });
    });
    await assert.rejects(client.userWallets(registration, 'service').getOrCreateWallet('member'),
      errorIs('UNAVAILABLE', failAt === 'network' ? 0 : 503));
    assert.equal(reads, 1);
    assert.equal(creates, failAt === 'lookup' ? 0 : 1);
  }
});

test('운영 지갑 목록은 모든 페이지를 누적하고 legacy 소유권 비교를 분리한다', async () => {
  let calls = 0;
  const client = createClient(async url => {
    const parsed = new URL(url);
    if (parsed.pathname !== '/v1/wallets') return Response.json(wallet({ public_key: 'blockchain-key' }));
    assert.equal(parsed.searchParams.has('external_id'), false);
    assert.equal(parsed.searchParams.has('include_archived'), false);
    calls++;
    return Response.json({ data: [wallet({ chain_type: 'solana' })], next_cursor: calls === 1 ? 'next' : null });
  });
  const result = await client.listBackendWallets(registration.publicKey);
  assert.equal(result.length, 2);
  assert.ok(Object.isFrozen(result));
  assert.equal(await client.isBackendWallet('wallet/id', registration), false);
  const matching = createClient(async url => {
    assert.ok(url.endsWith('/wallet%2Fid'));
    return Response.json(wallet({ public_key: registration.publicKey }));
  });
  assert.equal(await matching.isBackendWallet('wallet/id', registration), true);
});

test('잘못된 회원·namespace는 외부 요청 전에 거부한다', async () => {
  let calls = 0;
  const client = createClient(async () => { calls++; return Response.json({ data: [] }); });
  assert.throws(() => client.userWallets(registration, 'bad namespace'), TypeError);
  await assert.rejects(client.userWallets(registration, 'service').findWallet(' '), TypeError);
  await assert.rejects(client.userWallets(registration, 'service').getOrCreateWallet(null), TypeError);
  assert.equal(calls, 0);
});

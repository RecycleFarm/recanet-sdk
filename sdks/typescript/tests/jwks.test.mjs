import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { PrivyTokenVerifier, PrivyAuthenticationError } from '../dist/index.js';



const first = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const second = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const initial = 1800000000000;
const claims = { iss: 'privy.io', aud: 'app', sub: 'did:privy:user', sid: 'session', iat: initial / 1000 - 60, exp: initial / 1000 + 3600 };
const key = (pair, kid = 'first', fields = {}) => ({ ...pair.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'ES256', ...fields });
const token = (pair = first, kid = 'first', payload = claims, extraHeader = {}) => {
  const input = [ { alg: 'ES256', typ: 'JWT', kid, ...extraHeader }, payload ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return input + '.' + sign('sha256', Buffer.from(input), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
};
const options = (fetch, extra = {}) => ({ jwksUrl: 'https://trusted.invalid/keys?app=app', fetch, now: () => initial, ...extra });
const errorIs = code => error => {
  assert.ok(error instanceof PrivyAuthenticationError);
  assert.equal(error.code, code);
  assert.equal(error.cause, undefined);
  assert.ok(!error.message.includes('leaked-token'));
  return true;
};

test('생성 시 무통신, 최초 32개 동시 검증의 조회 공유와 무인증 신뢰 URL', async () => {
  let calls = 0;
  let resolveResponse;
  const v = new PrivyTokenVerifier('app', options((url, init) => {
    calls++;
    assert.equal(url, 'https://trusted.invalid/keys?app=app');
    assert.equal(init.headers, undefined);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    return new Promise(resolve => { resolveResponse = resolve; });
  }));
  assert.equal(calls, 0);
  const pending = Array.from({ length: 32 }, () => v.verifyAccessToken(token(first, 'first', claims,
    { jku: 'https://attacker.invalid', jwk: key(second) })));
  assert.equal(calls, 1);
  resolveResponse(Response.json({ keys: [key(first)] }));
  const users = await Promise.all(pending);
  assert.equal(users.length, 32);
  await v.verifyAccessToken(token());
  assert.equal(calls, 1);
});

test('알 수 없는 kid를 갱신하고 같은 cooldown에서 최대 2번 조회한다', async () => {
  let calls = 0;
  let time = initial;
  const v = new PrivyTokenVerifier('app', options(async () => {
    calls++;
    return Response.json({ keys: calls === 1 ? [key(first)] : [key(first), key(second, 'second')] });
  }, { now: () => time }));
  await v.verifyAccessToken(token());
  await v.verifyAccessToken(token(second, 'second'));
  assert.equal(calls, 2);
  await v.verifyAccessToken(token());
  await assert.rejects(v.verifyAccessToken(token(second, 'unknown')), errorIs('KEY_SOURCE_UNAVAILABLE'));
  assert.equal(calls, 2);
  time += 30000;
  await assert.rejects(v.verifyAccessToken(token(second, 'unknown')), errorIs('INVALID_TOKEN'));
  assert.equal(calls, 3);
});

test('동시 unknown kid 갱신 공유 및 사용 가능한 kid 없는 응답은 INVALID_TOKEN', async () => {
  let calls = 0;
  const v = new PrivyTokenVerifier('app', options(async () => { calls++; return Response.json({ keys: [key(first)] }); }));
  await v.verifyAccessToken(token());
  const results = await Promise.allSettled(Array.from({ length: 32 }, () => v.verifyAccessToken(token(second, 'missing'))));
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.code, 'INVALID_TOKEN');
  }
  assert.equal(calls, 2);
});

test('TTL 이후 장애에서 stale key를 쓰지 않고 실패도 조회 횟수에 포함한다', async () => {
  let calls = 0;
  let time = initial;
  let unavailable = false;
  const v = new PrivyTokenVerifier('app', options(async () => {
    calls++;
    if (unavailable) throw new Error('leaked-token');
    return Response.json({ keys: [key(first)] });
  }, { now: () => time }));
  await v.verifyAccessToken(token());
  unavailable = true;
  time += 299999;
  await v.verifyAccessToken(token());
  assert.equal(calls, 1);
  time++;
  await assert.rejects(v.verifyAccessToken(token()), errorIs('KEY_SOURCE_UNAVAILABLE'));
  await assert.rejects(v.verifyAccessToken(token()), errorIs('KEY_SOURCE_UNAVAILABLE'));
  await assert.rejects(v.verifyAccessToken(token()), errorIs('KEY_SOURCE_UNAVAILABLE'));
  assert.equal(calls, 3);
});

test('불가능한 claim의 사전 거부와 키 조회 중 만료의 사후 거부', async () => {
  let calls = 0;
  let time = initial;
  const v = new PrivyTokenVerifier('app', options(async () => {
    calls++;
    time += 1000;
    return Response.json({ keys: [key(first)] });
  }, { now: () => time }));
  await assert.rejects(v.verifyAccessToken(token(first, 'first', { ...claims, iss: 'bad' })), errorIs('INVALID_TOKEN'));
  assert.equal(calls, 0);
  await assert.rejects(v.verifyAccessToken(token(first, 'first', { ...claims, exp: initial / 1000 + 1 })), errorIs('EXPIRED_TOKEN'));
  assert.equal(calls, 1);
});

test('kid 생략시 후보 키를 검증하고 alg/use/curve 필터를 적용한다', async () => {
  const v = new PrivyTokenVerifier('app', options(async () => Response.json({ keys: [
    key(first, 'encryption', { use: 'enc' }), key(first, 'wrong-alg', { alg: 'ES384' }),
    key(second, 'second'), key(first, 'first'),
  ] })));
  assert.equal((await v.verifyAccessToken(token(first, undefined, claims, { kid: undefined }))).userId, claims.sub);
  await assert.rejects(v.verifyAccessToken(token(first, 'encryption')), errorIs('INVALID_TOKEN'));
});

test('잘못된 JWKS 및 크기 초과, timeout은 KEY_SOURCE_UNAVAILABLE', async () => {
  for (const body of ['not-json', '{}', '{"keys":null}', '{"keys":[{}]}', '{"keys":[{"kty":"EC","crv":"P-256"}]}',
    '{"keys":[' + JSON.stringify(key(first, 'first', { x: 'bad' })) + ']}']) {
    const v = new PrivyTokenVerifier('app', options(async () => new Response(body)));
    await assert.rejects(v.verifyAccessToken(token()), errorIs('KEY_SOURCE_UNAVAILABLE'));
  }
  for (const status of [301, 404, 429, 500]) {
    let calls = 0;
    const v = new PrivyTokenVerifier('app', options(async () => { calls++; return new Response('', { status }); }));
    await assert.rejects(v.verifyAccessToken(token()), errorIs('KEY_SOURCE_UNAVAILABLE'));
    assert.equal(calls, 1);
  }
  let aborted = false;
  const v = new PrivyTokenVerifier('app', options(async (_, init) => {
    init.signal.addEventListener('abort', () => { aborted = true; });
    return new Promise(() => {});
  }, { jwksPolicy: { timeoutMs: 10 } }));
  await assert.rejects(v.verifyAccessToken(token()), errorIs('KEY_SOURCE_UNAVAILABLE'));
  assert.ok(aborted);
  for (const extra of [0, 1]) {
    const json = JSON.stringify({ keys: [key(first)], padding: '' });
    const body = json.slice(0, -2) + ' '.repeat(131072 - Buffer.byteLength(json) + extra) + '"}';
    const limit = new PrivyTokenVerifier('app', options(async () => new Response(body)));
    if (extra) await assert.rejects(limit.verifyAccessToken(token()), errorIs('KEY_SOURCE_UNAVAILABLE'));
    else await limit.verifyAccessToken(token());
  }
});

test('로컬 JWKS body 읽기 timeout에서 연결을 취소한다', async t => {
  const server = createServer((req, res) => { res.writeHead(200); res.write('{"keys":['); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const v = new PrivyTokenVerifier('app', options(globalThis.fetch, {
    jwksUrl: `http://127.0.0.1:${server.address().port}/keys`, jwksPolicy: { timeoutMs: 50 },
  }));
  await assert.rejects(v.verifyAccessToken(token()), errorIs('KEY_SOURCE_UNAVAILABLE'));
});

test('신뢰한 URL과 JWKS 정책은 초기화 시 검증한다', () => {
  for (const jwksUrl of ['http://remote/keys', 'https://user@host/keys', 'https://host/#x',
    'https://host/keys\n', 'http://127.1/keys', 'https://host\\keys', 'file:///keys']) {
    assert.throws(() => new PrivyTokenVerifier('app', options(globalThis.fetch, { jwksUrl })), TypeError);
  }
  for (const jwksPolicy of [{ timeoutMs: 0 }, { timeoutMs: 2147483648 }, { cacheTtlMs: 30000 },
    { refreshCooldownMs: 0 }, { cacheTtlMs: 50, refreshCooldownMs: 50 }]) {
    assert.throws(() => new PrivyTokenVerifier('app', options(globalThis.fetch, { jwksPolicy })), TypeError);
  }
  assert.throws(() => new PrivyTokenVerifier('app', { ...options(globalThis.fetch),
    publicKeyPem: first.publicKey.export({ type: 'spki', format: 'pem' }) }), TypeError);
});

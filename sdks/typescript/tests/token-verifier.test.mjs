import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { PrivyClient, PrivyTokenVerifier, PrivyAuthenticationError } from '../dist/index.js';



const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = keys.publicKey.export({ type: 'spki', format: 'pem' });
const now = 1800000000000;
const base = { iss: 'privy.io', aud: 'app', sub: 'did:privy:user-1', sid: 'session-1', iat: 1799999940, exp: 1800003600 };
function jwt(claims = base, header = { alg: 'ES256', typ: 'JWT' }, key = keys.privateKey) {
  const input = [header, claims].map(value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')).join('.');
  return input + '.' + sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
function verifier(options = {}, appId = 'app') {
  return new PrivyTokenVerifier(appId, { publicKeyPem: pem, now: () => now, ...options });
}
function errorIs(code, token) {
  return error => {
    assert.ok(error instanceof PrivyAuthenticationError);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    if (token) assert.ok(!inspect(error).includes(token));
    return true;
  };
}

test('문서의 claim 판정 23개를 실제 P-256 서명 토큰으로 검증한다', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/token-claims.json', import.meta.url), 'utf8'));
  for (const entry of fixture.cases) {
    const v = verifier({ now: () => entry.nowEpochSeconds * 1000, clockSkewMs: entry.clockSkewSeconds * 1000 });
    const token = jwt(entry.claims);
    if (entry.expected === 'ACCEPT') {
      assert.deepEqual(await v.verifyAccessToken(token), {
        appId: 'app', userId: entry.claims.sub, sessionId: entry.claims.sid,
        issuedAtMs: BigInt(entry.claims.iat) * 1000n, expiresAtMs: BigInt(entry.claims.exp) * 1000n,
      }, entry.case);
    } else await assert.rejects(v.verifyAccessToken(token), errorIs(entry.expected, token), entry.case);
  }
});

test('서명·header 검증과 신뢰한 고정 키 선택', async () => {
  const v = verifier();
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  for (const header of [{ alg: 'HS256', typ: 'JWT' }, { alg: 'none', typ: 'JWT' },
    { alg: 'ES256' }, { alg: 'ES256', typ: 'at+jwt' }, { alg: 'ES256', typ: 'id+jwt' },
    { alg: 'ES256', typ: 'JWT', crit: ['foo'] }, { alg: 'ES256', typ: 'JWT', kid: 'x'.repeat(257) }]) {
    await assert.rejects(v.verifyAccessToken(jwt(base, header)), errorIs('INVALID_TOKEN'));
  }
  await assert.rejects(v.verifyAccessToken(jwt(base, undefined, other.privateKey)), errorIs('INVALID_TOKEN'));
  const valid = jwt();
  await assert.rejects(v.verifyAccessToken(valid.slice(0, valid.lastIndexOf('.') + 1) + 'AA'), errorIs('INVALID_TOKEN'));
  const parts = valid.split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...base, sid: 'tampered' })).toString('base64url');
  await assert.rejects(v.verifyAccessToken(parts.join('.')), errorIs('INVALID_TOKEN'));
  const user = await v.verifyAccessToken(jwt(base, { alg: 'ES256', typ: 'jwt', crit: [], kid: 'ignored',
    jku: 'https://untrusted.invalid', jwk: other.publicKey.export({ format: 'jwk' }) }));
  assert.equal(user.sessionId, 'session-1');
  assert.ok(Object.isFrozen(user));
  assert.deepEqual(Object.keys(user), ['appId', 'userId', 'sessionId', 'issuedAtMs', 'expiresAtMs']);
});

test('Bearer 구문과 입력 부재·길이의 처리 순서를 지킨다', async () => {
  const v = verifier();
  for (const missing of [null, undefined, '', '\t\u2000']) {
    await assert.rejects(v.verifyAccessToken(missing), errorIs('MISSING_TOKEN'));
    await assert.rejects(v.authenticateAuthorizationHeader(missing), errorIs('MISSING_TOKEN'));
  }
  for (const raw of [' '.repeat(16385), 42, 'Bearer ' + jwt(), 'a.b', 'a.b.c.d', 'x.y.z']) {
    await assert.rejects(v.verifyAccessToken(raw), errorIs('INVALID_TOKEN'));
  }
  for (const header of [' Bearer ' + jwt(), 'Bearer\t' + jwt(), 'Bearer ' + jwt() + ' ',
    'Bearer ' + jwt() + '\n', 'Bearer ' + jwt() + ',next', 'Basic ' + jwt(), ' '.repeat(16417)]) {
    await assert.rejects(v.authenticateAuthorizationHeader(header), errorIs('INVALID_TOKEN'));
  }
  assert.equal((await v.authenticateAuthorizationHeader('bEaReR   ' + jwt())).userId, base.sub);
});

test('NumericDate의 Java LONG_OR_DOUBLE 파싱과 bigint 범위를 보존한다', async () => {
  const raw = exp => JSON.stringify(base).replace('1800003600', exp);
  const v = verifier();
  for (const exp of ['9223372036854776', '1e1000000',
    '1800003600.5', '"1800003600"', 'null', '-1', '1e-1000000']) {
    await assert.rejects(v.verifyAccessToken(jwt(raw(exp))), errorIs('INVALID_TOKEN'), exp);
  }
  for (const exp of ['1800003600.0000000000000000001', '1800003600.0', '180000360000e-2', '1.8000036e9', '1800003600e0']) {
    assert.equal((await v.verifyAccessToken(jwt(raw(exp)))).expiresAtMs, 1800003600000n);
  }
  assert.equal((await v.verifyAccessToken(jwt(raw('9223372036854775')))).expiresAtMs, 9223372036854775000n);
});

test('매 요청마다 시간 재검사, 소수 skew 경계, Java sid 공백을 보존한다', async () => {
  let time = now;
  const token = jwt({ ...base, exp: now / 1000 + 1 });
  const v = verifier({ now: () => time });
  await v.verifyAccessToken(token);
  time += 1000;
  await assert.rejects(v.verifyAccessToken(token), errorIs('EXPIRED_TOKEN'));
  const skew = verifier({ now: () => now + 1, clockSkewMs: 1.5 });
  await skew.verifyAccessToken(jwt({ ...base, exp: now / 1000 }));
  await assert.rejects(verifier({ now: () => now + 2, clockSkewMs: 1.5 })
    .verifyAccessToken(jwt({ ...base, exp: now / 1000 })), errorIs('EXPIRED_TOKEN'));
  await v.verifyAccessToken(jwt({ ...base, sid: '\u00a0' }));
});

test('고정 공개키와 설정을 생성 시 파싱하고 잘못된 키 종류를 거부한다', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  for (const bad of [keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    rsa.publicKey.export({ type: 'spki', format: 'pem' }), p384.publicKey.export({ type: 'spki', format: 'pem' }),
    pem.replace('PUBLIC KEY', 'CERTIFICATE'), '', null]) {
    assert.throws(() => verifier({ publicKeyPem: bad }), TypeError);
  }
  for (const skew of [-1, 60000.01, NaN, Infinity]) assert.throws(() => verifier({ clockSkewMs: skew }), TypeError);
  assert.throws(() => verifier({}, ' '), TypeError);
  assert.doesNotThrow(() => verifier({}, 'app: local'));
});

test('원시 JSON 중복 키·malformed 숫자·과도한 중첩은 정리된 오류로 거부한다', async () => {
  const v = verifier();
  for (const raw of [JSON.stringify(base).replace('"iss":"privy.io"', '"iss":"other","iss":"privy.io"'),
    JSON.stringify(base).replace('1800003600', '01800003600'), '{', '[]',
    JSON.stringify(base).replace('"sid":"session-1"', '"sid":"session-1","extra":' + '['.repeat(1001) + '0' + ']'.repeat(1001))]) {
    const token = jwt(raw);
    await assert.rejects(v.verifyAccessToken(token), errorIs('INVALID_TOKEN', token));
  }
});

test('PrivyClient에 검증기를 구성하고 미설정은 구성 오류로 구분한다', async () => {
  const missing = new PrivyClient({ appId: 'app', appSecret: 'secret' });
  assert.throws(() => missing.verifyAccessToken(jwt()), { name: 'IllegalStateException' });
  assert.throws(() => missing.authenticateAuthorizationHeader('Bearer ' + jwt()), { name: 'IllegalStateException' });
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret',
    tokenVerification: { publicKeyPem: pem, now: () => now },
    fetch: async () => { throw new Error('공개키 검증에서 네트워크 호출 금지'); } });
  assert.equal((await client.verifyAccessToken(jwt())).userId, base.sub);
  assert.equal((await client.authenticateAuthorizationHeader('Bearer ' + jwt())).sessionId, base.sid);
});

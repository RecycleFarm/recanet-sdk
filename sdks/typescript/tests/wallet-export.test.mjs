import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm } from '@hpke/core';
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { BackendWalletRegistration, PrivyApiError, PrivyClient } from '../dist/index.js';


import { canonicalPrivy059 } from '../dist/internal/authorization.js';
import { createExportReceiver, openExportMessage } from '../dist/internal/privy-hpke.js';

const suite = aead => new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: aead ?? new Chacha20Poly1305() });
const registration = BackendWalletRegistration.generate();
const origin = 'https://privy.invalid', appId = 'test-app', appSecret = 'test-app-secret';
async function encrypt(body, plaintext, options = {}) {
  const publicKey = await crypto.subtle.importKey('spki', Buffer.from(body.recipient_public_key, 'base64'),
    { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const sender = await suite(options.aead).createSenderContext({ recipientPublicKey: publicKey, info: options.info ?? new Uint8Array() });
  const ciphertext = await sender.seal(plaintext, options.aad ?? new Uint8Array());
  return { encryption_type: 'HPKE', encapsulated_key: Buffer.from(sender.enc).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') };
}
const json = value => new Response(JSON.stringify(value));
const rejects = (fn, code) => assert.rejects(fn, error => error instanceof PrivyApiError && error.code === code);

test('Bouncy Castle 1.83의 고정 P-256/ChaCha base mode 벡터와 공개키·복호화 바이트가 일치한다', async () => {
  const vector = JSON.parse(await readFile(new URL('./fixtures/privy-export-hpke.json', import.meta.url), 'utf8'));
  assert.deepEqual([vector.mode, vector.kem, vector.kdf, vector.aead], [0, 16, 1, 3]);
  const cipher = suite(), pair = await cipher.kem.deriveKeyPair(Buffer.from(vector.ikmR, 'hex'));
  assert.equal(Buffer.from(await cipher.kem.serializePublicKey(pair.publicKey)).toString('hex'), vector.publicKeyR);
  assert.equal(await openExportMessage(pair, vector.encapsulatedKey, vector.ciphertext), Buffer.from(vector.plaintextBase64, 'base64').toString('utf8'));
  const changed = Buffer.from(vector.ciphertext, 'base64'); changed[0] ^= 1;
  await assert.rejects(() => openExportMessage(pair, vector.encapsulatedKey, changed.toString('base64')));
});

test('export는 새 SPKI P-256 수신키와 정확한 URL/body를 승인하고 lookup/idempotency/expiry 없이 평문 전체를 반환한다', async () => {
  const plaintext = '{"private_key":"test-only-plaintext"}\n한글🙂', calls = [], logs = [];
  const client = new PrivyClient({ appId, appSecret, origin, fetch: async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body.recipient_public_key);
    assert.equal(url, origin + '/v1/wallets/wallet%20%2F%ED%95%9C/export'); assert.equal(init.method, 'POST');
    assert.deepEqual(Object.keys(body).sort(), ['encryption_type', 'recipient_public_key']); assert.equal(body.encryption_type, 'HPKE');
    assert.equal(createPublicKey({ key: Buffer.from(body.recipient_public_key, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyDetails.namedCurve, 'prime256v1');
    assert.equal(init.headers['privy-idempotency-key'], undefined); assert.equal(init.headers['privy-request-expiry'], undefined);
    assert.equal(init.headers.authorization, 'Basic ' + Buffer.from(appId + ':' + appSecret).toString('base64'));
    const payload = canonicalPrivy059({ version: 1, method: 'POST', url, body, headers: { 'privy-app-id': appId } });
    assert.equal(verify('sha256', Buffer.from(payload), registration.publicKey, Buffer.from(init.headers['privy-authorization-signature'], 'base64')), true);
    assert.ok(!init.body.includes(registration.privateKey)); assert.ok(!init.body.includes(plaintext));
    // Pinned helper ignores the response's encryption_type rather than negotiating a suite.
    const response = await encrypt(body, Buffer.from(plaintext)); response.encryption_type = 'not-selected';
    return json(response);
  } });
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const key of Object.keys(original)) console[key] = (...args) => logs.push(args);
  try { assert.equal(await client.exportWalletPrivateKey('wallet /한', registration), plaintext); }
  finally { Object.assign(console, original); }
  assert.equal(calls.length, 1); assert.equal(logs.length, 0);
});

test('동시 export 요청마다 임시 수신 키를 독립 생성하며 빈 평문/잘못된 UTF-8도 Java 문자열 경계로 반환한다', async () => {
  const keys = new Set(), values = [new Uint8Array(), new Uint8Array([255]), new Uint8Array([0xed, 0xa0, 0x80]), Buffer.from('test-only value')];
  const expected = ['', '\ufffd', '\ufffd', 'test-only value'];
  const client = new PrivyClient({ appId, appSecret, fetch: async (url, init) => {
    const body = JSON.parse(init.body), i = Number(url.split('/').at(-2).slice('wallet-'.length)); keys.add(body.recipient_public_key);
    return json(await encrypt(body, values[i % values.length]));
  } });
  const result = await Promise.all(Array.from({ length: 9 }, (_, i) => client.exportWalletPrivateKey('wallet-' + i, registration)));
  assert.equal(keys.size, 9); assert.deepEqual(result, Array.from({ length: 9 }, (_, i) => expected[i % expected.length]));
});

test('잘못된 wallet/registration은 통신 전에 거부하고 잘못된 승인 개인키는 일반 export 오류로 정리한다', async () => {
  let count = 0;
  const client = new PrivyClient({ appId, appSecret, fetch: async () => { count++; return json({}); } });
  for (const id of ['', '\u3000', null]) await assert.rejects(() => client.exportWalletPrivateKey(id, registration), TypeError);
  await assert.rejects(() => client.exportWalletPrivateKey('wallet', null), TypeError);
  await rejects(() => client.exportWalletPrivateKey('wallet', new BackendWalletRegistration('public', 'invalid')), 'UNAVAILABLE');
  assert.equal(count, 0);
});

test('API 오류는 status와 정리된 code를 보존하고 응답/복호화 오류는 비밀·cause 없이 실패하며 자동 재시도하지 않는다', async () => {
  for (const [status, code] of [[401, 'INVALID_CREDENTIALS'], [403, 'FORBIDDEN'], [429, 'RATE_LIMITED'], [503, 'UNAVAILABLE']]) {
    let count = 0;
    const client = new PrivyClient({ appId, appSecret, fetch: async () => { count++; return new Response('provider-secret', { status }); } });
    await assert.rejects(() => client.exportWalletPrivateKey('wallet', registration), error => {
      assert.equal(error.code, code); assert.equal(error.statusCode, status); assert.equal(error.cause, undefined);
      assert.ok(!String(error).includes('provider-secret')); return true;
    }); assert.equal(count, 1);
  }
  for (const value of [{}, [], null, { encapsulated_key: '!', ciphertext: '!' }, { encapsulated_key: '', ciphertext: '' }]) {
    const client = new PrivyClient({ appId, appSecret, fetch: async () => json(value) });
    await rejects(() => client.exportWalletPrivateKey('wallet', registration), 'UNAVAILABLE');
  }
});

test('별도 info/AAD·다른 AEAD·변조/다른 수신 키로 만든 응답은 고정 suite에서 열지 못한다', async () => {
  for (const variant of ['info', 'aad', 'aes', 'tamper', 'other-recipient']) {
    const client = new PrivyClient({ appId, appSecret, fetch: async (_url, init) => {
      let body = JSON.parse(init.body);
      if (variant === 'other-recipient') body = { recipient_public_key: (await createExportReceiver()).recipientPublicKey };
      const options = variant === 'aes' ? { aead: new Aes128Gcm() } : variant === 'info' ? { info: new Uint8Array([1]) }
        : variant === 'aad' ? { aad: new Uint8Array([1]) } : {};
      const response = await encrypt(body, Buffer.from('test-only-secret'), options);
      if (variant === 'tamper') { const ct = Buffer.from(response.ciphertext, 'base64'); ct[0] ^= 1; response.ciphertext = ct.toString('base64'); }
      return json(response);
    } });
    await assert.rejects(() => client.exportWalletPrivateKey('wallet', registration), error => error.code === 'UNAVAILABLE'
      && error.statusCode === 0 && !String(error).includes('test-only-secret') && error.cause === undefined);
  }
});

test('전송 취소와 timeout은 기존 HTTP 오류를 유지하고 malformed HTTP JSON은 INVALID_RESPONSE다', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const client = new PrivyClient({ appId, appSecret, fetch: async () => { calls++; return json({}); } });
  await rejects(() => client.exportWalletPrivateKey('wallet', registration, controller.signal), 'INTERRUPTED'); assert.equal(calls, 0);
  const malformed = new PrivyClient({ appId, appSecret, fetch: async () => new Response('{bad json') });
  await rejects(() => malformed.exportWalletPrivateKey('wallet', registration), 'INVALID_RESPONSE');
  const slow = new PrivyClient({ appId, appSecret, timeoutMs: 5, fetch: async () => new Promise(() => {}) });
  await rejects(() => slow.exportWalletPrivateKey('wallet', registration), 'UNAVAILABLE');
});

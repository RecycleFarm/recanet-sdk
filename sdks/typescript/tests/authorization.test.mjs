import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BackendWalletRegistration } from '../dist/index.js';


import { canonicalPrivy059, prepareAuthorization } from '../dist/internal/authorization.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/authorization.json', import.meta.url), 'utf8'));

test('기준 Privy 0.59 승인 payload 3개는 canonical 바이트·digest·DER 서명 검증이 일치한다', () => {
  for (const entry of fixture.cases) {
    const canonical = canonicalPrivy059(entry.payload);
    assert.equal(canonical, entry.canonicalUtf8, entry.case);
    assert.equal(createHash('sha256').update(canonical).digest('hex'), entry.sha256Hex);
    assert.ok(verify('sha256', Buffer.from(canonical), fixture.verificationPublicKeyPem,
      Buffer.from(entry.authorizationSignatureBase64, 'base64')));
    const pair = BackendWalletRegistration.generate();
    const prepared = prepareAuthorization('app', entry.payload.url, entry.payload.body, pair.privateKey,
      entry.payload.headers['privy-idempotency-key']);
    assert.ok(verify('sha256', Buffer.from(canonical), pair.publicKey, Buffer.from(prepared.signature, 'base64')));
    assert.deepEqual(JSON.parse(prepared.bodyJson), entry.payload.body);
  }
});

test('실제 URL·body·idempotency key를 결속하고 toJSON snapshot을 한 번만 만든다', () => {
  const pair = BackendWalletRegistration.generate();
  let calls = 0;
  const body = { toJSON() { calls++; return { message: 'snapshot-' + calls }; } };
  const url = 'https://api.privy.io/v1/wallets/wallet-test/rpc';
  const prepared = prepareAuthorization('app', url, body, pair.privateKey, 'operation');
  assert.equal(calls, 1);
  const payload = { version: 1, method: 'POST', url, body: JSON.parse(prepared.bodyJson),
    headers: { 'privy-app-id': 'app', 'privy-idempotency-key': 'operation' } };
  const signature = Buffer.from(prepared.signature, 'base64');
  assert.ok(verify('sha256', Buffer.from(canonicalPrivy059(payload)), pair.publicKey, signature));
  for (const changed of [{ ...payload, url: url + '/changed' }, { ...payload, body: { message: 'changed' } },
    { ...payload, headers: { ...payload.headers, 'privy-idempotency-key': 'different' } }]) {
    assert.equal(verify('sha256', Buffer.from(canonicalPrivy059(changed)), pair.publicKey, signature), false);
  }
});

test('Privy 기준의 비표준 key escape 경계를 DMRVN/JCS와 구분한다', () => {
  assert.equal(canonicalPrivy059({ 'a"b': 1 }), '{"a"b":1}');
  assert.equal(canonicalPrivy059({ value: '\u000f' }), '{"value":"\\u000F"}');
  assert.equal(canonicalPrivy059({ value: '\\u000f' }), JSON.stringify({ value: '\\u000f' }));
  assert.equal(canonicalPrivy059({ values: [2, 1], large: '9007199254740993' }),
    '{"large":"9007199254740993","values":[2,1]}');
});

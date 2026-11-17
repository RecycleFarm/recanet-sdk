import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashMessage, Wallet } from 'ethers';
import { DmrvnDecimal } from '../dist/index.js';
import * as crypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';

const fixture = async name => JSON.parse(await readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const code = expected => error => { assert.equal(error.code, expected); return true; };

test('Keccak는 SHA3와 구분하며 hex·bytes32·uint·word 범위를 검증한다', () => {
  assert.equal(crypto.keccak(new Uint8Array()), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(crypto.hexString(crypto.hexBytes('0xaB00')), '0xab00');
  for (const input of ['0X00', '0x0', 'aa', null]) assert.throws(() => crypto.hexBytes(input), code('INVALID_INPUT'));
  assert.equal(crypto.uint('18446744073709551615', 64), (1n << 64n) - 1n);
  for (const value of ['01', '+1', '0x1', '-1', 1.5, Number.MAX_SAFE_INTEGER + 1, new DmrvnDecimal('1.0')]) {
    assert.throws(() => crypto.uint(value, 256), code('INVALID_INPUT'));
  }
  assert.throws(() => crypto.uint(256, 8), code('INVALID_INPUT'));
  assert.equal(crypto.hexString(crypto.word((1n << 256n) - 1n)), '0x' + 'ff'.repeat(32));
  assert.throws(() => crypto.word(1n << 256n), code('INVALID_INPUT'));
});

test('DMRVN 주소는 혼합 checksum을 검사하고 소문자로 정규화한다', () => {
  const valid = '0x52908400098527886E0F7030069857D2E4169EE7';
  assert.equal(crypto.normalizeAddress(valid), valid.toLowerCase());
  assert.equal(crypto.normalizeAddress(valid.toLowerCase()), valid.toLowerCase());
  assert.equal(crypto.normalizeAddress('0x' + '00'.repeat(20)), '0x' + '00'.repeat(20));
  assert.throws(() => crypto.normalizeAddress('0x52908400098527886E0F7030069857D2E4169Ee7'), code('INVALID_INPUT'));
});

test('명세의 3개 secp256k1 서명 복구 벡터가 일치한다', async () => {
  const vectors = await fixture('dmrvn-protocol.json');
  for (const entry of [vectors.claim, vectors.assignment, vectors.observation]) {
    assert.equal(crypto.recover(entry.digest, entry.signature), entry.recoveredSigner.toLowerCase());
    const raw = crypto.hexBytes(entry.signature);
    raw[64] -= 27;
    assert.equal(crypto.recover(entry.digest, crypto.hexString(raw)), entry.recoveredSigner.toLowerCase());
    raw[64] = 2;
    assert.throws(() => crypto.recover(entry.digest, crypto.hexString(raw)), code('SIGNATURE_INVALID'));
    raw[64] = 27;
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    raw.set(crypto.word(n - BigInt(crypto.hexString(raw.slice(32, 64)))), 32);
    assert.throws(() => crypto.recover(entry.digest, crypto.hexString(raw)), code('SIGNATURE_INVALID'));
  }
  assert.throws(() => crypto.recover('0x00', '0x' + '00'.repeat(65)), code('SIGNATURE_INVALID'));
});

test('personal-message는 UTF-8 바이트 길이를 사용하고 malformed 문자열은 Java 대체를 유지한다', async () => {
  const message = '한글😀';
  assert.equal(crypto.messageDigest(message), hashMessage(message));
  assert.equal(crypto.textHash('\ud800'), crypto.textHash('?'));
  // 공개적으로 알려진 시험용 키 1. 서비스 자격 증명이나 운영 지갑 키가 아니다.
  const wallet = new Wallet('0x' + '00'.repeat(31) + '01');
  assert.equal(crypto.recover(crypto.messageDigest(message), await wallet.signMessage(message)), wallet.address.toLowerCase());
});

test('Java JSON 관찰 벡터와 제어 문자 바이트/hash가 일치한다', async () => {
  const primitive = await fixture('dmrvn-primitives.json');
  for (const entry of primitive.jsonCases) {
    const operation = () => DmrvnJson.canonical(DmrvnJson.parse(Buffer.from(entry.input)));
    if (entry.error) assert.throws(operation, code(entry.error));
    else assert.equal(operation(), entry.canonical);
  }
  const escapes = await fixture('dmrvn-escapes.json');
  for (const entry of escapes.cases) {
    const value = DmrvnJson.parse(Buffer.from(entry.inputJson));
    assert.equal(DmrvnJson.canonical(value), entry.currentCanonical, entry.id);
    assert.equal(DmrvnJson.hash(value), entry.currentKeccak256, entry.id);
  }
});

test('DMRVN decimal은 정수와 구분하고 canonical copy의 기존 비왕복 경계를 보존한다', () => {
  const decimal = DmrvnJson.parse(Buffer.from('9007199254740992.0'));
  assert.ok(decimal instanceof DmrvnDecimal);
  assert.equal(JSON.stringify({ decimal: new DmrvnDecimal('1.5') }), '{"decimal":1.5}');
  assert.equal(DmrvnJson.canonical(decimal), '9007199254740992');
  assert.throws(() => DmrvnJson.copy(decimal), code('INVALID_INPUT'));
  for (const [input, output] of [['1.0', '1.0'], ['1e0', '1'], ['1e3', '1E+3'],
    ['0.0000001', '1E-7'], ['-0.0', '0.0'], ['123.45', '123.45']]) {
    assert.equal(String(DmrvnJson.parse(Buffer.from(input))), output);
  }
  const value = { 'a"b': 'value', nested: ['한글'] };
  const copy = DmrvnJson.copy(value);
  value.nested[0] = 'changed';
  assert.equal(copy.nested[0], '한글');
  assert.throws(() => DmrvnJson.parse(new Uint8Array([0xff])), code('INVALID_INPUT'));
});

test('Java Json.object 대응은 최상위 객체만 허용하고 decimal·특수 키와 기존 파서 거부 경계를 유지한다', () => {
  const value = DmrvnJson.object(Buffer.from('{"__proto__":{"safe":true},"nested":[{"value":1.5}],"empty":{}}'));
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(value.__proto__.safe, true);
  assert.ok(value.nested[0].value instanceof DmrvnDecimal);
  assert.equal(String(value.nested[0].value), '1.5');
  assert.deepEqual(Object.keys(value.empty), []);
  assert.deepEqual(Object.keys(DmrvnJson.object(Buffer.from('{}'))), []);
  for (const input of ['null', '[]', '"value"', 'true', '1', '1.0', '{"a":1,"a":2}', '{} {}', '{"n":-0}', '{']) {
    assert.throws(() => DmrvnJson.object(Buffer.from(input)), code('INVALID_INPUT'), input);
  }
  assert.throws(() => DmrvnJson.object(new Uint8Array([0xff])), code('INVALID_INPUT'));
});

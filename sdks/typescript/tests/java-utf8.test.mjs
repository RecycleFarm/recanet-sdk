import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeJavaUtf8 } from '../dist/internal/java-utf8.js';

test('Java UTF-8 malformed surrogate 그룹·잘린 prefix·BOM·유효 supplementary 문자를 보존한다', () => {
  for (const [bytes, expected] of [
    [[0xed, 0xa0, 0x80], '\ufffd'], [[0xed, 0xbf, 0xbf], '\ufffd'], [[0xed, 0xa0], '\ufffd'],
    [[0xed, 0xa0, 0x41], '\ufffdA'], [[0xe0, 0x80, 0x80], '\ufffd\ufffd\ufffd'],
    [[0xef, 0xbb, 0xbf], '\ufeff'], [[0xf0, 0x9f, 0x99, 0x82], '🙂'],
  ]) assert.equal(decodeJavaUtf8(Uint8Array.from(bytes)), expected);
});

test('실제 Java17의 전체 1/2바이트·3바이트 lead·4바이트 경계·임의 조합 corpus digest와 일치한다', async () => {
  const vector = JSON.parse(await readFile(new URL('./fixtures/java-utf8-corpus.json', import.meta.url), 'utf8'));
  const hash = createHash('sha256'); let cases = 0;
  const add = input => {
    const text = decodeJavaUtf8(Uint8Array.from(input)), bytes = Buffer.alloc(1 + text.length * 2);
    bytes[0] = text.length;
    for (let i = 0; i < text.length; i++) bytes.writeUInt16LE(text.charCodeAt(i), 1 + i * 2);
    hash.update(bytes); cases++;
  };
  for (let a = 0; a < 256; a++) add([a]);
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) add([a, b]);
  for (let a = 0xe0; a <= 0xef; a++) for (let b = 0; b < 256; b++) for (let c = 0; c < 256; c++) add([a, b, c]);
  const edges = [0, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xed, 0xf4, 0xff];
  for (let a = 0xf0; a <= 0xf7; a++) for (const b of edges) for (const c of edges) for (const d of edges) add([a, b, c, d]);
  let state = 0x12345678;
  for (let i = 0; i < 65536; i++) {
    const bytes = [];
    for (let j = 0; j < i % 8 + 1; j++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; bytes.push(state >>> 24); }
    add(bytes);
  }
  assert.equal(cases, vector.cases); assert.equal(hash.digest('hex'), vector.sha256);
});

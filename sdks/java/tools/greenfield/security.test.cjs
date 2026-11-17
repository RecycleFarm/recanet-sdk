'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { ec: EC } = require('elliptic');
const { p521 } = require('@noble/curves/p521');
const { p256 } = require('@noble/curves/p256');
const { secp256k1 } = require('@noble/curves/secp256k1');
const HmacDRBG = require('hmac-drbg');
const hash = require('hash.js');
const BN = require('bn.js');
const set = require('lodash.set');
const { XMLParser } = require('fast-xml-parser');

function pair(signature) { return [BigInt('0x' + signature.r.toString(16)), BigInt('0x' + signature.s.toString(16))]; }

test('RFC6979 P-521 leading-zero nonce matches independent noble implementation', () => {
  const ec = new EC('p521');
  const key = new Uint8Array(66); key[65] = 1; // Public fixed test key only.
  let digest;
  for (let i = 0; i < 4096; i++) {
    const candidate = createHash('sha512').update('Recanet public RFC6979 regression ' + i).digest();
    const drbg = new HmacDRBG({ hash: hash.sha512, entropy: key,
      nonce: new BN(candidate).toArray('be', 66) });
    if (drbg.generate(66)[0] === 0) { digest = candidate; break; }
  }
  assert.ok(digest, 'deterministic leading-zero nonce fixture found');
  const independent = p521.sign(digest, key, { lowS: false, prehash: false });
  const patched = ec.sign(digest, key);
  assert.deepEqual(pair(patched), [independent.r, independent.s]);
  assert.ok(p521.verify(independent.toCompactRawBytes(), digest, p521.getPublicKey(key), { lowS: false, prehash: false }));
  const legacy = new EC('p521'), truncate = legacy._truncateToN;
  legacy._truncateToN = function (value, truncOnly, bitLength) {
    return truncate.call(this, value, truncOnly, truncOnly ? undefined : bitLength);
  };
  assert.notDeepEqual(pair(legacy.sign(digest, key)), pair(patched), 'fixture exercises the upstream nonce-width bug');
});

test('secp256k1 and P-256 signatures retain independent deterministic vectors', () => {
  const key = new Uint8Array(32); key[31] = 1;
  for (const [name, curve] of [['secp256k1', secp256k1], ['p256', p256]]) {
    for (const digest of [Buffer.alloc(32), Buffer.from('00'.repeat(2) + 'ab'.repeat(30), 'hex'), createHash('sha256').update('public fixture').digest()]) {
      const expected = curve.sign(digest, key, { lowS: true, prehash: false });
      const actual = new EC(name).sign(digest, key, { canonical: true });
      assert.deepEqual(pair(actual), [expected.r, expected.s]);
    }
  }
});

test('maintained lodash setter preserves normal paths and prevents prototype pollution', () => {
  const value = {};
  set(value, 'a[0].b', 3); assert.deepEqual(value, { a: [{ b: 3 }] });
  for (const path of ['__proto__.recanetPolluted', 'constructor.prototype.recanetPolluted', ['__proto__', 'recanetPolluted']]) set({}, path, true);
  assert.equal({}.recanetPolluted, undefined);
});

test('patched protobuf runtime retains generated Greenfield message round trips', () => {
  const { MsgCreateObject } = require('@bnb-chain/greenfield-cosmos-types/greenfield/storage/tx');
  const message = MsgCreateObject.fromPartial({ creator: '0x' + '11'.repeat(20), bucketName: 'fixture', objectName: 'evidence.json', contentType: 'application/json', payloadSize: '2', visibility: 2, redundancyType: 1, expectChecksums: [new Uint8Array([1, 2, 3])] });
  const encoded = MsgCreateObject.encode(message).finish();
  assert.equal(Buffer.from(encoded).toString('hex'), '0a2a3078313131313131313131313131313131313131313131313131313131313131313131313131313131311207666978747572651a0d65766964656e63652e6a736f6e2002280232106170706c69636174696f6e2f6a736f6e42030102034801', 'pre-upgrade protobuf6 wire bytes preserved');
  const result = MsgCreateObject.decode(encoded);
  assert.equal(result.bucketName, 'fixture'); assert.equal(result.objectName, 'evidence.json');
  assert.equal(result.payloadSize.toString(), '2'); assert.deepEqual(Array.from(result.expectChecksums[0]), [1, 2, 3]);
});

test('patched XML parser retains Greenfield error document shape', () => {
  assert.deepEqual(new XMLParser().parse('<Error><Code>AccessDenied</Code><Message>fixture</Message></Error>'), { Error: { Code: 'AccessDenied', Message: 'fixture' } });
});

test('ethers v5 WebSocket provider retains local JSON-RPC transport with patched ws', async () => {
  const { WebSocketServer } = require('ws');
  const { ethers } = require('ethers');
  const server = new WebSocketServer({ port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  server.on('connection', socket => socket.on('message', bytes => {
    const request = JSON.parse(String(bytes));
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x1' : '0x10' }));
  }));
  const provider = new ethers.providers.WebSocketProvider('ws://127.0.0.1:' + server.address().port);
  try { assert.equal(await provider.send('eth_blockNumber', []), '0x10'); }
  finally { await provider.destroy(); await new Promise(resolve => server.close(resolve)); }
});

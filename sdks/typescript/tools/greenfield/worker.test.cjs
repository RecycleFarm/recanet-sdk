'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { perform, normalizeError, storageIdentity, readRequest } = require('./worker.cjs');
const { BroadcastTxError } = require('@cosmjs/stargate');
const { ethers } = require('ethers');
const request = { chainId: '5600', address: '0x'+'11'.repeat(20), feeGranter: '',
  location: { storageType: 1, chainId: '5600', bucketName: 'test', objectName: 'prefix/evidence.json' }, bytes: Buffer.from('{}').toString('base64') };
const client = object => ({ basic: { getNodeInfo: async () => ({ defaultNodeInfo: { network: 'greenfield_5600-1' } }) }, object });
test('private create simulates before broadcast and returns original tx', async () => {
  let calls = [];
  const value = await perform({ ...request, op: 'create' }, client({ createObject: async input => {
    assert.equal(input.visibility, 2); assert.equal(input.creator, request.address); calls.push('create');
    return { simulate: async () => { calls.push('simulate'); return { gasLimit: '100', gasPrice: '1' }; },
      broadcast: async opts => { calls.push('broadcast'); assert.equal(opts.privateKey, 'test-only-key'); return { code: 0, transactionHash: 'ab'.repeat(32) }; } };
  } }), 'test-only-key', async () => ['AA==']);
  assert.deepEqual(calls, ['create','simulate','broadcast']); assert.equal(value.createTxHash, 'ab'.repeat(32));
});
test('upload resumes original hash and checks sealing without creating', async () => {
  let count = 0;
  const result = await perform({ ...request, op: 'upload', createTxHash: 'ab'.repeat(32) }, client({
    uploadObject: async (input) => { count++; assert.equal(input.txnHash, 'ab'.repeat(32)); return { code: 0 }; },
    headObject: async () => ({ objectInfo: { objectStatus: 1 } })
  }), 'test-only-key'); assert.equal(count,1); assert.equal(result.sealed,true);
});
test('not-found is distinct from permissions and wrong chain blocks writes', async () => {
  assert.deepEqual(await perform({ ...request, op: 'head' }, client({ headObject: async () => { throw new Error('No such object'); } }), 'test'), { exists: false, sealed: false });
  await assert.rejects(perform({ ...request, op: 'head' }, client({ headObject: async () => { throw new Error('permission denied'); } }), 'test'));
  await assert.rejects(perform({ ...request, chainId: '1', op: 'create' }, client({}), 'test'), { code: 'WRONG_CHAIN' });
  assert.equal(normalizeError(new Error('permission denied secret=do-not-output')), 'STORAGE_ACCESS_DENIED');
});
test('builder rejection proves no broadcast and distinguishes unfunded account', async () => {
  let rejected;
  try { await perform({ ...request, op: 'create' }, client({ createObject: async () => { throw new Error('account 0x111 not found'); } }), 'test', async () => ['AA==']); }
  catch (error) { rejected=error; }
  assert.equal(rejected.definitelyNotBroadcast,true);
  assert.equal(normalizeError(rejected),'STORAGE_ACCOUNT_UNFUNDED');
});
test('ambiguous broadcast never claims that nothing was sent', async () => {
  let rejected;
  try { await perform({ ...request, op: 'create' }, client({ createObject: async () => ({
    simulate: async () => ({ gasLimit: '100', gasPrice: '1' }),
    broadcast: async () => { throw new Error('connection lost'); }
  }) }), 'test', async () => ['AA==']); } catch (error) { rejected=error; }
  assert.notEqual(rejected.definitelyNotBroadcast,true);
  assert.notEqual(rejected.definitelyRejected,true);
});
test('canonical addresses reach both message and fee fields, preserving the feegrant', async () => {
  const address = '0xf288ec9ecc516a7e4c6780b417f3a247fe20cc77';
  const feeGranter = '0x812ea1e3fb2efa004ae1308ed27eced0b05cae66';
  await perform({ ...request, address, feeGranter, op: 'create' }, client({ createObject: async input => {
    assert.equal(input.creator, ethers.utils.getAddress(address));
    return { simulate: async () => ({ gasLimit: '1200', gasPrice: '5000000000' }), broadcast: async opts => {
      assert.equal(opts.payer, input.creator);
      assert.equal(opts.granter, ethers.utils.getAddress(feeGranter));
      return { code: 0, transactionHash: 'ab'.repeat(32) };
    } };
  } }), 'test-only-key', async () => ['AA==']);
});
test('typed CheckTx rejection is definite but never mislabelled as not broadcast', async () => {
  let rejected;
  try { await perform({ ...request, op: 'create' }, client({ createObject: async () => ({
    simulate: async () => ({ gasLimit: '1200', gasPrice: '1' }),
    broadcast: async () => { throw new BroadcastTxError(4,'sdk','wrong number of signers; expected 2, got 1: unauthorized'); }
  }) }), 'test', async () => ['AA==']); } catch (error) { rejected=error; }
  assert.equal(rejected.definitelyRejected,true);
  assert.notEqual(rejected.definitelyNotBroadcast,true);
  assert.equal(normalizeError(rejected),'SIGNATURE_INVALID');
});
test('storage key accepts optional hex prefix and never changes wallet identity', () => {
  const testKey='0'.repeat(63)+'1';
  const address=new ethers.Wallet(testKey).address;
  assert.deepEqual(storageIdentity(testKey,address.toLowerCase()),{privateKey:'0x'+testKey,address});
  assert.deepEqual(storageIdentity('0x'+testKey,address),{privateKey:'0x'+testKey,address});
  assert.throws(()=>storageIdentity(testKey,request.address),{code:'STORAGE_ACCESS_DENIED'});
});

test('verifyCreate decodes the exact successful protobuf transaction and checks creator/object/hash', async () => {
  const crypto = require('node:crypto');
  const { TxRaw, TxBody } = require('@bnb-chain/greenfield-cosmos-types/cosmos/tx/v1beta1/tx');
  const { MsgCreateObject } = require('@bnb-chain/greenfield-cosmos-types/greenfield/storage/tx');
  const message = MsgCreateObject.encode(MsgCreateObject.fromPartial({ creator: request.address,
    bucketName: request.location.bucketName, objectName: request.location.objectName })).finish();
  const body = TxBody.encode(TxBody.fromPartial({ messages: [{ typeUrl: '/greenfield.storage.MsgCreateObject', value: message }] })).finish();
  const bytes = TxRaw.encode(TxRaw.fromPartial({ bodyBytes: body })).finish();
  const hash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  const original = global.fetch;
  const tx = { tx: Buffer.from(bytes).toString('base64'), tx_result: { code: 0 } };
  global.fetch = async (_url, init) => {
    assert.equal(init.redirect, 'error');
    const query = JSON.parse(init.body); assert.equal(query.method, 'tx'); assert.equal(query.params.prove, false);
    assert.equal(Buffer.from(query.params.hash, 'base64').toString('hex').toUpperCase(), hash);
    return { ok: true, json: async () => ({ result: tx }) };
  };
  try {
    const invoke = (extra = {}) => perform({ ...request, op: 'verifyCreate', rpcUrl: 'https://node.invalid', createTxHash: '0x' + hash, ...extra }, client({}), 'test');
    assert.deepEqual(await invoke(), { matches: true });
    assert.deepEqual(await invoke({ address: '0x' + '22'.repeat(20) }), { matches: false });
    assert.deepEqual(await invoke({ location: { ...request.location, objectName: 'other' } }), { matches: false });
    tx.tx_result.code = 1; assert.deepEqual(await invoke(), { matches: false }); tx.tx_result.code = 0;
    const changed = Uint8Array.from(bytes); changed[0] ^= 1; tx.tx = Buffer.from(changed).toString('base64');
    assert.deepEqual(await invoke(), { matches: false });
    await assert.rejects(invoke({ createTxHash: 'invalid' }), { code: 'INVALID_INPUT' });
  } finally { global.fetch = original; }
});

test('private reads enforce both declared and actual 4 MiB bytes and use storage ECDSA identity', async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024);
  let body = { size: bytes.length, arrayBuffer: async () => bytes.buffer };
  const api = client({ getObject: async (input, auth) => {
    assert.equal(input.objectName, request.location.objectName); assert.deepEqual(auth, { type: 'ECDSA', privateKey: 'test-key' });
    return { code: 0, body };
  } });
  assert.equal(Buffer.from((await perform({ ...request, op: 'read' }, api, 'test-key')).bytes, 'base64').length, bytes.length);
  body = { size: bytes.length + 1, arrayBuffer: async () => { assert.fail('oversize declared body'); } };
  await assert.rejects(perform({ ...request, op: 'read' }, api, 'test-key'), { code: 'STORAGE_UNAVAILABLE' });
  body = { size: 0, arrayBuffer: async () => new Uint8Array(bytes.length + 1).buffer };
  await assert.rejects(perform({ ...request, op: 'read' }, api, 'test-key'), { code: 'STORAGE_UNAVAILABLE' });
});

test('wrong network and Evidence size fail before object construction or broadcast', async () => {
  let creates = 0;
  const api = client({ createObject: async () => { creates++; throw new Error('must not create'); } });
  api.basic.getNodeInfo = async () => ({ defaultNodeInfo: { network: 'greenfield_1-1' } });
  await assert.rejects(perform({ ...request, op: 'create' }, api, 'test'), { code: 'WRONG_CHAIN' });
  api.basic.getNodeInfo = async () => ({ defaultNodeInfo: { network: 'greenfield_5600-1' } });
  for (const length of [0, 1048577]) await assert.rejects(perform({ ...request, op: 'create', bytes: Buffer.alloc(length).toString('base64') }, api, 'test'),
    { code: 'INVALID_INPUT' });
  assert.equal(creates, 0);
});

test('real pinned Reed-Solomon worker produces base64 checksum vectors without network or credentials', async () => {
  const { NodeAdapterReedSolomon } = require('@bnb-chain/reed-solomon/node.adapter');
  const checksums = await new NodeAdapterReedSolomon().encodeInSubWorker(new Uint8Array([123, 125]));
  // Pinned SDK version behavior for UTF-8 "{}"; not a live SP acceptance vector.
  assert.deepEqual(checksums, [
    'x08wCP3S98WuVEarLlImKfYzRvaKQCa09yuRs5NHX/Y=', '4VjgaelccMx/cp0NtganDgi/nVcS6LLsPZqQ8ZI0M1g=',
    'YfevTYEn+kDZmjhU6mnpgbk5tENpbdfQoxGyVmbIFbA=', 'FAbgWIHimTZ3ZtMT4mwFVk7JG/ch0xcmvW5G5gaJU5o=',
    'FAbgWIHimTZ3ZtMT4mwFVk7JG/ch0xcmvW5G5gaJU5o=', 'Wp6rkUg4k5Xv8FDd8AIg1yISPKhzbIYr8gAxY4mz9hE=',
    'vx1TXTDr9LfmOXIfqkdepuWohPZGiSkQE0fmZbkPzN0=',
  ]);
});

async function* chunks(bytes, size) {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}
test('request UTF-8 survives every split position and one-byte chunks for Korean/emoji paths', async () => {
  const value = { location: { objectName: '파트너/한글🙂/evidence.json' }, bytes: 'e30=' };
  const bytes = Buffer.from(JSON.stringify(value));
  for (let position = 1; position < bytes.length; position++) {
    const stream = (async function* () { yield bytes.subarray(0, position); yield bytes.subarray(position); })();
    assert.deepEqual(await readRequest(stream), value);
  }
  assert.deepEqual(await readRequest(chunks(bytes, 1)), value);
});
test('request limit remains 2 MiB UTF-16 string units rather than becoming a new byte limit', async () => {
  const maximum = 2 * 1024 * 1024, overhead = JSON.stringify({ padding: '' }).length;
  const value = { padding: '한'.repeat(maximum - overhead) }, bytes = Buffer.from(JSON.stringify(value));
  assert.ok(bytes.length > maximum);
  assert.deepEqual(await readRequest(chunks(bytes, 65536)), value);
  const tooLong = Buffer.concat([bytes, Buffer.from(' ')]);
  await assert.rejects(readRequest(chunks(tooLong, 65536)), { code: 'INVALID_INPUT' });
  const unfinished = Buffer.concat([bytes, Buffer.from([0xe2])]);
  await assert.rejects(readRequest(chunks(unfinished, 65536)), { code: 'INVALID_INPUT' });
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { perform, errorResponse, storageIdentity } = require('./worker.cjs');
const { BroadcastTxError } = require('@cosmjs/stargate');
const { ethers } = require('ethers');
const request = { chainId: '5600', address: '0x'+'11'.repeat(20), feeGranter: '',
  location: { storageType: 1, chainId: '5600', bucketName: 'test', objectName: 'prefix/evidence.json' }, bytes: Buffer.from('{}').toString('base64') };
const client = object => ({ basic: { getNodeInfo: async () => ({ defaultNodeInfo: { network: 'greenfield_5600-1' } }) }, object });
test('local INVALID_INPUT identifies the field and reason without echoing its value', async () => {
  await assert.rejects(perform({ ...request, op: 'upload', createTxHash: 'invalid-secret-hash' }, client({}), 'test'), error => {
    const response = errorResponse(error);
    assert.equal(response.code, 'INVALID_INPUT');
    assert.equal(response.message, 'INVALID_INPUT: createTxHash: must contain 64 hexadecimal digits with an optional 0x prefix');
    assert.equal(response.message.includes('secret'), false);
    return true;
  });
  await assert.rejects(perform({ ...request, op: 'create', bytes: '' }, client({}), 'test'), {
    code: 'INVALID_INPUT', message: 'INVALID_INPUT: evidenceBytes: must contain between 1 and 1048576 bytes'
  });
  await assert.rejects(perform({ ...request, op: 'unsupported' }, client({}), 'test'), {
    code: 'INVALID_INPUT', message: 'INVALID_INPUT: op: must be head, read, create, upload or verifyCreate'
  });
});
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
test('unsealed upload throws after one status check without polling or uploading again', async () => {
  let uploads = 0, heads = 0;
  await assert.rejects(perform({ ...request, op: 'upload', createTxHash: 'ab'.repeat(32) }, client({
    uploadObject: async () => { uploads++; return { code: 0 }; },
    headObject: async () => { heads++; return { objectInfo: { objectStatus: 0 } }; }
  }), 'test-only-key'), {
    code: 'OBJECT_UNSEALED',
    message: 'OBJECT_UNSEALED: objectStatus: must be SEALED after upload; automatic polling is disabled'
  });
  assert.equal(uploads, 1);
  assert.equal(heads, 1);
});
test('nonzero upstream response keeps its original code, message and data', async () => {
  const upstream = { code: 912, message: 'partner upload quota exceeded', requestId: 'request-123' };
  let calls = 0;
  await assert.rejects(perform({ ...request, op: 'upload', createTxHash: 'ab'.repeat(32) }, client({
    uploadObject: async () => { calls++; return upstream; }
  }), 'test-only-key'), error => {
    const response = errorResponse(error);
    assert.equal(response.code, 912);
    assert.equal(response.message, upstream.message);
    assert.deepEqual(response.data, upstream);
    assert.equal(calls, 1);
    return true;
  });
});
test('not-found is distinct from permissions and wrong chain blocks writes', async () => {
  const notFound = Object.assign(new Error('No such object'), { code: 'NoSuchObject' });
  let calls = 0;
  await assert.rejects(perform({ ...request, op: 'head' }, client({ headObject: async () => {
    calls++; throw notFound;
  } }), 'test'), error => error === notFound);
  assert.equal(calls, 1);
  await assert.rejects(perform({ ...request, op: 'head' }, client({ headObject: async () => { throw new Error('permission denied'); } }), 'test'));
  await assert.rejects(perform({ ...request, chainId: '1', op: 'create' }, client({}), 'test'), { code: 'WRONG_CHAIN' });
  assert.equal(errorResponse(new Error('permission denied')).message, 'permission denied');
  assert.equal(errorResponse(new Error('permission denied')).code, null);
});
test('builder rejection proves no broadcast and distinguishes unfunded account', async () => {
  let rejected;
  try { await perform({ ...request, op: 'create' }, client({ createObject: async () => { throw new Error('account 0x111 not found'); } }), 'test', async () => ['AA==']); }
  catch (error) { rejected=error; }
  assert.equal(rejected.definitelyNotBroadcast,true);
  assert.equal(errorResponse(rejected).message,'account 0x111 not found');
  assert.equal(errorResponse(rejected).code,null);
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
  assert.equal(errorResponse(rejected).code,4);
  assert.equal(errorResponse(rejected).codespace,'sdk');
  assert.match(errorResponse(rejected).message,/wrong number of signers/);
});
test('storage key accepts optional hex prefix and never changes wallet identity', () => {
  const testKey='0'.repeat(63)+'1';
  const address=new ethers.Wallet(testKey).address;
  assert.deepEqual(storageIdentity(testKey,address.toLowerCase()),{privateKey:'0x'+testKey,address});
  assert.deepEqual(storageIdentity('0x'+testKey,address),{privateKey:'0x'+testKey,address});
  assert.throws(()=>storageIdentity(testKey,request.address),{code:'STORAGE_ACCESS_DENIED'});
});
test('verifyCreate propagates chain execution errors instead of returning a mismatch', async () => {
  const previous = globalThis.fetch;
  const failure = { code: 5, log: 'original chain execution failure' };
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ result: { tx_result: failure } }) });
  try {
    await assert.rejects(perform({ ...request, op: 'verifyCreate', createTxHash: 'ab'.repeat(32) }, client({}), 'test'), error => {
      const response = errorResponse(error);
      assert.equal(response.code, 5);
      assert.equal(response.message, failure.log);
      assert.deepEqual(response.data, failure);
      return true;
    });
  } finally { globalThis.fetch = previous; }
});

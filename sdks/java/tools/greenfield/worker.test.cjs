'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { perform, normalizeError, storageIdentity } = require('./worker.cjs');
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

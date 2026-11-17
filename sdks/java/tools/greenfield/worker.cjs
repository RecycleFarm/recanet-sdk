'use strict';
// One request per process. Secrets arrive only through the dedicated environment variable.
const { Client, VisibilityType, RedundancyType, Long, bytesFromBase64 } = require('@bnb-chain/greenfield-js-sdk');
const { NodeAdapterReedSolomon } = require('@bnb-chain/reed-solomon/node.adapter');
const { ethers } = require('ethers');
const { TxRaw, TxBody } = require('@bnb-chain/greenfield-cosmos-types/cosmos/tx/v1beta1/tx');
const { MsgCreateObject } = require('@bnb-chain/greenfield-cosmos-types/greenfield/storage/tx');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { BroadcastTxError } = require('@cosmjs/stargate');
const fail = code => { throw Object.assign(new Error(code), { code }); };

function storageIdentity(rawKey, address) {
  const wallet = new ethers.Wallet(rawKey);
  if (wallet.address.toLowerCase() !== address.toLowerCase()) fail('STORAGE_ACCESS_DENIED');
  return { privateKey: wallet.privateKey, address: wallet.address };
}

async function perform(request, client, privateKey, encodeChecksums = async bytes =>
  new NodeAdapterReedSolomon().encodeInSubWorker(Uint8Array.from(bytes))) {
  const { op, location, createTxHash } = request;
  if (String(location.chainId) !== request.chainId || location.storageType !== 1) fail('WRONG_CHAIN');
  const network = (await client.basic.getNodeInfo()).defaultNodeInfo?.network;
  if (network !== `greenfield_${request.chainId}-1`) fail('WRONG_CHAIN');
  const { bucketName, objectName } = location;
  const auth = { type: 'ECDSA', privateKey };
  if (op === 'head') {
    try {
      const value = await client.object.headObject(bucketName, objectName);
      return { exists: Boolean(value.objectInfo), sealed: Number(value.objectInfo?.objectStatus) === 1 };
    } catch (error) {
      if (/No such object|object.*not found|not found.*object/i.test(error.message || '')) return { exists: false, sealed: false };
      throw error;
    }
  }
  if (op === 'read') {
    const result = await client.object.getObject({ bucketName, objectName }, auth);
    if (result.code !== 0 || !result.body) fail('STORAGE_UNAVAILABLE');
    if (result.body.size > 4 * 1024 * 1024) fail('STORAGE_UNAVAILABLE');
    const bytes = Buffer.from(await result.body.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) fail('STORAGE_UNAVAILABLE');
    return { bytes: bytes.toString('base64') };
  }
  if (op === 'create' || op === 'upload') {
    const bytes = Buffer.from(request.bytes, 'base64');
    if (!bytes.length || bytes.length > 1048576) fail('INVALID_INPUT');
    if (op === 'create') {
      let tx, fee, gas;
      try {
      const checksums = await encodeChecksums(bytes);
      // Greenfield's signer deduplication requires the canonical checksum form of the fee payer.
      const creator = ethers.utils.getAddress(request.address);
      tx = await client.object.createObject({ bucketName, objectName, creator,
        visibility: VisibilityType.VISIBILITY_TYPE_PRIVATE, contentType: 'application/json',
        redundancyType: RedundancyType.REDUNDANCY_EC_TYPE, payloadSize: Long.fromInt(bytes.length),
        expectChecksums: checksums.map(bytesFromBase64) });
      fee = await tx.simulate({ denom: 'BNB' });
      gas = Number(fee.gasLimit);
      if (!Number.isSafeInteger(gas) || gas <= 0) fail('GAS_ESTIMATION_FAILED');
      } catch (error) { error.definitelyNotBroadcast = true; throw error; }
      let receipt;
      try {
        receipt = await tx.broadcast({ denom: 'BNB', gasLimit: gas, gasPrice: String(fee.gasPrice),
          payer: ethers.utils.getAddress(request.address),
          granter: request.feeGranter ? ethers.utils.getAddress(request.feeGranter) : '', privateKey });
      } catch (error) {
        // Only a typed CheckTx rejection proves the transaction was not accepted.
        // Transport errors/timeouts remain ambiguous and must be reconciled.
        if (error instanceof BroadcastTxError) error.definitelyRejected = true;
        throw error;
      }
      if (Number(receipt.code || 0) !== 0 || !receipt.transactionHash) fail('STORAGE_UNAVAILABLE');
      return { createTxHash: receipt.transactionHash };
    }
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(createTxHash || '')) fail('INVALID_INPUT');
    const result = await client.object.uploadObject({ bucketName, objectName, txnHash: createTxHash,
      body: { name: objectName, type: 'application/json', size: bytes.length, content: bytes } }, auth);
    if (result.code !== 0) fail('STORAGE_UNAVAILABLE');
    // Polling is bounded. Timeout retains the same object/hash in the Java journal.
    for (let attempt = 0; attempt < 36; attempt++) {
      const head = await client.object.headObject(bucketName, objectName);
      if (Number(head.objectInfo?.objectStatus) === 1) return { sealed: true };
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    fail('OBJECT_UNSEALED');
  }
  if (op === 'verifyCreate') {
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(createTxHash || '')) fail('INVALID_INPUT');
    const hash = createTxHash.replace(/^0x/, '').toUpperCase();
    const response = await fetch(request.rpcUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tx', params: { hash: Buffer.from(hash, 'hex').toString('base64'), prove: false } }) });
    if (!response.ok) fail('STORAGE_UNAVAILABLE');
    const body = await response.json(); const tx = body.result;
    if (!tx || Number(tx.tx_result?.code || 0) !== 0) return { matches: false };
    const bytes = Buffer.from(tx.tx, 'base64');
    if (crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase() !== hash) return { matches: false };
    const messages = TxBody.decode(TxRaw.decode(bytes).bodyBytes).messages;
    return { matches: messages.some(m => {
      if (m.typeUrl !== '/greenfield.storage.MsgCreateObject') return false;
      const value = MsgCreateObject.decode(m.value);
      return value.bucketName === bucketName && value.objectName === objectName && value.creator.toLowerCase() === request.address.toLowerCase();
    }) };
  }
  fail('INVALID_INPUT');
}
function normalizeError(error) {
  const codes = new Set(['WRONG_CHAIN','INVALID_INPUT','STORAGE_ACCESS_DENIED','STORAGE_UNAVAILABLE','STORAGE_MISMATCH','OBJECT_UNSEALED','GAS_ESTIMATION_FAILED']);
  if (codes.has(error.code)) return error.code;
  if (/wrong number of signers|signer does not match|signature verification failed/i.test(error.message || '')) return 'SIGNATURE_INVALID';
  if (/account .*not found/i.test(error.message || '')) return 'STORAGE_ACCOUNT_UNFUNDED';
  if (/insufficient.*fund|insufficient.*balance/i.test(error.message || '')) return 'INSUFFICIENT_FUNDS';
  if (/permission|unauthori|forbidden|access.denied/i.test(error.message || '')) return 'STORAGE_ACCESS_DENIED';
  return 'STORAGE_UNAVAILABLE';
}
async function readRequest(stream) {
  const decoder = new StringDecoder('utf8');
  let text = '';
  for await (const chunk of stream) {
    text += decoder.write(chunk);
    if (text.length > 2 * 1024 * 1024) fail('INVALID_INPUT');
  }
  text += decoder.end();
  if (text.length > 2 * 1024 * 1024) fail('INVALID_INPUT');
  return JSON.parse(text);
}
async function main() {
  // SDK diagnostic output must not corrupt the stdout protocol or expose upstream data.
  console.log = console.warn = console.error = () => {};
  try {
    const request = await readRequest(process.stdin); const rawKey = process.env.GREENFIELD_STORAGE_PRIVATE_KEY;
    if (!rawKey) fail('STORAGE_ACCESS_DENIED');
    const { privateKey: key } = storageIdentity(rawKey, request.address);
    const data = await perform(request, Client.create(request.rpcUrl, request.chainId), key);
    process.stdout.write(JSON.stringify({ ok: true, data }), () => process.exit(0));
  } catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: normalizeError(error),
    definitelyNotBroadcast: error.definitelyNotBroadcast === true,
    definitelyRejected: error.definitelyRejected === true }), () => process.exit(0)); }
}
if (require.main === module) main();
module.exports = { perform, normalizeError, storageIdentity, readRequest };

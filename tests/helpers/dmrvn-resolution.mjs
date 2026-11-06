import { Wallet } from 'ethers';
import { DmrvnAbi, DmrvnCrypto, DmrvnProtocol } from '../../dist/index.js';
import { workflowFixture } from './dmrvn-workflow.mjs';
import { eventLog } from './dmrvn-events.mjs';

export async function resolutionFixture(sponsored = false) {
  const f = workflowFixture(), operation = 'operation-one', key = 'operation:' + operation;
  await f.prepare(); await f.client.approveClaim(operation);
  let forward, signature;
  if (sponsored) {
    const value = await f.client.prepareSponsored(operation, '100000'); forward = value.forwardRequest;
    const types = { ...value.types }; delete types.EIP712Domain;
    signature = await new Wallet('0x' + '00'.repeat(31) + '01').signTypedData(value.domain, types, forward);
    await f.client.recordSponsoredSignature(operation, forward, signature);
    // 합성 broadcast 사실. 실제 외부 전송은 수행하지 않는다.
    const state = await f.journal.load(key);
    state.submitFromBlock = 100; state.relay = f.wallet.address.toLowerCase(); state.phase = 'BROADCAST_INTENT';
    await f.journal.store(key, state);
    await f.journal.store(`relay-nonce:${f.config.chainId}:${f.wallet.address.toLowerCase()}`, { operationId: operation });
  } else await f.client.prepareSelfPaid(operation);
  const saved = await f.client.operation(operation), request = saved.approved.claimRequest;
  const hash = '0x' + 'cd'.repeat(32), target = sponsored ? f.forwarder : f.target;
  const sender = sponsored ? f.wallet.address.toLowerCase() : f.beneficiary;
  const claim = { ...request, approver: f.wallet.address.toLowerCase(), status: 1,
    evidenceLocationHash: DmrvnProtocol.evidenceLocationHash(request.evidenceLocation),
    outputHash: DmrvnCrypto.ZERO_BYTES32, reportHash: DmrvnCrypto.ZERO_BYTES32, requestedAt: '291', finalizedAt: '0' };
  const claimEvent = eventLog(DmrvnAbi.CLAIM, 'MrvClaimRequested', request, f.target, { transactionHash: hash });
  const executed = sponsored ? eventLog(DmrvnAbi.FORWARDER, 'ExecutedForwardRequest',
    { signer: forward.from, nonce: forward.nonce, success: true }, f.forwarder) : null;
  const receipt = { transactionHash: hash, blockNumber: '0x64', blockHash: f.state.blockHash, status: '0x1', to: target, from: sender,
    logs: executed ? [claimEvent, executed] : [claimEvent] };
  const tx = { hash, blockHash: f.state.blockHash, to: target, from: sender, value: '0x0', input: sponsored
    ? DmrvnProtocol.executeCalldata(forward, signature) : DmrvnProtocol.submitCalldata(saved.approved) };
  const observed = { claim, receipt, tx, logs: [claimEvent] }, observations = [];
  const call = f.rpc.call.bind(f.rpc);
  f.rpc.call = async (method, params, signal) => {
    observations.push({ method, params });
    if (method === 'eth_call' && params[0].to === f.target
      && params[0].data.startsWith(DmrvnAbi.CLAIM.topic('getClaim').slice(0, 10))) {
      return DmrvnAbi.encodeTuple(DmrvnAbi.CLAIM.outputs('getClaim'), { '': observed.claim });
    }
    if (method === 'eth_getTransactionReceipt') return observed.receipt;
    if (method === 'eth_getTransactionByHash') return observed.tx;
    if (method === 'eth_getLogs') return observed.logs;
    return call(method, params, signal);
  };
  return { ...f, operation, key, request, hash, observed, observations, forward, signature, claimEvent, executed };
}

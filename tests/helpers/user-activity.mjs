import { Wallet } from 'ethers';
import { DmrvnAbi, DmrvnClient, DmrvnCrypto, DmrvnProtocol } from '../../dist/index.js';
import { workflowFixture } from './dmrvn-workflow.mjs';
import { eventLog } from './dmrvn-events.mjs';

export function userActivityFixture(sharedJournal = true) {
  const f = workflowFixture(), user = new Wallet('0x' + '00'.repeat(31) + '01');
  if (!sharedJournal) f.client = new DmrvnClient(f.config, f.rpc, f.operator, f.storage, f.methodology);
  const facts = { walletCalls: 0, userSigns: 0, sends: 0, claimReads: 0, claimStatus: 1, confirmAfter: 0, sendError: null,
    submission: null, missingReceipt: false };
  const signer = { address: user.address, async signTypedData(value) { facts.userSigns++; const types = { ...value.types }; delete types.EIP712Domain;
    return user.signTypedData(value.domain, types, value.message); }, async signMessage() { throw new Error('not used'); },
    async sendTransaction() { throw new Error('not used'); } };
  const wallets = { async getOrCreateSigner(partnerId, userId) { facts.walletCalls++; facts.member = { partnerId, userId }; return signer; } };
  const hash = '0x' + 'cd'.repeat(32);
  f.operator.sendTransaction = async (_chain, tx) => {
    facts.sends++;
    const forward = DmrvnAbi.FORWARDER.decodeCall('execute', tx.data).request;
    const { request } = DmrvnAbi.CLAIM.decodeCall('submitClaim', forward.data);
    const claimEvent = eventLog(DmrvnAbi.CLAIM, 'MrvClaimRequested', request, f.target);
    const executed = eventLog(DmrvnAbi.FORWARDER, 'ExecutedForwardRequest', { signer: forward.from, nonce: f.state.forwardNonce, success: true }, f.forwarder);
    facts.submission = { request, tx: { ...tx, input: tx.data, hash, blockHash: f.state.blockHash },
      receipt: { transactionHash: hash, blockNumber: '0x64', blockHash: f.state.blockHash, status: '0x1', to: tx.to, from: tx.from,
        logs: [claimEvent, executed] } };
    if (facts.sendError) throw facts.sendError;
    return hash;
  };
  const call = f.rpc.call.bind(f.rpc);
  f.rpc.call = async (method, params, signal) => {
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_gasPrice') return '0xa';
    if (method === 'eth_getBalance') return '0xffffffffff';
    if (method === 'eth_getTransactionCount') return '0x3';
    if (method === 'eth_call' && params[1] === 'pending') return '0x';
    if (method === 'eth_call' && params[0].to === f.forwarder && params[0].data.startsWith(DmrvnAbi.FORWARDER.topic('verify').slice(0, 10))) {
      return f.result(DmrvnAbi.FORWARDER, 'verify', { '': true });
    }
    if (method === 'eth_call' && params[0].to === f.target && params[0].data.startsWith(DmrvnAbi.CLAIM.topic('getClaim').slice(0, 10))) {
      facts.claimReads++;
      const request = facts.submission.request;
      return f.result(DmrvnAbi.CLAIM, 'getClaim', { '': { ...request,
        status: facts.claimReads <= facts.confirmAfter ? 0 : facts.claimStatus, approver: f.wallet.address,
        evidenceLocationHash: DmrvnProtocol.evidenceLocationHash(request.evidenceLocation), outputHash: DmrvnCrypto.ZERO_BYTES32,
        reportHash: DmrvnCrypto.ZERO_BYTES32, requestedAt: '291', finalizedAt: '0' } });
    }
    if (method === 'eth_getTransactionReceipt') return facts.missingReceipt ? null : facts.submission.receipt;
    if (method === 'eth_getTransactionByHash') return facts.submission.tx;
    return call(method, params, signal);
  };
  return { ...f, facts, wallets, signer, hash };
}

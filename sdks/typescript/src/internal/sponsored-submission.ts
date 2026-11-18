import { DmrvnAbi } from '../dmrvn-abi.js';
import { DmrvnChain } from '../dmrvn-chain.js';
import { bytes32, normalizeAddress, recover, textHash, uint } from '../dmrvn-crypto.js';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnProtocol } from '../dmrvn-protocol.js';
import { DmrvnError } from '../errors.js';
import { approvedState, verifyBeforeSubmission } from './claim-approval.js';
import { copyState, operationKey, OperationContext, requireState, stateMap, stateString } from './dmrvn-state.js';
import { persistSignature } from './submission-preparation.js';
import { resolveLocked } from './submission-resolution.js';

/** 완성 거래와 intent를 먼저 저장하고 한 번만 send한다. 이후에는 원래 거래 조회만 허용한다. */
export async function submitSponsored(context: OperationContext, operationId: string, forwardRequest: Readonly<Record<string, unknown>>,
  userSignature: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const key = operationKey(operationId), forward = copyState(forwardRequest);
  const fingerprint = DmrvnJson.hash({ forwardRequest: forward, userSignature });
  const { config, journal, chain, operator } = context;
  return journal.withLock(key, async () => {
    const state = await approvedState(context, key);
    requireState(state.submissionMode === 'SPONSORED' && Object.hasOwn(state, 'sponsored'), 'OPERATION_NOT_PREPARED');
    requireState(DmrvnJson.hash(forward) === DmrvnJson.hash(stateMap(state.sponsored).forwardRequest), 'SUBMISSION_INPUT_CHANGED');
    if (Object.hasOwn(state, 'submissionFingerprint')) requireState(state.submissionFingerprint === fingerprint, 'SUBMISSION_INPUT_CHANGED');
    if (Object.hasOwn(state, 'submitFromBlock')) {
      const result = await resolveLocked(context, key, state, null, signal);
      requireState(result !== null, 'SUBMISSION_UNRESOLVED');
      return result;
    }
    await context.verifyState(key, state, true, signal);
    await verifyBeforeSubmission(context, state, signal);
    const digest = DmrvnProtocol.digest('ForwardRequest', DmrvnProtocol.domain(config.chainId, config.forwarderAddress, true), forward);
    requireState(recover(digest, userSignature) === normalizeAddress(stateString(forward.from)), 'SIGNATURE_INVALID');
    requireState(await chain.nonce(stateString(forward.from), true, signal) === uint(forward.nonce, 256), 'NONCE_CONFLICT');
    const call = copyState(forward); delete call.nonce; call.signature = userSignature;
    requireState((await chain.contract(DmrvnAbi.FORWARDER, config.forwarderAddress, 'verify', { request: call }, 'latest', signal))[''] === true,
      'SIGNATURE_INVALID');
    await persistSignature(context, key, state, forward, userSignature, digest);
    return journal.withLock(context.relayKey(), async () => {
      const reservation = await journal.load(context.relayKey());
      requireState(reservation === null || Object.keys(reservation).length === 0 || reservation.operationId === operationId, 'NONCE_CONFLICT');
      const sender = normalizeAddress(operator.address);
      const estimate = { from: sender, to: config.forwarderAddress, value: '0x0',
        data: DmrvnProtocol.executeCalldata(forward, userSignature) };
      const gas = DmrvnChain.number(await chain.call('eth_estimateGas', [estimate], signal)) * 130n / 100n;
      const price = DmrvnChain.number(await chain.call('eth_gasPrice', [], signal)), cost = gas * price;
      requireState(cost <= config.maxRelayCostWei, 'INSUFFICIENT_FUNDS');
      requireState(DmrvnChain.number(await chain.call('eth_getBalance', [sender, 'pending'], signal)) >= cost, 'INSUFFICIENT_FUNDS');
      const nonce = DmrvnChain.number(await chain.call('eth_getTransactionCount', [sender, 'pending'], signal));
      requireState(nonce === DmrvnChain.number(await chain.call('eth_getTransactionCount', [sender, 'latest'], signal)), 'NONCE_CONFLICT');
      const tx = Object.assign(estimate, { gas: DmrvnChain.quantity(gas), gasPrice: DmrvnChain.quantity(price), nonce: DmrvnChain.quantity(nonce) });
      await chain.call('eth_call', [tx, 'pending'], signal);
      await context.reserve(context.relayKey(), operationId);
      state.forwardRequest = forward; state.userSignature = userSignature; state.forwardDigest = digest; state.submissionFingerprint = fingerprint;
      state.submitFromBlock = await chain.head(signal); state.phase = 'BROADCAST_INTENT'; state.relay = sender; state.relayTransaction = tx;
      if (!Object.hasOwn(state, 'relayIdempotencyKey')) state.relayIdempotencyKey = textHash(config.deploymentId() + ':' + operationId + ':' + fingerprint);
      await context.save(key, state);
      try {
        const hash = await operator.sendTransaction(config.chainId, DmrvnJson.copy(tx) as typeof tx,
          stateString(state.relayIdempotencyKey), signal);
        state.txHash = bytes32(hash); state.phase = 'SUBMITTED'; await context.save(key, state);
        return { operationId, deploymentId: config.deploymentId(), claimId: state.claimId, txHash: hash, status: 'BROADCAST', recovered: false };
      } catch { throw new DmrvnError('SUBMISSION_UNRESOLVED'); }
    });
  });
}

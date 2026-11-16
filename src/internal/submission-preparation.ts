import { normalizeAddress, recover, uint } from '../dmrvn-crypto.js';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnProtocol } from '../dmrvn-protocol.js';
import { approvedState, verifyBeforeSubmission } from './claim-approval.js';
import { copyState, operationKey, OperationContext, requireState, stateMap, stateString } from './dmrvn-state.js';

export async function prepareSponsored(context: OperationContext, operationId: string, gas: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const key = operationKey(operationId), gasValue = uint(stateString(gas), 256);
  requireState(gasValue >= 100000n && gasValue <= 2000000n, 'INVALID_INPUT');
  return context.journal.withLock(key, async () => {
    const state = await approvedState(context, key);
    await context.verifyState(key, state, true, signal);
    requireState(state.submissionMode !== 'SELF_PAID', 'SUBMISSION_INPUT_CHANGED');
    if (Object.hasOwn(state, 'sponsored')) {
      const existing = stateMap(state.sponsored);
      requireState(stateMap(existing.forwardRequest).gas === gas, 'SUBMISSION_INPUT_CHANGED');
      return copyState(existing);
    }
    const approved = stateMap(state.approved), request = stateMap(approved.claimRequest);
    await verifyBeforeSubmission(context, state, signal);
    const forward = { from: request.beneficiary, to: context.config.claimAddress, value: '0', gas,
      nonce: (await context.chain.nonce(stateString(request.beneficiary), true, signal)).toString(), deadline: request.deadline,
      data: DmrvnProtocol.submitCalldata(approved) };
    const domain = DmrvnProtocol.domain(context.config.chainId, context.config.forwarderAddress, true);
    const typed = DmrvnProtocol.typedData('ForwardRequest', domain, forward);
    const result = { forwardRequest: forward, domain, types: typed.types, primaryType: 'ForwardRequest',
      forwardDigest: DmrvnProtocol.digest('ForwardRequest', domain, forward) };
    state.sponsored = result; state.submissionMode = 'SPONSORED'; await context.save(key, state);
    return copyState(result);
  });
}

/** 앱에 calldata를 노출하기 전에 전송 intent를 저장한다. */
export async function prepareSelfPaid(context: OperationContext, operationId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const key = operationKey(operationId);
  return context.journal.withLock(key, async () => {
    const state = await approvedState(context, key);
    await context.verifyState(key, state, true, signal);
    requireState(state.submissionMode !== 'SPONSORED', 'SUBMISSION_INPUT_CHANGED');
    if (!Object.hasOwn(state, 'submitFromBlock')) {
      await verifyBeforeSubmission(context, state, signal);
      state.submissionMode = 'SELF_PAID'; state.submitFromBlock = await context.chain.head(signal); state.phase = 'BROADCAST_INTENT';
      await context.save(key, state);
    }
    return { chainId: context.config.chainId, to: context.config.claimAddress, value: '0', data: DmrvnProtocol.submitCalldata(stateMap(state.approved)) };
  });
}

export async function persistSignature(context: OperationContext, key: string, state: Record<string, unknown>,
  forward: Record<string, unknown>, signature: string, digest: string): Promise<void> {
  const fingerprint = DmrvnJson.hash({ forwardRequest: forward, userSignature: signature });
  requireState(!Object.hasOwn(state, 'submissionFingerprint') || state.submissionFingerprint === fingerprint, 'SUBMISSION_INPUT_CHANGED');
  state.forwardRequest = forward; state.userSignature = signature; state.forwardDigest = digest; state.submissionFingerprint = fingerprint;
  await context.save(key, state);
}

export async function recordSponsoredSignature(context: OperationContext, operationId: string, forwardRequest: Readonly<Record<string, unknown>>,
  userSignature: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const key = operationKey(operationId), forward = copyState(forwardRequest);
  return context.journal.withLock(key, async () => {
    const state = await approvedState(context, key);
    requireState(state.submissionMode === 'SPONSORED', 'OPERATION_NOT_PREPARED');
    requireState(!Object.hasOwn(state, 'submitFromBlock'), 'SUBMISSION_UNRESOLVED');
    requireState(DmrvnJson.hash(forward) === DmrvnJson.hash(stateMap(state.sponsored).forwardRequest), 'SUBMISSION_INPUT_CHANGED');
    await context.verifyState(key, state, true, signal);
    await verifyBeforeSubmission(context, state, signal);
    const digest = DmrvnProtocol.digest('ForwardRequest', DmrvnProtocol.domain(context.config.chainId, context.config.forwarderAddress, true), forward);
    requireState(recover(digest, userSignature) === normalizeAddress(stateString(forward.from)), 'SIGNATURE_INVALID');
    requireState(await context.chain.nonce(stateString(forward.from), true, signal) === uint(forward.nonce, 256), 'NONCE_CONFLICT');
    await persistSignature(context, key, state, forward, userSignature, digest);
    return { forwardRequest: copyState(forward), userSignature, forwardDigest: digest, deployment: copyState(state.deployment) };
  });
}

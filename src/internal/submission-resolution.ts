import { DmrvnAbi } from '../dmrvn-abi.js';
import { DmrvnChain } from '../dmrvn-chain.js';
import { bytes32, normalizeAddress, recover, uint } from '../dmrvn-crypto.js';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnProtocol } from '../dmrvn-protocol.js';
import { chainNumber } from './chain-id.js';
import { approvedState, beneficiaryKey } from './claim-approval.js';
import { copyState, operationKey, OperationContext, requireState, stateMap, stateString } from './dmrvn-state.js';

const same = (a: unknown, b: unknown): boolean => String(a).toLowerCase() === String(b).toLowerCase();

/** 조회만 수행한다. 만료·현재 역할·nonce를 요구하거나 재서명/재전송하지 않는다. */
export async function resolveSubmission(context: OperationContext, operationId: string, txHash?: string | null,
  signal?: AbortSignal): Promise<Record<string, unknown>> {
  const key = operationKey(operationId);
  return context.journal.withLock(key, async () => {
    const state = await approvedState(context, key);
    requireState(Object.hasOwn(state, 'submitFromBlock'), 'OPERATION_NOT_PREPARED');
    const result = await resolveLocked(context, key, state, txHash ?? null, signal);
    requireState(result !== null, 'SUBMISSION_UNRESOLVED');
    return result;
  });
}

export async function resolveLocked(context: OperationContext, key: string, state: Record<string, unknown>, suppliedHash: string | null,
  signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const { config, chain } = context;
  await context.verifyState(key, state, false, signal);
  const head = await chain.confirmedHead(signal);
  const approved = stateMap(state.approved), request = stateMap(approved.claimRequest), id = stateString(request.claimId);
  let hash = suppliedHash !== null ? bytes32(suppliedHash) : state.txHash == null ? null : stateString(state.txHash);
  if (Object.hasOwn(state, 'txHash') && hash !== null) requireState(same(hash, stateString(state.txHash)), 'SUBMISSION_INPUT_CHANGED');
  const claim = await chain.claim(id, head, signal);
  if (String(claim.status) === '0') return null;
  for (const field of ['partnerId', 'activityId', 'methodologyId', 'methodologyVersion', 'evidenceHash', 'methodologyHash']) {
    requireState(String(request[field]) === String(claim[field]), 'SUBMISSION_INPUT_CHANGED');
  }
  requireState(normalizeAddress(stateString(request.beneficiary)) === normalizeAddress(stateString(claim.beneficiary)), 'SUBMISSION_INPUT_CHANGED');
  const signer = recover(DmrvnProtocol.digest('ClaimRequest', DmrvnProtocol.domain(config.chainId, config.claimAddress), request),
    stateString(approved.approvalSignature));
  requireState(signer === normalizeAddress(stateString(claim.approver))
    && DmrvnProtocol.evidenceLocationHash(stateMap(request.evidenceLocation)) === claim.evidenceLocationHash
    && DmrvnJson.hash(request.evidenceLocation) === DmrvnJson.hash(claim.evidenceLocation), 'SUBMISSION_INPUT_CHANGED');
  DmrvnProtocol.verifyProvenance(stateMap(state.evidence), stateString(claim.evidenceHash), stateString(claim.approver));
  if (hash === null) hash = await chain.findTransaction('MrvClaimRequested', id, chainNumber(state.submitFromBlock as bigint | number), head,
    'nonce', stateString(request.nonce), signal);
  if (hash === null) return null;
  const receipt = await chain.receipt(hash, head, signal);
  if (receipt === null) return null;
  requireState(DmrvnChain.number(receipt.status) === 1n, 'SUBMISSION_INPUT_CHANGED');
  const raw = await chain.call('eth_getTransactionByHash', [hash], signal);
  if (raw === null) return null;
  const tx = stateMap(raw);
  requireState(same(hash, stateString(tx.hash)) && tx.blockHash === receipt.blockHash, 'SUBMISSION_INPUT_CHANGED');
  const event = chain.event('MrvClaimRequested', receipt, id);
  requireState(event !== null && String(event.nonce) === String(request.nonce), 'SUBMISSION_INPUT_CHANGED');
  for (const field of ['beneficiary', 'partnerId', 'activityId', 'methodologyId', 'methodologyVersion', 'methodologyHash', 'evidenceHash']) {
    requireState(same(event[field], request[field]), 'SUBMISSION_INPUT_CHANGED');
  }
  const sponsored = state.submissionMode === 'SPONSORED';
  const target = sponsored ? config.forwarderAddress : config.claimAddress;
  const sender = sponsored ? stateString(state.relay) : stateString(request.beneficiary);
  const data = sponsored ? DmrvnProtocol.executeCalldata(stateMap(state.forwardRequest), stateString(state.userSignature))
    : DmrvnProtocol.submitCalldata(approved);
  requireState(same(target, stateString(receipt.to)) && same(target, stateString(tx.to))
    && same(sender, stateString(receipt.from)) && same(sender, stateString(tx.from))
    && same(data, stateString(tx.input)) && DmrvnChain.number(tx.value) === 0n, 'SUBMISSION_INPUT_CHANGED');
  if (sponsored) {
    let found = false;
    requireState(Array.isArray(receipt.logs), 'INVALID_INPUT');
    for (const rawLog of receipt.logs) {
      const log = stateMap(rawLog);
      if (!same(config.forwarderAddress, log.address)) continue;
      requireState(Array.isArray(log.topics), 'INVALID_INPUT');
      if (log.topics.length === 0 || DmrvnAbi.FORWARDER.topic('ExecutedForwardRequest') !== log.topics[0]) continue;
      const executed = DmrvnAbi.FORWARDER.decodeEvent('ExecutedForwardRequest', log), forward = stateMap(state.forwardRequest);
      if (same(stateString(executed.signer), stateString(forward.from)) && String(executed.nonce) === forward.nonce && executed.success === true) found = true;
    }
    requireState(found, 'SUBMISSION_INPUT_CHANGED');
  }
  state.txHash = hash; state.receipt = receipt; state.phase = 'SUBMITTED'; state.submissionStatus = 'CONFIRMED';
  const status = Number(uint(claim.status, 8));
  requireState(status >= 1 && status <= 4, 'SUBMISSION_INPUT_CHANGED');
  state.chainStatus = ['NONE', 'PENDING', 'VALID', 'INVALID', 'REVOKED'][status];
  await context.save(key, state);
  await context.release(beneficiaryKey(context, stateString(request.beneficiary)), stateString(state.operationId));
  if (sponsored) await context.release(context.relayKey(), stateString(state.operationId));
  return copyState({ operationId: state.operationId, deploymentId: config.deploymentId(), deployment: state.deployment,
    verifiedMetadata: state.verifiedMetadata, claimId: id, txHash: hash, receipt, claim, status: 'CONFIRMED', recovered: true });
}

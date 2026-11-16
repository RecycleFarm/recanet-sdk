import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ActivityRequest } from '../activity-request.js';
import type { ActivityOutcome, ActivityStage } from '../activity-outcome.js';
import { normalizeAddress, textHash } from '../dmrvn-crypto.js';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnError, PrivyApiError, type DmrvnErrorCode } from '../errors.js';
import { submitActivity } from './activity-submission.js';
import { copyState, operationKey, OperationContext, stateString } from './dmrvn-state.js';
import { resolveSubmission } from './submission-resolution.js';
import type { BeneficiaryWallets } from './wallets.js';

function confirmedStage(state: Record<string, unknown>, fallback: ActivityStage): ActivityStage {
  if (state.submissionStatus === 'CONFIRMED') return 'SUBMISSION_CONFIRMED';
  const stages = { txHash: 'SUBMISSION_BROADCAST', userSignature: 'BENEFICIARY_SIGNED', approved: 'CLAIM_APPROVED', upload: 'EVIDENCE_SEALED',
    createTxHash: 'EVIDENCE_CREATE_BROADCAST', evidence: 'EVIDENCE_SIGNED' } as const;
  for (const [key, stage] of Object.entries(stages)) if (Object.hasOwn(state, key)) return stage;
  return fallback;
}
function addConfirmedFacts(known: Record<string, unknown>, state: Record<string, unknown> | null): void {
  if (state === null) return;
  if (Object.hasOwn(state, 'evidence')) known.evidenceHash = DmrvnJson.hash(state.evidence);
  if (Object.hasOwn(state, 'createTxHash')) known.createTxHash = state.createTxHash;
  if (state.objectExists === true || Object.hasOwn(state, 'upload')) known.evidenceLocation = copyState(state.evidenceLocation);
  if (Object.hasOwn(state, 'upload')) known.storageStatus = 'SEALED';
  if (Object.hasOwn(state, 'submitFromBlock')) known.submissionFromBlock = state.submitFromBlock;
  for (const key of ['txHash', 'chainStatus']) if (Object.hasOwn(state, key)) known[key] = state[key];
  if (Object.hasOwn(state, 'receipt')) known.receipt = copyState(state.receipt);
}

/** 새 호출은 새 operation이다. 공유 journal도 기존 작업의 자동 탐색/재개로 해석하지 않는다. */
export async function submitUserActivity(context: OperationContext, wallets: BeneficiaryWallets, request: ActivityRequest,
  signal?: AbortSignal): Promise<ActivityOutcome> {
  if (!wallets || !(request instanceof ActivityRequest)) throw new TypeError('wallets와 ActivityRequest가 필요합니다');
  const { config, methodology } = context, operationId = randomUUID();
  const claimId = request.claimId ?? textHash(config.deploymentId() + ':' + operationId);
  const objectName = request.objectName ?? `${config.objectPrefix}activities/${methodology.activityId()}/${operationId}/evidence.json`;
  const run = context.fork();
  const known: Record<string, unknown> = { deploymentId: config.deploymentId(), chainId: config.chainId, claimAddress: config.claimAddress,
    claimId, operationId, sourceEventId: request.sourceEventId };
  const requested = { evidenceLocation: { storageType: 1, chainId: config.greenfieldChainId, bucketName: config.bucketName, objectName } };
  let stage: ActivityStage = 'REQUEST_ACCEPTED';
  try {
    config.checkObject(objectName); methodology.requireExplicitEvidenceVersion();
    const user = await wallets.getOrCreateSigner(config.partnerId, request.userId, signal);
    if (user == null) throw new Error('회원 서명자 없음');
    known.beneficiary = normalizeAddress(user.address); stage = 'BENEFICIARY_READY';
    const body = methodology.evidenceBody(config.partnerId, user.address, request.sourceEventId, request.inputs);
    let sent = await submitActivity(run, user, operationId, claimId, objectName, body, request.gas, signal);
    if (sent.status !== 'CONFIRMED') {
      const until = performance.now() + request.confirmationTimeoutMs;
      while (true) {
        try { sent = await resolveSubmission(run, operationId, stateString(sent.txHash), signal); break; }
        catch (error) {
          if (!(error instanceof DmrvnError) || error.code !== 'SUBMISSION_UNRESOLVED') throw error;
          const remaining = until - performance.now();
          if (remaining <= 0) throw error;
          try { await sleep(Math.min(remaining, request.pollIntervalMs), undefined, signal ? { signal } : undefined); }
          catch { throw new DmrvnError('INTERRUPTED'); }
        }
      }
    }
    addConfirmedFacts(known, run.observation(operationKey(operationId)));
    return { outcome: 'CONFIRMED', lastConfirmedStage: 'SUBMISSION_CONFIRMED', confirmed: known, requested };
  } catch (error) {
    const state = run.observation(operationKey(operationId));
    let code: DmrvnErrorCode = error instanceof DmrvnError ? error.code
      : error instanceof TypeError || error instanceof RangeError ? 'INVALID_INPUT' : 'RPC_UNAVAILABLE';
    let uncertain = code === 'SUBMISSION_UNRESOLVED' || code === 'STORAGE_CREATE_UNRESOLVED'
      || (stage === 'REQUEST_ACCEPTED' && (code === 'RPC_UNAVAILABLE' || code === 'INTERRUPTED'));
    if (error instanceof PrivyApiError) {
      code = error.code === 'INVALID_CREDENTIALS' || error.code === 'FORBIDDEN' ? 'UNAUTHORIZED_SIGNER'
        : error.code === 'INTERRUPTED' ? 'INTERRUPTED' : 'RPC_UNAVAILABLE';
      uncertain = stage === 'REQUEST_ACCEPTED' && ['UNAVAILABLE', 'INVALID_RESPONSE', 'INTERRUPTED'].includes(error.code);
    }
    if (state !== null) {
      addConfirmedFacts(known, state); stage = confirmedStage(state, stage);
      uncertain = Object.hasOwn(state, 'submitFromBlock') || (Object.hasOwn(state, 'createIntent') && !Object.hasOwn(state, 'upload'));
    }
    return { outcome: stage === 'SUBMISSION_CONFIRMED' ? 'CONFIRMED' : uncertain ? 'UNKNOWN' : 'FAILED',
      lastConfirmedStage: stage, confirmed: known, requested, errorCode: code };
  }
}

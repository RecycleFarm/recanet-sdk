import type { DmrvnReader } from '../dmrvn-reader.js';
import { DmrvnProtocol } from '../dmrvn-protocol.js';
import { DmrvnError } from '../errors.js';
import { copyState, operationKey, OperationContext, requireState, stateMap, stateString } from './dmrvn-state.js';

/** 보고서 오류도 관찰 결과로 보존한다. 제출 확인/nonce 예약 해제를 대신하지 않는다. */
export async function readOperationResult(context: OperationContext, operationId: string, reader: DmrvnReader,
  fromBlock?: bigint | number | null, reportTxHash?: string | null, waitTimedOut = false, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const key = operationKey(operationId);
  return context.journal.withLock(key, async () => {
    const state = await context.required(key);
    await context.verifyState(key, state, false, signal);
    const hash = reportTxHash ?? (state.reportTxHash == null ? null : stateString(state.reportTxHash));
    let result: Record<string, unknown>;
    try { result = await reader.readResult(stateString(state.claimId), fromBlock, hash, waitTimedOut, null, signal); }
    catch (error) {
      if (error instanceof DmrvnError && (error.code === 'DEPLOYMENT_NOT_READY' || error.code === 'UNAPPROVED_IMPLEMENTATION')) {
        delete state.verifiedMetadata; state.ready = false; state.deploymentError = error.code; await context.save(key, state);
      }
      throw error;
    }
    requireState(result.deploymentId === context.config.deploymentId(), 'WRONG_CHAIN');
    const claim = stateMap(result.claim);
    if (String(claim.status) !== '0') {
      DmrvnProtocol.verifyProvenance(stateMap(state.evidence), stateString(claim.evidenceHash), stateString(claim.approver));
      result.provenanceVerified = true;
    }
    state.verifiedMetadata = result.verifiedMetadata;
    result.deployment = copyState(state.deployment); state.result = result;
    if (Object.hasOwn(result, 'reportTxHash')) state.reportTxHash = result.reportTxHash;
    await context.save(key, state);
    return result;
  });
}

import { diagnosticOperation, diagnosticSubmission, diagnosticTranslated } from '../diagnostics.js';
import { normalizeAddress, uint } from '../dmrvn-crypto.js';
import { DmrvnProtocol } from '../dmrvn-protocol.js';
import type { EvmSigner } from '../evm-signer.js';
import { approveClaim } from './claim-approval.js';
import { copyState, operationKey, OperationContext, requireState, stateMap, stateString } from './dmrvn-state.js';
import { prepareEvidence } from './evidence.js';
import { submitSponsored } from './sponsored-submission.js';
import { prepareSponsored, recordSponsoredSignature } from './submission-preparation.js';

/** 같은 operation의 서명·전송 조합을 직렬화한다. 최초 broadcast 후 자동 polling하지 않는다. */
export async function submitActivity(context: OperationContext, userSigner: EvmSigner, operationId: string, claimId: string,
  objectName: string, evidenceBody: Readonly<Record<string, unknown>>, gas: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return diagnosticOperation('activity-submission.submitActivity', operationId, async () => {
    if (!userSigner) throw new TypeError('beneficiary 서명자가 필요합니다');
    const key = operationKey(operationId), gasValue = uint(stateString(gas), 256);
    requireState(gasValue >= 100000n && gasValue <= 2000000n, 'INVALID_INPUT');
    const body = copyState(evidenceBody), beneficiary = normalizeAddress(userSigner.address);
    return context.journal.withLock('activity:' + key, async () => {
      const state = await prepareEvidence(context, operationId, claimId, beneficiary, objectName, body, signal);
      let signingRequest: Record<string, unknown>;
      if (Object.hasOwn(state, 'submitFromBlock')) {
        requireState(state.submissionMode === 'SPONSORED', 'SUBMISSION_INPUT_CHANGED');
        signingRequest = stateMap(state.sponsored);
        requireState(stateMap(signingRequest.forwardRequest).gas === gas, 'SUBMISSION_INPUT_CHANGED');
      } else {
        await approveClaim(context, operationId, signal);
        signingRequest = await prepareSponsored(context, operationId, gas, signal);
      }
      const forward = stateMap(signingRequest.forwardRequest);
      let signature = state.userSignature == null ? null : stateString(state.userSignature);
      if (signature === null) {
        requireState(!Object.hasOwn(state, 'submitFromBlock'), 'SUBMISSION_UNRESOLVED');
        signature = await userSigner.signTypedData(DmrvnProtocol.typedData('ForwardRequest', stateMap(signingRequest.domain), forward), signal);
        await recordSponsoredSignature(context, operationId, forward, signature, signal);
      }
      return submitSponsored(context, operationId, forward, signature, signal);
    });
  });
}

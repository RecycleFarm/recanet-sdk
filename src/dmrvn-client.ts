import type { DeclaredMethodology } from './declared-methodology.js';
import type { DmrvnConfig } from './dmrvn-config.js';
import { DmrvnPreflight, type DmrvnPreflightResult } from './dmrvn-preflight.js';
import type { EvmRpc } from './evm-rpc.js';
import type { EvmSigner } from './evm-signer.js';
import type { GreenfieldStorage } from './greenfield-storage.js';
import type { OperationJournal } from './operation-journal.js';
import { OperationContext, copyState, operationKey } from './internal/dmrvn-state.js';
import { prepareEvidence, recoverCreateTransaction } from './internal/evidence.js';
import { approveClaim } from './internal/claim-approval.js';
import { prepareSelfPaid, prepareSponsored, recordSponsoredSignature } from './internal/submission-preparation.js';
import { resolveSubmission } from './internal/submission-resolution.js';
import { submitSponsored } from './internal/sponsored-submission.js';
import { submitActivity } from './internal/activity-submission.js';

/** DMRVN 단계 API. 영속 journal·재시작 복구와 외부 권한은 소비자가 제공한다. */
export class DmrvnClient {
  #context: OperationContext;
  #preflight: DmrvnPreflight;
  constructor(config: DmrvnConfig, rpc: EvmRpc, operator: EvmSigner, storage: GreenfieldStorage,
    methodology: DeclaredMethodology, journal?: OperationJournal) {
    this.#preflight = new DmrvnPreflight(config, rpc, operator, storage, methodology);
    this.#context = new OperationContext(config, rpc, operator, storage, methodology, journal);
  }
  preflight(signal?: AbortSignal): Promise<DmrvnPreflightResult> { return this.#preflight.run(signal); }
  prepareEvidence(operationId: string, claimId: string, beneficiary: string, objectName: string,
    body: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return prepareEvidence(this.#context, operationId, claimId, beneficiary, objectName, body, signal);
  }
  recoverCreateTransaction(operationId: string, hash: string, signal?: AbortSignal): Promise<void> {
    return recoverCreateTransaction(this.#context, operationId, hash, signal);
  }
  approveClaim(operationId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return approveClaim(this.#context, operationId, signal);
  }
  prepareSponsored(operationId: string, gas: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return prepareSponsored(this.#context, operationId, gas, signal);
  }
  prepareSelfPaid(operationId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return prepareSelfPaid(this.#context, operationId, signal);
  }
  resolveSubmission(operationId: string, txHash?: string | null, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return resolveSubmission(this.#context, operationId, txHash, signal);
  }
  submitSponsored(operationId: string, forwardRequest: Readonly<Record<string, unknown>>, signature: string,
    signal?: AbortSignal): Promise<Record<string, unknown>> {
    return submitSponsored(this.#context, operationId, forwardRequest, signature, signal);
  }
  submitActivity(userSigner: EvmSigner, operationId: string, claimId: string, objectName: string,
    body: Readonly<Record<string, unknown>>, gas: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return submitActivity(this.#context, userSigner, operationId, claimId, objectName, body, gas, signal);
  }
  recordSponsoredSignature(operationId: string, forwardRequest: Readonly<Record<string, unknown>>, signature: string,
    signal?: AbortSignal): Promise<Record<string, unknown>> {
    return recordSponsoredSignature(this.#context, operationId, forwardRequest, signature, signal);
  }
  /** Evidence 저장과 파트너 승인만 수행한다. */
  async prepare(operationId: string, claimId: string, beneficiary: string, objectName: string,
    body: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    await this.prepareEvidence(operationId, claimId, beneficiary, objectName, body, signal);
    return this.approveClaim(operationId, signal);
  }
  /** journal의 기존 사실만 읽는다. 잠금·외부 체인 재조회는 하지 않는다. */
  async operation(operationId: string): Promise<Record<string, unknown>> {
    return copyState(await this.#context.required(operationKey(operationId)));
  }
}

import { diagnosticOperation, diagnosticPartner } from './diagnostics.js';
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
import { ActivityRequest } from './activity-request.js';
import type { ActivityOutcome } from './activity-outcome.js';
import type { BeneficiaryWallets, UserWalletClient } from './internal/wallets.js';
import { submitUserActivity } from './internal/user-activity-submission.js';
import type { DmrvnReader } from './dmrvn-reader.js';
import { readOperationResult } from './internal/result-observation.js';

type ExplicitActivityArgs = [userSigner: EvmSigner, operationId: string, claimId: string, objectName: string,
  body: Readonly<Record<string, unknown>>, gas: string, signal?: AbortSignal];
type UserActivityArgs = [wallets: BeneficiaryWallets, request: ActivityRequest, signal?: AbortSignal];
type MemberActivityArgs = [wallets: UserWalletClient, userId: string, operationId: string, claimId: string,
  objectName: string, body: Readonly<Record<string, unknown>>, gas: string, signal?: AbortSignal];

/** DMRVN 단계 API. 영속 journal·재시작 복구와 외부 권한은 소비자가 제공한다. */
export class DmrvnClient {
  #context: OperationContext;
  #preflight: DmrvnPreflight;
  constructor(config: DmrvnConfig, rpc: EvmRpc, operator: EvmSigner, storage: GreenfieldStorage,
    methodology: DeclaredMethodology, journal?: OperationJournal) {
    this.#preflight = new DmrvnPreflight(config, rpc, operator, storage, methodology);
    this.#context = new OperationContext(config, rpc, operator, storage, methodology, journal);
  }
  preflight(signal?: AbortSignal): Promise<DmrvnPreflightResult> {
    return diagnosticOperation('dmrvn-client.preflight', undefined, () => {
      diagnosticPartner(this.#context.config.partnerId); return this.#preflight.run(signal);
    });
  }
  prepareEvidence(operationId: string, claimId: string, beneficiary: string, objectName: string,
    body: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.prepareEvidence', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return prepareEvidence(this.#context, operationId, claimId, beneficiary, objectName, body, signal);
    });
  }
  recoverCreateTransaction(operationId: string, hash: string, signal?: AbortSignal): Promise<void> {
    return diagnosticOperation('dmrvn-client.recoverCreateTransaction', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return recoverCreateTransaction(this.#context, operationId, hash, signal);
    });
  }
  approveClaim(operationId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.approveClaim', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return approveClaim(this.#context, operationId, signal);
    });
  }
  prepareSponsored(operationId: string, gas: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.prepareSponsored', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return prepareSponsored(this.#context, operationId, gas, signal);
    });
  }
  prepareSelfPaid(operationId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.prepareSelfPaid', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return prepareSelfPaid(this.#context, operationId, signal);
    });
  }
  resolveSubmission(operationId: string, txHash?: string | null, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.resolveSubmission', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return resolveSubmission(this.#context, operationId, txHash, signal);
    });
  }
  submitSponsored(operationId: string, forwardRequest: Readonly<Record<string, unknown>>, signature: string,
    signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.submitSponsored', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return submitSponsored(this.#context, operationId, forwardRequest, signature, signal);
    });
  }
  submitActivity(...args: UserActivityArgs): Promise<ActivityOutcome>;
  submitActivity(...args: ExplicitActivityArgs): Promise<Record<string, unknown>>;
  /** 기존 회원 지갑을 조회한다. 없으면 생성하지 않고 실패한다. */
  submitActivity(...args: MemberActivityArgs): Promise<Record<string, unknown>>;
  submitActivity(...args: UserActivityArgs | ExplicitActivityArgs | MemberActivityArgs): Promise<ActivityOutcome | Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.submitActivity', typeof args[1] === 'string' ? (typeof args[4] === 'string' ? args[2] : args[1]) : undefined, () => {
      diagnosticPartner(this.#context.config.partnerId);
      if (typeof args[1] !== 'string') return submitUserActivity(this.#context, ...args as UserActivityArgs);
      if (typeof args[4] === 'string') return this.#submitMemberActivity(...args as MemberActivityArgs);
      return submitActivity(this.#context, ...args as ExplicitActivityArgs);
    });
  }
  async #submitMemberActivity(wallets: UserWalletClient, userId: string, operationId: string, claimId: string,
    objectName: string, body: Readonly<Record<string, unknown>>, gas: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const snapshot = copyState(body);
    const signer = await wallets.signerFor(userId, signal);
    return submitActivity(this.#context, signer, operationId, claimId, objectName, snapshot, gas, signal);
  }
  readResult(operationId: string, reader: DmrvnReader, fromBlock?: bigint | number | null, reportTxHash?: string | null,
    waitTimedOut = false, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.readResult', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return readOperationResult(this.#context, operationId, reader, fromBlock, reportTxHash, waitTimedOut, signal);
    });
  }
  recordSponsoredSignature(operationId: string, forwardRequest: Readonly<Record<string, unknown>>, signature: string,
    signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.recordSponsoredSignature', operationId, () => {
      diagnosticPartner(this.#context.config.partnerId);
      return recordSponsoredSignature(this.#context, operationId, forwardRequest, signature, signal);
    });
  }
  /** Evidence 저장과 파트너 승인만 수행한다. */
  async prepare(operationId: string, claimId: string, beneficiary: string, objectName: string,
    body: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.prepare', operationId, async () => {
      diagnosticPartner(this.#context.config.partnerId);
      await this.prepareEvidence(operationId, claimId, beneficiary, objectName, body, signal);
      return this.approveClaim(operationId, signal);
    });
  }
  /** journal의 기존 사실만 읽는다. 잠금·외부 체인 재조회는 하지 않는다. */
  async operation(operationId: string): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-client.operation', operationId, async () => {
      diagnosticPartner(this.#context.config.partnerId);
      return copyState(await this.#context.required(operationKey(operationId)));
    });
  }
}

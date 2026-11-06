import type { DeclaredMethodology } from './declared-methodology.js';
import type { DmrvnConfig } from './dmrvn-config.js';
import { DmrvnPreflight, type DmrvnPreflightResult } from './dmrvn-preflight.js';
import type { EvmRpc } from './evm-rpc.js';
import type { EvmSigner } from './evm-signer.js';
import type { GreenfieldStorage } from './greenfield-storage.js';
import type { OperationJournal } from './operation-journal.js';
import { OperationContext, copyState, operationKey } from './internal/dmrvn-state.js';
import { prepareEvidence, recoverCreateTransaction } from './internal/evidence.js';

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
  /** journal의 기존 사실만 읽는다. 잠금·외부 체인 재조회는 하지 않는다. */
  async operation(operationId: string): Promise<Record<string, unknown>> {
    return copyState(await this.#context.required(operationKey(operationId)));
  }
}

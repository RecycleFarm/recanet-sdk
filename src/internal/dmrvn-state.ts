import { DeclaredMethodology } from '../declared-methodology.js';
import { DmrvnChain } from '../dmrvn-chain.js';
import { DmrvnConfig } from '../dmrvn-config.js';
import { normalizeAddress } from '../dmrvn-crypto.js';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnError, type DmrvnErrorCode } from '../errors.js';
import type { EvmRpc } from '../evm-rpc.js';
import type { EvmSigner } from '../evm-signer.js';
import type { GreenfieldStorage } from '../greenfield-storage.js';
import { MemoryOperationJournal } from '../memory-operation-journal.js';
import type { OperationJournal } from '../operation-journal.js';
import { findClaimOperations } from './journal.js';

export function requireState(condition: boolean, code: DmrvnErrorCode): asserts condition { if (!condition) throw new DmrvnError(code); }
export function stateMap(value: unknown): Record<string, unknown> {
  requireState(value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), 'INVALID_INPUT');
  return value as Record<string, unknown>;
}
export function stateString(value: unknown): string { requireState(typeof value === 'string', 'INVALID_INPUT'); return value; }
export function copyState(value: unknown): Record<string, unknown> { return stateMap(DmrvnJson.copy(value)); }
export function operationKey(id: string): string {
  requireState(typeof id === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(id), 'INVALID_INPUT');
  return 'operation:' + id;
}

/** 단계별 사실과 저장 경계. 관찰 cache는 재시작 복구 원본이 아니다. */
export class OperationContext {
  readonly config: DmrvnConfig;
  readonly chain: DmrvnChain;
  readonly operator: EvmSigner;
  readonly storage: GreenfieldStorage;
  readonly methodology: DeclaredMethodology;
  readonly journal: OperationJournal;
  readonly suppliedJournal: OperationJournal | undefined;
  #observations = new Map<string, Record<string, unknown>>();
  constructor(config: DmrvnConfig, rpc: EvmRpc, operator: EvmSigner, storage: GreenfieldStorage,
    methodology: DeclaredMethodology, journal?: OperationJournal) {
    this.config = config; this.chain = new DmrvnChain(config, rpc); this.operator = operator;
    this.storage = storage; this.methodology = methodology; this.suppliedJournal = journal;
    this.journal = journal ?? new MemoryOperationJournal();
    normalizeAddress(operator.address); normalizeAddress(storage.address);
    requireState(storage.chainId === config.greenfieldChainId, 'WRONG_CHAIN');
  }
  configurationFingerprint(): string {
    return DmrvnJson.hash({ deployment: this.config.deploymentId(), forwarder: this.config.forwarderAddress,
      methodologyHash: this.methodology.hash(), partnerId: this.config.partnerId, bucket: this.config.bucketName,
      prefix: this.config.objectPrefix, greenfieldChainId: this.config.greenfieldChainId,
      approver: normalizeAddress(this.operator.address), relay: normalizeAddress(this.operator.address), storage: normalizeAddress(this.storage.address) });
  }
  async required(key: string): Promise<Record<string, unknown>> {
    const state = await this.journal.load(key);
    requireState(state !== null, 'OPERATION_NOT_PREPARED');
    requireState(this.config.deploymentId() === state.deploymentId, 'DEPLOYMENT_COLLISION');
    requireState(this.configurationFingerprint() === state.configurationFingerprint, 'OPERATION_INPUT_CHANGED');
    return state;
  }
  async save(key: string, state: Record<string, unknown>): Promise<void> {
    this.#observations.set(key, copyState(state));
    await this.journal.store(key, copyState(state));
  }
  observation(key: string): Record<string, unknown> | null {
    const state = this.#observations.get(key);
    return state === undefined ? null : copyState(state);
  }
  async verifyState(key: string, state: Record<string, unknown>, writing: boolean, signal?: AbortSignal): Promise<Record<string, unknown>> {
    delete state.verifiedMetadata;
    state.ready = false;
    await this.save(key, state);
    try {
      if (writing) this.config.deployment.requireWritable();
      if (Object.hasOwn(state, 'deployment')) this.config.deployment.assertCompatible(stateMap(state.deployment));
      const verified = await this.chain.verifyDeployment(undefined, signal);
      if (!Object.hasOwn(state, 'deployment')) {
        requireState(!this.config.deployment.isProxy(), 'DEPLOYMENT_NOT_READY');
        state.deployment = verified;
      }
      state.verifiedMetadata = verified; state.ready = true; delete state.deploymentError;
      await this.save(key, state);
      return verified;
    } catch (error) {
      if (error instanceof DmrvnError) { state.deploymentError = error.code; await this.save(key, state); }
      throw error;
    }
  }
  async reserveClaim(claimId: string, operationId: string): Promise<void> {
    const key = 'claim-id:' + claimId;
    await this.journal.withLock(key, async () => {
      const entries = [...await findClaimOperations(this.journal, claimId)];
      const reservation = await this.journal.load(key);
      if (reservation !== null && Object.keys(reservation).length > 0) entries.push(reservation);
      for (const entry of entries) {
        requireState(this.config.deploymentId().toLowerCase() === String(entry.deploymentId).toLowerCase(), 'DEPLOYMENT_COLLISION');
        requireState(operationId === entry.operationId, 'NONCE_CONFLICT');
      }
      await this.journal.store(key, { claimId, deploymentId: this.config.deploymentId(), operationId });
    });
  }
  async reserve(key: string, operationId: string): Promise<void> {
    const reservation = await this.journal.load(key);
    requireState(reservation === null || Object.keys(reservation).length === 0 || reservation.operationId === operationId, 'NONCE_CONFLICT');
    await this.journal.store(key, { operationId });
  }
  relayKey(): string { return `relay-nonce:${this.config.chainId}:${normalizeAddress(this.operator.address)}`; }
  async release(key: string, operationId: string): Promise<void> {
    await this.journal.withLock(key, async () => {
      const reservation = await this.journal.load(key);
      if (reservation !== null && reservation.operationId === operationId) await this.journal.store(key, {});
    });
  }
}

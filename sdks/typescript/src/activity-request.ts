import { bytes32, uint } from './dmrvn-crypto.js';
import { DmrvnJson } from './dmrvn-json.js';
import { isJavaBlank } from './member-identity.js';
import { copyState, requireState, stateString } from './internal/dmrvn-state.js';

export interface ActivityRequestOptions {
  readonly claimId?: string | null;
  readonly objectName?: string | null;
  readonly gas?: string;
  readonly confirmationTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

/** 파트너 원본 값. ID/경로가 null이면 고수준 호출마다 새로 생성한다. */
export class ActivityRequest {
  readonly userId: string;
  readonly sourceEventId: string;
  readonly claimId: string | null;
  readonly objectName: string | null;
  readonly gas: string;
  readonly confirmationTimeoutMs: number;
  readonly pollIntervalMs: number;
  #inputs: Record<string, unknown>;
  constructor(userId: string, sourceEventId: string, inputs: Readonly<Record<string, unknown>>, options: ActivityRequestOptions = {}) {
    requireState(typeof userId === 'string' && !isJavaBlank(userId) && typeof sourceEventId === 'string'
      && /^[A-Za-z0-9:_-]{1,128}$/.test(sourceEventId) && options !== null && typeof options === 'object', 'INVALID_INPUT');
    this.userId = userId; this.sourceEventId = sourceEventId; this.#inputs = copyState(inputs);
    this.claimId = options.claimId == null ? null : bytes32(options.claimId);
    requireState(options.objectName == null || typeof options.objectName === 'string', 'INVALID_INPUT');
    this.objectName = options.objectName ?? null;
    this.gas = options.gas === undefined ? '900000' : stateString(options.gas);
    const gas = uint(this.gas, 256);
    requireState(gas >= 100000n && gas <= 2000000n, 'INVALID_INPUT');
    this.confirmationTimeoutMs = options.confirmationTimeoutMs === undefined ? 60000 : options.confirmationTimeoutMs;
    this.pollIntervalMs = options.pollIntervalMs === undefined ? 1000 : options.pollIntervalMs;
    requireState(Number.isInteger(this.confirmationTimeoutMs) && this.confirmationTimeoutMs >= 0 && this.confirmationTimeoutMs <= 600000
      && Number.isInteger(this.pollIntervalMs) && this.pollIntervalMs >= 1 && this.pollIntervalMs <= 10000, 'INVALID_INPUT');
    Object.freeze(this);
  }
  get inputs(): Record<string, unknown> { return DmrvnJson.copy(this.#inputs) as Record<string, unknown>; }
}

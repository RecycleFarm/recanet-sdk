import { diagnosticOperation } from './diagnostics.js';
import { bytes32, keccak, uint } from './dmrvn-crypto.js';
import { DmrvnJson } from './dmrvn-json.js';
import { DmrvnProtocol } from './dmrvn-protocol.js';
import { DmrvnError } from './errors.js';
import { chainNumber } from './internal/chain-id.js';

export type MethodologyRegistry = (activityId: number, id: number, version: number, methodologyHash: string) => boolean | Promise<boolean>;
const invalid = (): never => { throw new DmrvnError('INVALID_INPUT'); };
function map(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return invalid();
  return value as Record<string, unknown>;
}

/** 승인된 manifest/WASM commitment를 확인한다. WASM 실행·파트너 입력 프로필 선택은 하지 않는다. */
export class DeclaredMethodology {
  /** 과거 PET 패키지 hash. 확정 PET 방법론 v3의 승인 hash가 아니다. */
  static readonly PET_HASH = '0xdcc09ee621f2e388dd858f8f7399dbf2725cbec3526d52b0dd06909da892ff77';
  #manifest: Record<string, unknown>;
  #hash: string;
  #registry: MethodologyRegistry;
  #schema: number;
  #explicit: boolean;
  #petV3 = false;

  /** 2026-11-05 확정 PET 계약. manifest/WASM/hash와 registry 신뢰는 호출자가 제공한다. */
  static petV3(manifestBytes: Uint8Array, wasmBytes: Uint8Array, expectedHash: string,
    registry: MethodologyRegistry): DeclaredMethodology {
    const result = new DeclaredMethodology(manifestBytes, wasmBytes, expectedHash, registry, 4);
    if (result.activityId() !== 1003 || result.id() !== 2003 || result.version() !== 3) {
      throw new DmrvnError('METHODOLOGY_UNAVAILABLE');
    }
    result.#petV3 = true;
    return result;
  }

  constructor(manifestBytes: Uint8Array, wasmBytes: Uint8Array, expectedHash: string,
    registry: MethodologyRegistry, evidenceSchemaVersion?: number) {
    this.#manifest = map(DmrvnJson.parse(manifestBytes));
    this.#hash = bytes32(expectedHash);
    if (typeof registry !== 'function') throw new TypeError('활성 방법론 조회 함수가 필요합니다');
    this.#registry = registry;
    // 3은 기준 Java의 과거 생성자 호환값이다. 명시적 계약으로 인정하지 않는다.
    this.#schema = evidenceSchemaVersion === undefined ? 3 : evidenceSchemaVersion;
    this.#explicit = evidenceSchemaVersion !== undefined;
    if (!Number.isInteger(this.#schema) || this.#schema < 1 || this.#schema > 2147483647) invalid();
    if (DmrvnJson.hash(this.#manifest) !== this.#hash || keccak(wasmBytes) !== this.#manifest.wasmHash) {
      throw new DmrvnError('METHODOLOGY_UNAVAILABLE');
    }
    this.activityId(); this.id(); this.version();
  }

  hash(): string { return this.#hash; }
  activityId(): number { return Number(uint(this.#manifest.activityId, 32)); }
  id(): number { return Number(uint(map(this.#manifest.methodology).id, 32)); }
  version(): number { return Number(uint(map(this.#manifest.methodology).version, 32)); }

  async verifyActive(): Promise<void> {
    return diagnosticOperation('declared-methodology.verifyActive', undefined, async () => {

      if (await this.#registry(this.activityId(), this.id(), this.version(), this.#hash) !== true) {
        throw new DmrvnError('METHODOLOGY_UNAVAILABLE');
      }
    });
  }

  requireExplicitEvidenceVersion(): void {
    if (!this.#explicit) throw new DmrvnError('EVIDENCE_CONTRACT_UNCONFIGURED');
  }

  /** 명시 프로필의 파트너 결속. 일반 방법론에는 파트너별 정책을 추가하지 않는다. */
  validatePartner(partnerId: bigint | number): void {
    if (this.#petV3 && chainNumber(partnerId) !== 101n) invalid();
  }

  evidenceBody(partnerId: bigint | number, beneficiary: string, sourceEventId: string,
    inputs: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const partner = chainNumber(partnerId);
    const body = {
      schemaVersion: this.#schema, sourceEventId, partnerId: partner, activityId: this.activityId(),
      methodology: { id: this.id(), version: this.version() }, inputs: DmrvnJson.copy(inputs),
      source: { ownerHash: DmrvnProtocol.ownerHash(beneficiary) }
    };
    this.validate(body, partner, beneficiary);
    // 호출자에게 bigint 필드를 원본 Java JSON 정수와 같은 number로 전달한다.
    return map(DmrvnJson.copy(body));
  }

  validate(body: Readonly<Record<string, unknown>>, partnerId: bigint | number, beneficiary: string): void {
    this.validatePartner(partnerId);
    const value = map(body);
    const keys = ['schemaVersion', 'sourceEventId', 'partnerId', 'activityId', 'methodology', 'inputs', 'source'];
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
    if (String(value.schemaVersion) !== String(this.#schema) || String(value.partnerId) !== String(chainNumber(partnerId))
      || String(value.activityId) !== String(this.activityId())) invalid();
    if (DmrvnJson.hash(value.methodology) !== DmrvnJson.hash({ id: this.id(), version: this.version() })) invalid();
    if (typeof value.sourceEventId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.sourceEventId)) invalid();
    if (DmrvnJson.hash(value.source) !== DmrvnJson.hash({ ownerHash: DmrvnProtocol.ownerHash(beneficiary) })) invalid();
    const inputs = map(value.inputs);
    if (this.#petV3 && (value.schemaVersion !== 4
      || (value.partnerId !== 101 && value.partnerId !== 101n) || value.activityId !== 1003
      || Object.keys(inputs).length !== 1 || !Object.hasOwn(inputs, 'petBottleCount'))) invalid();
    // petBottleCount의 자료형·수치 범위는 확정 댓글에 없으므로 여기서 추정하지 않는다.
    if (DmrvnJson.bytes(value).length > 1048576) invalid();
  }
}

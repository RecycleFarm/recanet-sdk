import { canonicalChainJson, parseDmrvnJson } from './internal/chain-json.js';
import { keccak } from './dmrvn-crypto.js';

export { DmrvnDecimal } from './internal/chain-json.js';

/** 기준 Java JSON 호환 경로. 전체 입력에서 표준 JCS와 같다는 뜻은 아니다. */
export class DmrvnJson {
  static parse(bytes: Uint8Array): unknown { return parseDmrvnJson(bytes); }
  static canonical(value: unknown): string { return canonicalChainJson(value); }
  static bytes(value: unknown): Uint8Array { return Buffer.from(canonicalChainJson(value), 'utf8'); }
  static copy(value: unknown): unknown { return this.parse(this.bytes(value)); }
  static hash(value: unknown): string { return keccak(this.bytes(value)); }
}

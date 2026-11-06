import { DmrvnError } from '../errors.js';
import { JsonNumber, parseLosslessJson, type JsonValue } from './lossless-json.js';

const invalid = (): never => { throw new DmrvnError('INVALID_INPUT'); };

function unicode(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid();
  }
}

/** 십진수 값을 부호·유효 숫자·10의 지수로 비교한다. 거대한 10^n을 할당하지 않는다. */
function decimal(source: string): string {
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!parts) return invalid();
  const exponentText = parts[4] ?? '0';
  if (exponentText.replace(/^[+-]?0*/, '').length > 10) return invalid();
  const exponent = BigInt(exponentText);
  const scale = BigInt(parts[3]?.length ?? 0) - exponent;
  if (scale < -2147483648n || scale > 2147483647n) return invalid();
  let digits = (parts[2]! + (parts[3] ?? '')).replace(/^0+/, '');
  if (digits === '') return '0';
  const trimmed = digits.replace(/0+$/, '');
  const power = -scale + BigInt(digits.length - trimmed.length);
  digits = trimmed;
  return parts[1] + digits + 'e' + power;
}

function numeric(value: JsonNumber): number {
  const raw = value.source;
  if (raw === '-0') return invalid();
  if (!/[.eE]/.test(raw)) {
    const integer = BigInt(raw);
    if (integer < -9007199254740991n || integer > 9007199254740991n) return invalid();
  }
  const result = Number(raw);
  if (!Number.isFinite(result) || decimal(raw) !== decimal(JSON.stringify(result))) return invalid();
  return result;
}

function convert(value: JsonValue): unknown {
  if (value instanceof JsonNumber) return numeric(value);
  if (typeof value === 'string') { unicode(value); return value; }
  if (Array.isArray(value)) return value.map(convert);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, item] of Object.entries(value)) { unicode(key); result[key] = convert(item); }
    return result;
  }
  return value;
}

/** DMRVN/체인 JSON 응답 규칙. Privy 승인/JWT JSON과 공유하지 않는다. */
export function parseChainJson(bytes: Uint8Array, observeRaw?: (value: JsonValue) => void): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const raw = parseLosslessJson(text);
    const result = convert(raw);
    observeRaw?.(raw);
    return result;
  } catch { return invalid(); }
}

/** Java String.valueOf(JSON id)의 정수/BigDecimal 구분을 보존한다. */
export function rpcIdText(value: JsonValue): string | undefined {
  if (typeof value === 'string') return value;
  if (!(value instanceof JsonNumber)) return undefined;
  const match = /^(-?\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.source)!;
  const scale = BigInt(match[2]?.length ?? 0) - BigInt(match[3] ?? '0');
  return scale === 0n ? String(Number(value.source)) : undefined;
}

function quoted(value: string): string {
  unicode(value);
  return JSON.stringify(value).replace(/\\(?:u00[01][a-f0-9]|.)/g,
    part => part.startsWith('\\u00') ? '\\u' + part.slice(2).toUpperCase() : part);
}

/** 기준 Java Json의 객체 key 정렬·제어문자 대문자 escape. JCS 차이는 D-30에 남긴다. */
export function canonicalChainJson(value: unknown, depth = 0): string {
  if (depth > 128) return invalid();
  if (value === null) return 'null';
  if (typeof value === 'string') return quoted(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid();
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    if (value < -9007199254740991n || value > 9007199254740991n) return invalid();
    return String(value);
  }
  if (Array.isArray(value)) {
    // sparse 배열은 Java List의 값과 대응하지 않는다.
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) items.push(canonicalChainJson(value[i], depth + 1));
    return '[' + items.join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => quoted(key) + ':' + canonicalChainJson(object[key], depth + 1)).join(',') + '}';
  }
  return invalid();
}

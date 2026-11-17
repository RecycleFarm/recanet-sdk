import { getAddress, keccak256, recoverAddress } from 'ethers';
import { DmrvnError } from './errors.js';

export const ZERO_BYTES32 = '0x' + '00'.repeat(32);
const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const invalid = (): never => { throw new DmrvnError('INVALID_INPUT'); };

export function hexBytes(value: string): Uint8Array {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) return invalid();
  return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
}

export function hexString(value: Uint8Array): string { return '0x' + Buffer.from(value).toString('hex'); }
export function keccak(value: Uint8Array): string { return keccak256(value); }

/** Java UTF-8와 같이 고립 surrogate를 '?'로 대체한다. JSON 문자열 검사는 별도다. */
export function javaUtf8(value: string): Uint8Array {
  if (typeof value !== 'string') return invalid();
  return Buffer.from(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    part => part.length === 2 ? part : '?'), 'utf8');
}

export function textHash(value: string): string { return keccak(javaUtf8(value)); }

export function normalizeAddress(value: string): string {
  try {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) return invalid();
    return getAddress(value).toLowerCase();
  } catch { return invalid(); }
}

export function bytes32(value: string): string {
  if (hexBytes(value).length !== 32) return invalid();
  return value.toLowerCase();
}

export function uint(value: unknown, bits: number): bigint {
  if (!Number.isInteger(bits) || bits < 1 || bits > 256) return invalid();
  if (typeof value !== 'string' && typeof value !== 'bigint'
    && !(typeof value === 'number' && Number.isSafeInteger(value))) return invalid();
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) return invalid();
  const result = BigInt(text);
  if (result >= 1n << BigInt(bits)) return invalid();
  return result;
}

export function word(value: bigint): Uint8Array {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << 256n) return invalid();
  return hexBytes('0x' + value.toString(16).padStart(64, '0'));
}

export function recover(digest: string, signature: string): string {
  try {
    const raw = hexBytes(signature);
    if (raw.length !== 65) throw new Error();
    let v = raw[64]!;
    if (v >= 27) v -= 27;
    const r = BigInt(hexString(raw.slice(0, 32)));
    const s = BigInt(hexString(raw.slice(32, 64)));
    if ((v !== 0 && v !== 1) || r <= 0n || r >= CURVE_N || s <= 0n || s > CURVE_N / 2n) throw new Error();
    return recoverAddress(bytes32(digest), { r: hexString(raw.slice(0, 32)), s: hexString(raw.slice(32, 64)), v: v + 27 }).toLowerCase();
  } catch { throw new DmrvnError('SIGNATURE_INVALID'); }
}

export function messageDigest(text: string): string {
  const bytes = javaUtf8(text);
  return keccak(Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n' + bytes.length, 'utf8'), bytes]));
}

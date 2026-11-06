import { TransactionQueryError } from '../errors.js';
import type { ReadonlyJson, ReadonlyJsonObject } from '../evm-transaction.js';
import { evmHex, uint256 } from './evm-values.js';

export const MAX_HEIGHT = (1n << 63n) - 1n;

export function requireResponse(condition: boolean): asserts condition {
  if (!condition) throw new TransactionQueryError('INVALID_RESPONSE');
}

export function sameChain(condition: boolean): void {
  if (!condition) throw new TransactionQueryError('CHAIN_CHANGED');
}

export function responseMap(value: unknown): Record<string, unknown> {
  requireResponse(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function responseHex(value: unknown, bytes: number): string {
  try { return evmHex(value, bytes).toLowerCase(); }
  catch { throw new TransactionQueryError('INVALID_RESPONSE'); }
}

export function responseQuantity(value: unknown): bigint {
  try { return uint256(value); }
  catch { throw new TransactionQueryError('INVALID_RESPONSE'); }
}

export function height(value: unknown): bigint {
  const result = responseQuantity(value);
  requireResponse(result <= MAX_HEIGHT);
  return result;
}

export function index(value: unknown): number {
  const result = responseQuantity(value);
  requireResponse(result <= 2147483647n);
  return Number(result);
}

export function input(value: unknown): string {
  requireResponse(typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value));
  return value;
}

function freeze(value: unknown, depth: number): ReadonlyJson {
  requireResponse(depth <= 128);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireResponse(Number.isFinite(value)); return value; }
  if (Array.isArray(value)) return Object.freeze(Array.from(value, item => freeze(item, depth + 1)));
  const map = responseMap(value);
  requireResponse((Object.getPrototypeOf(map) === Object.prototype || Object.getPrototypeOf(map) === null)
    && Object.getOwnPropertySymbols(map).length === 0);
  const result: Record<string, ReadonlyJson> = Object.create(null) as Record<string, ReadonlyJson>;
  for (const [key, item] of Object.entries(map)) result[key] = freeze(item, depth + 1);
  return Object.freeze(result);
}

export function freezeMap(value: unknown): ReadonlyJsonObject {
  responseMap(value);
  return freeze(value, 0) as ReadonlyJsonObject;
}

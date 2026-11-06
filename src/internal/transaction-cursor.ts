import type { EvmTransactionQuery } from '../evm-transaction.js';
import { chainNumber } from './chain-id.js';
import { evmHex } from './evm-values.js';
import { isJavaBlank } from '../member-identity.js';

export interface TransactionRange {
  readonly fromBlock: bigint;
  readonly toBlock: bigint | null;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface TransactionCursor {
  readonly snapshot: bigint;
  readonly anchorHash: string;
  readonly nextBlock: bigint;
  readonly nextIndex: number;
  readonly expectedHash: string;
}

export function transactionRange(query: EvmTransactionQuery): TransactionRange {
  const fromBlock = chainNumber(query.fromBlock);
  const toBlock = query.toBlock == null ? null : chainNumber(query.toBlock);
  if (fromBlock < 0n || (toBlock !== null && toBlock < fromBlock)) throw new TypeError('거래 블록 범위가 올바르지 않습니다');
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new TypeError('limit은 1–100이어야 합니다');
  const cursor = query.cursor ?? null;
  if (cursor !== null && (typeof cursor !== 'string' || isJavaBlank(cursor) || cursor.length > 2048)) {
    throw new TypeError('거래 cursor가 올바르지 않습니다');
  }
  return Object.freeze({ fromBlock, toBlock, limit: query.limit, cursor });
}

function prefix(chain: bigint, address: string, query: TransactionRange): string {
  return `1:${chain}:${address}:${query.fromBlock}:${query.toBlock ?? 'latest'}:`;
}

export function encodeCursor(cursor: TransactionCursor, chain: bigint, address: string, query: TransactionRange): string {
  return Buffer.from(prefix(chain, address, query)
    + `${cursor.snapshot}:${cursor.anchorHash}:${cursor.nextBlock}:${cursor.nextIndex}:${cursor.expectedHash}`, 'ascii').toString('base64url');
}

export function decodeCursor(value: string, chain: bigint, address: string, query: TransactionRange): TransactionCursor {
  try {
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value) || value.length % 4 === 1
      || (value.includes('=') && value.length % 4 !== 0)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.some(byte => byte > 127)) throw new Error();
    const decoded = bytes.toString('ascii');
    if (!decoded.startsWith(prefix(chain, address, query))) throw new Error();
    const parts = decoded.split(':');
    if (parts.length !== 10) throw new Error();
    const integer = (part: string, bits: number) => {
      if (!/^[+-]?\d+$/.test(part)) throw new Error();
      const result = BigInt(part);
      if (result < -(1n << BigInt(bits - 1)) || result >= 1n << BigInt(bits - 1)) throw new Error();
      return result;
    };
    const snapshot = integer(parts[5]!, 64);
    const nextBlock = integer(parts[7]!, 64);
    const nextIndex = Number(integer(parts[8]!, 32));
    if (snapshot < query.fromBlock || nextBlock < query.fromBlock || nextBlock > snapshot || nextIndex < -1
      || (query.toBlock !== null && query.toBlock !== snapshot)) throw new Error();
    return { snapshot, nextBlock, nextIndex, anchorHash: evmHex(parts[6], 32).toLowerCase(),
      expectedHash: evmHex(parts[9], 32).toLowerCase() };
  } catch { throw new TypeError('이 체인·주소·범위에 대한 거래 cursor가 올바르지 않습니다'); }
}

export type EvmTransactionState = 'NOT_FOUND' | 'PENDING' | 'MINED' | 'SUCCEEDED' | 'REVERTED';

export interface EvmTransactionStatus {
  readonly chainId: bigint;
  readonly transactionHash: string;
  readonly state: EvmTransactionState;
  readonly blockNumber: bigint | null;
  readonly confirmations: bigint;
}

export type ReadonlyJson = null | string | number | boolean | readonly ReadonlyJson[] | { readonly [key: string]: ReadonlyJson };
export type ReadonlyJsonObject = { readonly [key: string]: ReadonlyJson };

export interface EvmTransaction {
  readonly chainId: bigint;
  readonly hash: string;
  readonly from: string;
  readonly to: string | null;
  readonly valueWei: bigint;
  readonly nonce: bigint;
  readonly input: string;
  readonly gasLimit: bigint;
  readonly gasPriceWei: bigint | null;
  readonly maxFeePerGasWei: bigint | null;
  readonly maxPriorityFeePerGasWei: bigint | null;
  readonly blockNumber: bigint | null;
  readonly blockHash: string | null;
  readonly transactionIndex: number | null;
  readonly status: EvmTransactionStatus;
  readonly transaction: ReadonlyJsonObject;
  readonly receipt: ReadonlyJsonObject | null;
}

export interface EvmTransactionQuery {
  readonly fromBlock: bigint | number;
  readonly toBlock?: bigint | number | null;
  readonly limit: number;
  readonly cursor?: string | null;
}

export interface EvmTransactionPage {
  readonly transactions: readonly EvmTransaction[];
  readonly nextCursor: string | null;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly scannedBlocks: number;
}

/** Java constructor/withCursor binding; structural query inputs remain accepted by the client. */
export const EvmTransactionQuery = class {
  readonly fromBlock: bigint; readonly toBlock: bigint | null; readonly limit: number; readonly cursor: string | null;
  constructor(fromBlock: bigint | number, toBlock: bigint | number | null, limit: number, cursor: string | null = null) {
    const integer = (value: bigint | number): bigint => {
      if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) throw new TypeError('Exact int64 required');
      const result = BigInt(value); if (result < -(1n << 63n) || result >= 1n << 63n) throw new RangeError('int64 required'); return result;
    };
    this.fromBlock = integer(fromBlock); this.toBlock = toBlock == null ? null : integer(toBlock);
    if (this.fromBlock < 0n || (this.toBlock !== null && this.toBlock < this.fromBlock) || !Number.isInteger(limit)
      || limit < 1 || limit > 100 || (cursor !== null && (typeof cursor !== 'string' || cursor.length > 2048 || !cursor || /^[\s]*$/u.test(cursor)))) throw new TypeError('Invalid transaction query');
    this.limit = limit; this.cursor = cursor; Object.freeze(this);
  }
  withCursor(cursor: string | null): InstanceType<typeof EvmTransactionQuery> { return new EvmTransactionQuery(this.fromBlock, this.toBlock, this.limit, cursor); }
};

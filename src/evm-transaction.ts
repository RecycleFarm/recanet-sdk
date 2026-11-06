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

/** JSON에 정확하게 표현할 수 없는 큰 EIP-712 정수는 10진 문자열로 전달한다. */
export interface EvmTypedData {
  readonly domain: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, readonly { readonly name: string; readonly type: string }[]>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}

export interface EvmTransactionInput {
  readonly to?: string | null;
  readonly data?: string | null;
  readonly value: string;
  readonly gas: string;
  readonly gasPrice: string;
  readonly nonce: string;
}

/** EVM 지갑 어댑터. 거래 hash는 접수 결과이며 실행 성공/최종성이 아니다. */
export interface EvmSigner {
  readonly address: string;
  signMessage(message: string, signal?: AbortSignal): Promise<string>;
  signTypedData(typedData: EvmTypedData, signal?: AbortSignal): Promise<string>;
  sendTransaction(chainId: bigint | number, transaction: EvmTransactionInput,
    idempotencyKey?: string | null, signal?: AbortSignal): Promise<string>;
}

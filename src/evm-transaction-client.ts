import { DmrvnError, TransactionQueryError } from './errors.js';
import type { EvmTransaction, EvmTransactionState, EvmTransactionStatus } from './evm-transaction.js';
import { HttpEvmRpc, type EvmRpc, type HttpEvmRpcOptions } from './evm-rpc.js';
import { chainNumber } from './internal/chain-id.js';
import { evmHex, quantity } from './internal/evm-values.js';
import { freezeMap, height, index, input, MAX_HEIGHT, requireResponse, responseHex, responseMap,
  responseQuantity, sameChain } from './internal/transaction-data.js';

/** 읽기 전용 EVM 거래 조회. 이 응답의 상태·확인 수는 합의/L1 최종성을 보장하지 않는다. */
export class EvmTransactionClient {
  #chain: bigint;
  #rpc: EvmRpc;

  constructor(chainId: bigint | number, rpc: EvmRpc | string, options?: HttpEvmRpcOptions) {
    this.#chain = chainNumber(chainId, true);
    this.#rpc = typeof rpc === 'string' ? new HttpEvmRpc(rpc, options) : rpc;
    if (!this.#rpc || typeof this.#rpc.call !== 'function') throw new TypeError('EVM RPC가 필요합니다');
  }

  /** null은 해당 RPC에서 hash를 찾지 못했음을 뜻한다. 취소/실패/대체의 증거가 아니다. */
  async getTransaction(txHash: string, signal?: AbortSignal): Promise<EvmTransaction | null> {
    const hash = evmHex(txHash, 32).toLowerCase();
    await this.#verifyChain(signal);
    const raw = await this.#call('eth_getTransactionByHash', [hash], signal);
    if (raw === null) return null;
    const tx = freezeMap(raw);
    requireResponse(hash === responseHex(tx.hash, 32));
    if (tx.blockNumber == null) return this.#detail(tx, null, 0n);
    const number = height(tx.blockNumber);
    const rawReceipt = await this.#call('eth_getTransactionReceipt', [hash], signal);
    const receipt = rawReceipt === null ? null : freezeMap(rawReceipt);
    const head = height(await this.#call('eth_blockNumber', [], signal));
    const block = await this.#block(number, false, signal);
    sameChain(responseHex(tx.blockHash, 32) === responseHex(block.hash, 32));
    return this.#detail(tx, receipt, head);
  }

  async getTransactionStatus(txHash: string, signal?: AbortSignal): Promise<EvmTransactionStatus> {
    const hash = evmHex(txHash, 32).toLowerCase();
    const detail = await this.getTransaction(hash, signal);
    return detail?.status ?? Object.freeze({ chainId: this.#chain, transactionHash: hash,
      state: 'NOT_FOUND', blockNumber: null, confirmations: 0n });
  }

  #detail(tx: Record<string, unknown>, rawReceipt: unknown, head: bigint): EvmTransaction {
    const hash = responseHex(tx.hash, 32);
    const from = responseHex(tx.from, 20);
    const to = tx.to == null ? null : responseHex(tx.to, 20);
    if (tx.chainId != null) requireResponse(responseQuantity(tx.chainId) === this.#chain);
    const number = tx.blockNumber == null ? null : height(tx.blockNumber);
    const blockHash = tx.blockHash == null ? null : responseHex(tx.blockHash, 32);
    const txIndex = tx.transactionIndex == null ? null : index(tx.transactionIndex);
    requireResponse((number === null && blockHash === null && txIndex === null)
      || (number !== null && blockHash !== null && txIndex !== null));
    let confirmations = 0n;
    let state: EvmTransactionState = 'PENDING';
    let receipt: Record<string, unknown> | null = null;
    if (number !== null) {
      sameChain(head >= number);
      requireResponse(head - number < MAX_HEIGHT);
      confirmations = head - number + 1n;
      state = 'MINED';
      if (rawReceipt !== null) {
        receipt = responseMap(rawReceipt);
        requireResponse(hash === responseHex(receipt.transactionHash, 32));
        sameChain(blockHash === responseHex(receipt.blockHash, 32) && number === height(receipt.blockNumber));
        requireResponse(txIndex === index(receipt.transactionIndex) && from === responseHex(receipt.from, 20)
          && to === (receipt.to == null ? null : responseHex(receipt.to, 20)));
        if (receipt.status != null) {
          const execution = responseQuantity(receipt.status);
          requireResponse(execution === 0n || execution === 1n);
          state = execution === 1n ? 'SUCCEEDED' : 'REVERTED';
        }
      }
    }
    const optional = (value: unknown) => value == null ? null : responseQuantity(value);
    return Object.freeze({ chainId: this.#chain, hash, from, to,
      valueWei: responseQuantity(tx.value), nonce: responseQuantity(tx.nonce), input: input(tx.input),
      gasLimit: responseQuantity(tx.gas), gasPriceWei: optional(tx.gasPrice), maxFeePerGasWei: optional(tx.maxFeePerGas),
      maxPriorityFeePerGasWei: optional(tx.maxPriorityFeePerGas), blockNumber: number, blockHash, transactionIndex: txIndex,
      status: Object.freeze({ chainId: this.#chain, transactionHash: hash, state, blockNumber: number, confirmations }),
      transaction: freezeMap(tx), receipt: receipt === null ? null : freezeMap(receipt) });
  }

  async #block(number: bigint, full: boolean, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const raw = await this.#call('eth_getBlockByNumber', [quantity(number), full], signal);
    if (raw === null) throw new TransactionQueryError('RPC_UNAVAILABLE');
    const block = responseMap(raw);
    requireResponse(height(block.number) === number);
    return block;
  }

  async #verifyChain(signal?: AbortSignal): Promise<void> {
    if (responseQuantity(await this.#call('eth_chainId', [], signal)) !== this.#chain) throw new TransactionQueryError('WRONG_CHAIN');
  }

  async #call(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new TransactionQueryError('INTERRUPTED');
    try { return await this.#rpc.call(method, params, signal); }
    catch (error) {
      if (error instanceof DmrvnError) throw new TransactionQueryError(error.code === 'INTERRUPTED' ? 'INTERRUPTED'
        : error.code === 'INVALID_INPUT' ? 'INVALID_RESPONSE' : 'RPC_UNAVAILABLE');
      const seen = new Set<unknown>();
      let cause: unknown = error;
      while (cause && typeof cause === 'object' && !seen.has(cause)) {
        seen.add(cause);
        if ('name' in cause && cause.name === 'AbortError') throw new TransactionQueryError('INTERRUPTED');
        cause = 'cause' in cause ? cause.cause : undefined;
      }
      throw new TransactionQueryError(signal?.aborted ? 'INTERRUPTED' : 'RPC_UNAVAILABLE');
    }
  }
}

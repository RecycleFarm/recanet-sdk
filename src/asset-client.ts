import { diagnosticOperation, diagnosticSubmission, diagnosticTranslated } from './diagnostics.js';
import { DmrvnError } from './errors.js';
import { HttpEvmRpc, type EvmRpc, type HttpEvmRpcOptions } from './evm-rpc.js';
import type { EvmSigner } from './evm-signer.js';
import { requireText } from './backend-wallet.js';
import { evmHex, quantity, uint256 } from './internal/evm-values.js';

function number(value: unknown): bigint {
  try { return uint256(value); } catch { throw new DmrvnError('RPC_UNAVAILABLE'); }
}

/** 현재 지원 자산은 Arbitrum Sepolia의 네이티브 ETH다. */
export class AssetClient {
  static readonly CHAIN_ID = 421614n;
  static readonly SYMBOL = 'ETH';
  static readonly DECIMALS = 18;
  #rpc: EvmRpc;

  constructor(rpc: EvmRpc | string, options?: HttpEvmRpcOptions) {
    this.#rpc = typeof rpc === 'string' ? new HttpEvmRpc(rpc, options) : rpc;
    if (!this.#rpc || typeof this.#rpc.call !== 'function') throw new TypeError('EVM RPC가 필요합니다');
  }

  /** latest는 RPC 관찰값이며 최종 확정이나 pending 차감 후 가용 잔액을 뜻하지 않는다. */
  async getBalance(address: string, signal?: AbortSignal): Promise<bigint> {
    return diagnosticOperation('asset-client.getBalance', undefined, async () => {
      evmHex(address, 20);
      await this.#verifyChain(signal);
      return number(await this.#rpc.call('eth_getBalance', [address, 'latest'], signal));
    });
  }

  /** 완성 거래를 한 번 제출한다. 실패 후 같은 key로 재호출해도 같은 body를 보장하지 않는다. */
  async transfer(signer: EvmSigner, recipient: string, amountWei: bigint, idempotencyKey: string,
    signal?: AbortSignal): Promise<string> {
    return diagnosticOperation('asset-client.transfer', idempotencyKey, async () => {
      if (!signer || typeof signer.sendTransaction !== 'function') throw new TypeError('서명자가 필요합니다');
      const address = evmHex(signer.address, 20);
      evmHex(recipient, 20);
      if (typeof amountWei !== 'bigint' || amountWei <= 0n || amountWei >= 1n << 256n) {
        throw new TypeError('금액은 양의 uint256 정수 wei여야 합니다');
      }
      requireText(idempotencyKey, 'idempotencyKey');
      await this.#verifyChain(signal);
      const estimate = { from: address, to: recipient, value: quantity(amountWei), data: '0x' };
      const gas = number(await this.#rpc.call('eth_estimateGas', [estimate], signal));
      const price = number(await this.#rpc.call('eth_gasPrice', [], signal));
      const nonce = number(await this.#rpc.call('eth_getTransactionCount', [address, 'pending'], signal));
      if (gas === 0n || price === 0n) throw new DmrvnError('RPC_UNAVAILABLE');
      const transaction = Object.freeze({
        to: recipient, value: quantity(amountWei), data: '0x',
        gas: quantity(gas), gasPrice: quantity(price), nonce: quantity(nonce)
      });
      let hash: unknown;
      try { hash = await diagnosticSubmission('evm.sendTransaction', () => signer.sendTransaction(AssetClient.CHAIN_ID, transaction, idempotencyKey, signal), hash => typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash), undefined, signer); }
      catch (error) { throw diagnosticTranslated(error, new DmrvnError('SUBMISSION_UNRESOLVED')); }
      try { return evmHex(hash, 32); }
      catch (error) { throw diagnosticTranslated(error, new DmrvnError('SUBMISSION_UNRESOLVED')); }
    });
  }

  async #verifyChain(signal?: AbortSignal): Promise<void> {
    if (number(await this.#rpc.call('eth_chainId', [], signal)) !== AssetClient.CHAIN_ID) throw new DmrvnError('WRONG_CHAIN');
  }
}

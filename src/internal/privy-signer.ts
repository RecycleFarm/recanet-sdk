import { BackendWalletRegistration } from '../backend-wallet.js';
import { DmrvnError, PrivyApiError } from '../errors.js';
import type { EvmSigner, EvmTransactionInput, EvmTypedData } from '../evm-signer.js';
import { authorizationPrivateKey, prepareAuthorization } from './authorization.js';
import { requestJson, type HttpSettings } from './http.js';
import { listWallets, type WalletRequest } from './wallets.js';

function failure(error: unknown): DmrvnError {
  if (error instanceof PrivyApiError) {
    if (error.code === 'INTERRUPTED') return new DmrvnError('INTERRUPTED');
    if (error.statusCode === 401 || error.statusCode === 403) return new DmrvnError('UNAUTHORIZED_SIGNER');
  }
  return new DmrvnError('RPC_UNAVAILABLE');
}

export function chainNumber(value: bigint | number, positive = false): bigint {
  if (typeof value !== 'bigint' && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    throw new TypeError('chainId는 정수 또는 bigint여야 합니다');
  }
  const result = BigInt(value);
  if (result < -(1n << 63n) || result >= (1n << 63n) || (positive && result <= 0n)) {
    throw new TypeError('chainId가 64비트 범위를 벗어났습니다');
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('객체가 필요합니다');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('문자열이 필요합니다');
  return value;
}

export async function createPrivySigner(settings: HttpSettings, request: WalletRequest, walletId: string,
  registration: BackendWalletRegistration, signal?: AbortSignal): Promise<EvmSigner> {
  let address: string;
  try {
    const wallets = await listWallets(request, registration.publicKey, signal);
    const wallet = wallets.find(wallet => wallet.id === walletId);
    if (!wallet || wallet.chainType !== 'ethereum') throw new DmrvnError('UNAUTHORIZED_SIGNER');
    address = wallet.address;
  } catch (error) {
    if (error instanceof DmrvnError) throw error;
    // Java 생성자의 목록 API 오류는 이미 정리됐으므로 RPC_UNAVAILABLE로 축약된다.
    throw new DmrvnError('RPC_UNAVAILABLE');
  }
  // Java와 같이 컨텍스트 입력의 Base64 검사는 호출 오류 변환 바깥에서 수행한다.
  const privateKey = authorizationPrivateKey(registration.privateKey);
  const path = '/v1/wallets/' + encodeURIComponent(walletId) + '/rpc';

  const rpc = async (body: unknown, method: string, field: string, key?: string | null,
    signal?: AbortSignal): Promise<string> => {
    const signed = prepareAuthorization(settings.appId, settings.origin + path, body, privateKey, key ?? undefined);
    const response = record(await requestJson(settings, path, 'POST', undefined, signal, 200, signed));
    if (response.method !== method) throw new TypeError('RPC 응답 유형이 일치하지 않습니다');
    const data = record(response.data);
    if (field === 'signature' && typeof data.encoding !== 'string') throw new TypeError('서명 응답 encoding이 필요합니다');
    return string(data[field]);
  };

  return Object.freeze({
    address,
    async signMessage(message: string, signal?: AbortSignal): Promise<string> {
      try {
        return await rpc({ method: 'personal_sign', params: { message: string(message), encoding: 'utf-8' } },
          'personal_sign', 'signature', undefined, signal);
      } catch (error) { throw failure(error); }
    },
    async signTypedData(typedData: EvmTypedData, signal?: AbortSignal): Promise<string> {
      try {
        const types: Record<string, { name: string; type: string }[]> = Object.create(null) as Record<string, { name: string; type: string }[]>;
        for (const [name, fields] of Object.entries(record(typedData.types))) {
          if (!Array.isArray(fields)) throw new TypeError('types 필드는 배열이어야 합니다');
          types[name] = fields.map(field => ({ name: string(record(field).name), type: string(record(field).type) }));
        }
        return await rpc({ method: 'eth_signTypedData_v4', chain_type: 'ethereum', params: { typed_data: {
          domain: record(typedData.domain), types, primary_type: string(typedData.primaryType), message: record(typedData.message),
        } } }, 'eth_signTypedData_v4', 'signature', undefined, signal);
      } catch (error) { throw failure(error); }
    },
    async sendTransaction(chainId: bigint | number, transaction: EvmTransactionInput,
      idempotencyKey?: string | null, signal?: AbortSignal): Promise<string> {
      try {
        const chain = chainNumber(chainId);
        const tx: Record<string, string> = { from: address, chain_id: '0x' + BigInt.asUintN(64, chain).toString(16),
          value: string(transaction.value), gas_limit: string(transaction.gas), gas_price: string(transaction.gasPrice),
          nonce: string(transaction.nonce) };
        if (transaction.to != null) tx.to = string(transaction.to);
        if (transaction.data != null) tx.data = string(transaction.data);
        if (idempotencyKey != null) string(idempotencyKey);
        return await rpc({ method: 'eth_sendTransaction', chain_type: 'ethereum', caip2: 'eip155:' + chain,
          params: { transaction: tx } }, 'eth_sendTransaction', 'hash', idempotencyKey, signal);
      } catch (error) { throw failure(error); }
    },
  });
}

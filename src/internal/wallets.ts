import { PrivyApiError } from '../errors.js';
import { type BackendWallet, type BackendWalletCreateRequest, BackendWalletRegistration, requireText } from '../backend-wallet.js';
import { isJavaBlank, memberExternalId } from '../member-identity.js';

export type WalletRequest = (path: string, method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal) => Promise<unknown>;

export interface UserWallet {
  readonly userId: string;
  readonly id: string;
  readonly address: string;
  readonly chainType: 'ethereum';
}

export interface UserWalletClient {
  findWallet(userId: string, signal?: AbortSignal): Promise<UserWallet | null>;
  getOrCreateWallet(userId: string, signal?: AbortSignal): Promise<UserWallet>;
}

const CHAINS = new Set(['ethereum', 'solana', 'cosmos', 'stellar', 'sui', 'aptos', 'movement', 'tron',
  'bitcoin-segwit', 'bitcoin-taproot', 'pearl', 'near', 'ton', 'starknet', 'xrpl', 'spark']);
const invalid = () => new PrivyApiError('INVALID_RESPONSE');

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function metadata(value: unknown): BackendWallet {
  const wallet = object(value);
  if (typeof wallet.id !== 'string' || typeof wallet.address !== 'string' || typeof wallet.chain_type !== 'string'
    || (wallet.public_key != null && typeof wallet.public_key !== 'string')) throw invalid();
  return Object.freeze({ id: wallet.id, address: wallet.address,
    chainType: wallet.chain_type, publicKey: wallet.public_key as string | null | undefined ?? null });
}

function page(value: unknown): { data: unknown[]; next: string | null } {
  const response = object(value);
  if (!Array.isArray(response.data) || (response.next_cursor != null && typeof response.next_cursor !== 'string')) throw invalid();
  const next = response.next_cursor;
  return { data: response.data, next: typeof next === 'string' && !isJavaBlank(next) ? next : null };
}

export async function registerWallet(request: WalletRequest, registration: BackendWalletRegistration,
  input: BackendWalletCreateRequest, signal?: AbortSignal): Promise<BackendWallet> {
  if (!(registration instanceof BackendWalletRegistration)) throw new TypeError('등록 승인키가 필요합니다');
  requireText(input.chainType, 'chainType');
  if (!CHAINS.has(input.chainType)) throw new TypeError('지원하지 않는 chainType입니다');
  const body: Record<string, unknown> = { chain_type: input.chainType, owner: { public_key: registration.publicKey } };
  for (const [field, value] of [['display_name', input.displayName], ['external_id', input.externalId]] as const) {
    if (value != null) {
      if (typeof value !== 'string') throw new TypeError(`${field}는 문자열이어야 합니다`);
      if (!isJavaBlank(value)) body[field] = value;
    }
  }
  const response = await request('/v1/wallets', 'POST', body, signal);
  try { return metadata(response); }
  catch { throw new PrivyApiError('INVALID_RESPONSE', 200); }
}

export async function listWallets(request: WalletRequest, publicKey: string, signal?: AbortSignal): Promise<readonly BackendWallet[]> {
  requireText(publicKey, 'publicKey');
  const wallets: BackendWallet[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ authorization_key: publicKey, limit: '100' });
    if (cursor !== null) query.set('cursor', cursor);
    const response = page(await request('/v1/wallets?' + query, 'GET', undefined, signal));
    wallets.push(...response.data.map(metadata));
    cursor = response.next;
  } while (cursor !== null);
  // Java 운영 목록과 같이 반복 cursor/중복 지갑을 거부하지 않는다 (D-08 미결).
  return Object.freeze(wallets);
}

export async function isBackendWallet(request: WalletRequest, walletId: string,
  registration: BackendWalletRegistration, signal?: AbortSignal): Promise<boolean> {
  requireText(walletId, 'walletId');
  if (!(registration instanceof BackendWalletRegistration)) throw new TypeError('등록 승인키가 필요합니다');
  const response = await request('/v1/wallets/' + encodeURIComponent(walletId), 'GET', undefined, signal);
  // public_key는 블록체인 공개키일 수 있다. 이 legacy 비교를 서명 권한 확인에 쓰지 않는다.
  return response !== null && object(response).public_key === registration.publicKey;
}

export function memberWallets(request: WalletRequest, registration: BackendWalletRegistration,
  namespace: string, partnerId?: number): UserWalletClient {
  if (!(registration instanceof BackendWalletRegistration)) throw new TypeError('등록 승인키가 필요합니다');
  // namespace/partner 입력을 네트워크 요청 전에 검증한다.
  memberExternalId(namespace, 'validation', partnerId);

  const find = async (userId: string, signal?: AbortSignal): Promise<UserWallet | null> => {
    const externalId = memberExternalId(namespace, userId, partnerId);
    let cursor: string | null = null;
    let found: UserWallet | null = null;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ external_id: externalId, authorization_key: registration.publicKey,
        include_archived: 'false', limit: '100' });
      if (cursor !== null) query.set('cursor', cursor);
      const response = page(await request('/v1/wallets?' + query, 'GET', undefined, signal));
      for (const item of response.data) {
        const wallet = object(item);
        if (wallet.external_id !== externalId || wallet.chain_type !== 'ethereum' || found !== null) throw invalid();
        const details = metadata(wallet);
        found = Object.freeze({ userId, id: details.id, address: details.address, chainType: 'ethereum' });
      }
      cursor = response.next;
      if (cursor !== null && seen.has(cursor)) throw invalid();
      if (cursor !== null) seen.add(cursor);
    } while (cursor !== null);
    return found;
  };

  return Object.freeze({
    findWallet: find,
    async getOrCreateWallet(userId: string, signal?: AbortSignal): Promise<UserWallet> {
      const externalId = memberExternalId(namespace, userId, partnerId);
      const existing = await find(userId, signal);
      if (existing) return existing;
      try {
        const created = await registerWallet(request, registration, { chainType: 'ethereum', externalId }, signal);
        if (created.chainType !== 'ethereum') throw invalid();
        // Java 생성 응답은 external_id를 다시 비교하지 않는다.
        return Object.freeze({ userId, id: created.id, address: created.address, chainType: 'ethereum' });
      } catch (error) {
        if (error instanceof PrivyApiError && error.statusCode === 409) {
          const winner = await find(userId, signal);
          if (winner) return winner;
        }
        throw error;
      }
    },
  });
}

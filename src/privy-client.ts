import { PrivyApiError } from './errors.js';
import { requestJson, type HttpSettings } from './internal/http.js';
import { isJavaBlank } from './member-identity.js';
import { PrivyTokenVerifier, type TokenVerificationOptions, type AuthenticatedUser } from './token-verifier.js';
import { BackendWalletRegistration, type BackendWalletCreateRequest, type BackendWallet } from './backend-wallet.js';
import { registerWallet, listWallets, isBackendWallet, memberWallets, type UserWalletClient } from './internal/wallets.js';
import { createPrivySigner } from './internal/privy-signer.js';
import type { EvmSigner } from './evm-signer.js';

export interface PrivyClientOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly origin?: string;
  readonly timeoutMs?: number;
  /** 테스트와 서비스별 연결 설정에 사용하는 fetch. */
  readonly fetch?: typeof globalThis.fetch;
  readonly tokenVerification?: TokenVerificationOptions;
}

function settings(options: PrivyClientOptions): HttpSettings {
  if (typeof options.appId !== 'string' || isJavaBlank(options.appId)
    || /[:\u0000-\u0020\u007f-\u009f\u1680\u2000-\u2006\u2008-\u200a\u2028-\u2029\u205f\u3000]/u.test(options.appId)) {
    throw new TypeError('appId가 올바르지 않습니다');
  }
  if (typeof options.appSecret !== 'string' || isJavaBlank(options.appSecret)) {
    throw new TypeError('appSecret은 비공백 문자열이어야 합니다');
  }
  const origin = options.origin ?? 'https://api.privy.io';
  // WHATWG URL이 /, query, 역슬래시 등을 정규화하기 전에 원문을 검사한다.
  if (!/^https?:\/\/[^/\\?#@\s]+$/i.test(origin)) throw new TypeError('API origin이 올바르지 않습니다');
  let url: URL;
  try { url = new URL(origin); } catch { throw new TypeError('API origin이 올바르지 않습니다'); }
  const host = origin.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').toLowerCase();
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new TypeError('API origin은 HTTPS 또는 loopback HTTP여야 합니다');
  }
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs는 양의 안전한 정수여야 합니다');
  const fetch = options.fetch ?? globalThis.fetch;
  if (typeof fetch !== 'function') throw new TypeError('fetch가 필요합니다');
  return Object.freeze({ appId: options.appId, appSecret: options.appSecret, origin: url.origin, timeoutMs, fetch });
}

/** 생성은 네트워크 호출을 하지 않는다. 인스턴스를 서비스 수명 동안 재사용한다. */
export class PrivyClient {
  #settings: HttpSettings;
  #verifier: PrivyTokenVerifier | undefined;

  constructor(options: PrivyClientOptions) {
    this.#settings = settings(options);
    this.#verifier = options.tokenVerification === undefined ? undefined
      : new PrivyTokenVerifier(this.#settings.appId, options.tokenVerification);
  }

  /** 미설정은 사용자 인증 실패가 아닌 구성 오류다. */
  verifyAccessToken(token: string | null | undefined): Promise<AuthenticatedUser> {
    if (!this.#verifier) throw new TypeError('tokenVerification 설정이 필요합니다');
    return this.#verifier.verifyAccessToken(token);
  }

  authenticateAuthorizationHeader(header: string | null | undefined): Promise<AuthenticatedUser> {
    if (!this.#verifier) throw new TypeError('tokenVerification 설정이 필요합니다');
    return this.#verifier.authenticateAuthorizationHeader(header);
  }

  /** 사용자 조회 권한을 진단한다. 지갑 쓰기 권한까지 검증하지 않는다. */
  async verifyAppCredentials(signal?: AbortSignal): Promise<void> {
    const response = await requestJson(this.#settings, '/v1/users?limit=1', 'GET', undefined, signal);
    if (!response || typeof response !== 'object' || !('data' in response) || !Array.isArray(response.data)) {
      throw new PrivyApiError('INVALID_RESPONSE');
    }
  }

  registerBackendWallet(registration: BackendWalletRegistration, input: BackendWalletCreateRequest,
    signal?: AbortSignal): Promise<BackendWallet> {
    return registerWallet(this.#request, registration, input, signal);
  }

  listBackendWallets(publicKey: string, signal?: AbortSignal): Promise<readonly BackendWallet[]> {
    return listWallets(this.#request, publicKey, signal);
  }

  /** 기존 public_key 문자열 비교 API. 서명 권한 판정과 다르다 (D-01). */
  isBackendWallet(walletId: string, registration: BackendWalletRegistration, signal?: AbortSignal): Promise<boolean> {
    return isBackendWallet(this.#request, walletId, registration, signal);
  }

  /** 인증/tenant 권한을 확인한 userId만 전달한다. 생성 전에 승인키를 영속 보관한다. */
  userWallets(registration: BackendWalletRegistration, namespace: string): UserWalletClient {
    return memberWallets(this.#request, registration, namespace);
  }

  /** 승인키 목록으로 권한을 확인하며 지갑 개인키를 export하지 않는다. */
  signerForWallet(walletId: string, registration: BackendWalletRegistration, signal?: AbortSignal): Promise<EvmSigner> {
    return createPrivySigner(this.#settings, this.#request, walletId, registration, signal);
  }

  #request = (path: string, method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal): Promise<unknown> =>
    requestJson(this.#settings, path, method, body, signal);
}

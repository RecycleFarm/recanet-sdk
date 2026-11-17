import { privyOrigin } from './internal/dmrvn-uri.js';
import { javaHttpFetch } from './internal/java-http.js';
import { PrivyClientConfig, PrivyTokenVerificationConfig } from './privy-config.js';
import { Duration, duration } from './duration.js';
import { PrivyApiError, IllegalStateError } from './errors.js';
import { requestJson, type HttpSettings } from './internal/http.js';
import { isJavaBlank } from './member-identity.js';
import { PrivyTokenVerifier, type TokenVerificationOptions, type AuthenticatedUser } from './token-verifier.js';
import { BackendWalletRegistration, type BackendWalletCreateRequest, type BackendWallet, BackendWalletKeyPair } from './backend-wallet.js';
import { registerWallet, listWallets, isBackendWallet, memberWallets, type UserWalletClient } from './internal/wallets.js';
import { createPrivySigner } from './internal/privy-signer.js';
import type { EvmSigner } from './evm-signer.js';
import { exportWalletPrivateKey } from './internal/wallet-export.js';

export interface PrivyClientOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly origin?: string;
  readonly timeoutMs?: number | bigint;
  readonly requestTimeout?: Duration;
  /** 테스트와 서비스별 연결 설정에 사용하는 fetch. */
  readonly fetch?: typeof globalThis.fetch;
  readonly tokenVerification?: TokenVerificationOptions | PrivyTokenVerificationConfig;
}

function settings(options: PrivyClientOptions): HttpSettings {
  if (typeof options.appId !== 'string' || isJavaBlank(options.appId)
    || /[:\u0000-\u0020\u007f-\u009f\u1680\u2000-\u2006\u2008-\u200a\u2028-\u2029\u205f\u3000]/u.test(options.appId)) {
    throw new TypeError('appId가 올바르지 않습니다');
  }
  if (typeof options.appSecret !== 'string' || isJavaBlank(options.appSecret)) {
    throw new TypeError('appSecret은 비공백 문자열이어야 합니다');
  }
  const origin = privyOrigin(options.origin ?? 'https://api.privy.io');
  const timeout = options.requestTimeout ?? duration(options.timeoutMs ?? 30000);
  const timeoutMs = timeout.toMillis();
  if (timeout.isNegative() || timeoutMs < 1n) throw new TypeError('timeoutMs는 양의 안전한 정수여야 합니다');
  const fetch = options.fetch ?? javaHttpFetch();
  if (typeof fetch !== 'function') throw new TypeError('fetch가 필요합니다');
  return Object.freeze({ appId: options.appId, appSecret: options.appSecret, origin, timeoutMs, timeout, fetch });
}

/** 생성은 네트워크 호출을 하지 않는다. 인스턴스를 서비스 수명 동안 재사용한다. */
export class PrivyClient {
  #settings: HttpSettings;
  #verifier: PrivyTokenVerifier | undefined;
  #config: PrivyClientConfig;

  constructor(input: PrivyClientOptions | PrivyClientConfig, fetch?: typeof globalThis.fetch) {
    const options: PrivyClientOptions = input instanceof PrivyClientConfig ? {
      appId: input.appId(), appSecret: input.appSecret(), origin: input.baseUri(), requestTimeout: input.requestTimeout(),
      ...(input.verificationOptions() ? { tokenVerification: input.verificationOptions()! } : {}), ...(fetch ? { fetch } : {}),
    } : input;
    this.#settings = settings(options);
    const verification = options.tokenVerification instanceof PrivyTokenVerificationConfig ? options.tokenVerification.options() : options.tokenVerification;
    this.#config = new PrivyClientConfig(options.appId, options.appSecret, this.#settings.origin, this.#settings.timeout);
    if (verification) this.#config = this.#config.withTokenVerification(verification);
    this.#verifier = verification === undefined ? undefined : new PrivyTokenVerifier(this.#settings.appId, verification);
  }
  config(): PrivyClientConfig { return this.#config; }

  /** 미설정은 사용자 인증 실패가 아닌 구성 오류다. */
  verifyAccessToken(token: string | null | undefined): Promise<AuthenticatedUser> {
    if (!this.#verifier) throw new IllegalStateError('Token verification is not configured');
    return this.#verifier.verifyAccessToken(token);
  }

  authenticateAuthorizationHeader(header: string | null | undefined): Promise<AuthenticatedUser> {
    if (!this.#verifier) throw new IllegalStateError('Token verification is not configured');
    return this.#verifier.authenticateAuthorizationHeader(header);
  }

  /** 사용자 조회 권한을 진단한다. 지갑 쓰기 권한까지 검증하지 않는다. */
  async verifyAppCredentials(signal?: AbortSignal): Promise<void> {
    const response = await requestJson(this.#settings, '/v1/users?limit=1.0', 'GET', undefined, signal);
    if (!response || typeof response !== 'object' || !('data' in response) || !Array.isArray(response.data)) {
      throw new PrivyApiError('INVALID_RESPONSE', 200);
    }
  }

  registerBackendWallet(registration: BackendWalletRegistration, input: BackendWalletCreateRequest,
    signal?: AbortSignal): Promise<BackendWallet> {
    return registerWallet(this.#request, registration, input, signal);
  }

  listWalletsByAuthorizationKey(publicKey: string, signal?: AbortSignal): Promise<readonly BackendWallet[]> {
    return listWallets(this.#request, publicKey, signal);
  }
  async ensureBackendWallet(request: BackendWalletCreateRequest): Promise<BackendWallet> {
    if (request == null) throw new TypeError('request required');
    await this.verifyAppCredentials();
    const publicKey = process.env.BACKEND_WALLET_PUBLIC_KEY, privateKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
    if (typeof publicKey === 'string' && !isJavaBlank(publicKey) && typeof privateKey === 'string' && !isJavaBlank(privateKey)) {
      const registration = new BackendWalletRegistration(publicKey, privateKey);
      const existing = await this.listWalletsByAuthorizationKey(publicKey);
      return existing.length ? existing[0]! : this.registerBackendWallet(registration, request);
    }
    return this.registerBackendWallet(BackendWalletKeyPair.generateAndLog().registration(), request);
  }
  async exportWalletPrivateKeyAndLog(walletId: string, registration: BackendWalletRegistration): Promise<string> {
    const key = await this.exportWalletPrivateKey(walletId, registration);
    console.warn('BACKEND_BLOCKCHAIN_WALLET_PRIVATE_KEY=' + key);
    return key;
  }
  /** 호출 서비스의 접근 제어가 필요하다. 복호화한 블록체인 개인키를 출력/저장하지 않는다. */
  exportWalletPrivateKey(walletId: string, registration: BackendWalletRegistration, signal?: AbortSignal): Promise<string> {
    return exportWalletPrivateKey(this.#settings, walletId, registration, signal);
  }

  /** 기존 public_key 문자열 비교 API. 서명 권한 판정과 다르다 (D-01). */
  isBackendWallet(walletId: string, registration: BackendWalletRegistration, signal?: AbortSignal): Promise<boolean> {
    return isBackendWallet(this.#request, walletId, registration, signal);
  }

  /** 인증/tenant 권한을 확인한 userId만 전달한다. 생성 전에 승인키를 영속 보관한다. */
  userWallets(registration: BackendWalletRegistration, namespace: string): UserWalletClient {
    return memberWallets(this.#request, registration, namespace,
      (walletId, registration, signal) => this.signerForWallet(walletId, registration, signal));
  }

  /** 승인키 목록으로 권한을 확인하며 지갑 개인키를 export하지 않는다. */
  signerForWallet(walletId: string, registration: BackendWalletRegistration, signal?: AbortSignal): Promise<EvmSigner> {
    return createPrivySigner(this.#settings, this.#request, walletId, registration, signal);
  }

  #request = (path: string, method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal): Promise<unknown> =>
    requestJson(this.#settings, path, method, body, signal);
}

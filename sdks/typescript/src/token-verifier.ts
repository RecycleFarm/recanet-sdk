import { javaUtf8 } from './dmrvn-crypto.js';
import { decodeJavaUtf8 } from './internal/java-utf8.js';
import { javaHttpFetch } from './internal/java-http.js';
import { Duration } from './duration.js';
import { PrivyTokenVerificationConfig } from './privy-config.js';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { PrivyAuthenticationError } from './errors.js';
import { jsonObject, numericDate, parseLosslessJson, type JsonObject } from './internal/lossless-json.js';
import { isJavaBlank } from './member-identity.js';
import { JwksSource, type JwksPolicy } from './internal/jwks.js';

interface TokenVerificationPolicy {
  /** 허용 시계 오차(밀리초). 기본 0, 최대 60000, 소수 허용. */
  readonly clockSkewMs?: number;
  /** UTC epoch 밀리초. 시험 또는 서비스 시계 주입용. */
  readonly now?: () => number;
}

export type TokenVerificationOptions = TokenVerificationPolicy & (
  { readonly publicKeyPem: string; readonly jwksUrl?: never; }
  | { readonly jwksUrl: string; readonly publicKeyPem?: never;
    readonly jwksPolicy?: JwksPolicy; readonly fetch?: typeof globalThis.fetch; }
);
export type { JwksPolicy } from './internal/jwks.js';

export interface AuthenticatedUser {
  readonly appId: string;
  readonly userId: string;
  readonly sessionId: string;
  /** UTC epoch 밀리초. Java Instant 범위를 손실 없이 표현한다. */
  readonly issuedAtMs: bigint;
  readonly expiresAtMs: bigint;
}

const invalid = () => new PrivyAuthenticationError('INVALID_TOKEN');

function publicKey(pem: string): KeyObject {
  try {
    if (typeof pem !== 'string') throw new Error();
    const trimmed = pem.replace(/^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028-\u2029\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028-\u2029\u205f\u3000]+$/gu, '');
    const match = /^-----BEGIN PUBLIC KEY-----([\s\S]+)-----END PUBLIC KEY-----$/.exec(trimmed);
    const base64 = match?.[1]?.replace(/[\x20\t\n\r\f\v]/g, '');
    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) throw new Error();
    const key = createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
    return key;
  } catch { throw new TypeError('검증키는 SPKI P-256 공개키여야 합니다'); }
}

function decode(part: string): Buffer {
  // Nimbus Base64URL accepts padding, either alphabet and ignorable non-alphabet bytes.
  return Buffer.from(part, 'base64');
}

function object(part: string): JsonObject {
  const bytes = decode(part);
  const text = decodeJavaUtf8(bytes);
  return jsonObject(parseLosslessJson(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, 255));
}

/** 재사용 가능한 Privy access token 검증기. 로그인·실시간 철회 조회는 수행하지 않는다. */
export class PrivyTokenVerifier {
  #appId: string;
  #key: KeyObject | undefined;
  #jwks: JwksSource | undefined;
  #skewNs: bigint;
  #now: () => number;

  constructor(appId: string, input: TokenVerificationOptions | PrivyTokenVerificationConfig) {
    const options = input instanceof PrivyTokenVerificationConfig ? input.options() : input;
    if (typeof appId !== 'string' || isJavaBlank(appId)) throw new TypeError('appId는 비공백 문자열이어야 합니다');
    const skew = options.clockSkewMs ?? 0;
    if (!Number.isFinite(skew) || skew < 0 || skew > 60000) throw new TypeError('clockSkewMs는 0–60000 범위여야 합니다');
    this.#appId = appId;
    this.#skewNs = BigInt(Math.round(skew * 1000000));
    this.#now = options.now ?? Date.now;
    if (typeof this.#now !== 'function') throw new TypeError('now 함수가 필요합니다');
    if (options.publicKeyPem !== undefined && options.jwksUrl === undefined) this.#key = publicKey(options.publicKeyPem);
    else if (options.jwksUrl !== undefined && options.publicKeyPem === undefined) {
      this.#jwks = new JwksSource(options.jwksUrl, options.jwksPolicy ?? {}, options.fetch ?? javaHttpFetch(Duration.ofMillis(options.jwksPolicy?.timeoutMs ?? 5000), Duration.ofMillis(options.jwksPolicy?.timeoutMs ?? 5000), true), this.#now);
    } else throw new TypeError('고정 공개키와 JWKS 중 하나만 지정해야 합니다');
  }

  async authenticateAuthorizationHeader(header: string | null | undefined): Promise<AuthenticatedUser> {
    if (header == null) throw new PrivyAuthenticationError('MISSING_TOKEN');
    if (typeof header !== 'string' || header.length > 16416) throw invalid();
    if (isJavaBlank(header)) throw new PrivyAuthenticationError('MISSING_TOKEN');
    // Java Pattern의 \s는 ASCII 공백 집합이다. 앞뒤 trim을 하지 않는다.
    const match = /^Bearer +([^\x20\t\n\x0b\f\r,]+)$/i.exec(header);
    if (!match || match[0].length !== header.length) throw invalid();
    return this.verifyAccessToken(match[1]);
  }

  async verifyAccessToken(token: string | null | undefined): Promise<AuthenticatedUser> {
    if (token == null) throw new PrivyAuthenticationError('MISSING_TOKEN');
    if (typeof token !== 'string' || token.length > 16384) throw invalid();
    if (isJavaBlank(token)) throw new PrivyAuthenticationError('MISSING_TOKEN');
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw invalid();
      const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
      const header = object(encodedHeader);
      if (header.alg !== 'ES256' || typeof header.typ !== 'string' || header.typ.toUpperCase() !== 'JWT'
        || (header.crit != null && (!Array.isArray(header.crit) || header.crit.length !== 0))
        || (header.kid != null && (typeof header.kid !== 'string' || header.kid.length > 256))) throw invalid();
      const claims = object(encodedClaims);
      const user = this.#claims(claims);
      const keys = this.#key ? [this.#key] : await this.#jwks!.keys(typeof header.kid === 'string' ? header.kid : undefined);
      const signature = decode(encodedSignature);
      if (signature.length !== 64 || !keys.some(key => verify('sha256', javaUtf8(`${encodedHeader}.${encodedClaims}`),
        { key, dsaEncoding: 'ieee-p1363' }, signature))) throw invalid();
      this.#claims(claims);
      return user;
    } catch (error) {
      if (error instanceof PrivyAuthenticationError) throw error;
      throw invalid();
    }
  }

  #claims(claims: JsonObject): AuthenticatedUser {
    const aud = claims.aud;
    if (claims.iss !== 'privy.io'
      || !(aud === this.#appId || (Array.isArray(aud) && aud.length === 1 && aud[0] === this.#appId))
      || typeof claims.sub !== 'string' || !claims.sub.startsWith('did:privy:') || claims.sub.length <= 10
      || typeof claims.sid !== 'string' || isJavaBlank(claims.sid)
      || (claims.linked_accounts !== undefined && claims.linked_accounts !== null)) throw invalid();
    const issuedAtMs = numericDate(claims.iat) * 1000n;
    const expiresAtMs = numericDate(claims.exp) * 1000n;
    const nbfMs = claims.nbf == null ? undefined : numericDate(claims.nbf) * 1000n;
    const current = this.#now();
    if (!Number.isSafeInteger(current)) throw invalid();
    const nowNs = BigInt(current) * 1000000n;
    if (expiresAtMs <= issuedAtMs || issuedAtMs * 1000000n > nowNs + this.#skewNs
      || (nbfMs !== undefined && nbfMs * 1000000n > nowNs + this.#skewNs)) throw invalid();
    if (expiresAtMs * 1000000n <= nowNs - this.#skewNs) throw new PrivyAuthenticationError('EXPIRED_TOKEN');
    return Object.freeze({ appId: this.#appId, userId: claims.sub, sessionId: claims.sid, issuedAtMs, expiresAtMs });
  }
}

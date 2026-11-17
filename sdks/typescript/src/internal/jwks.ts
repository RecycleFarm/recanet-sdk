import { trustedJwksUri } from './dmrvn-uri.js';
import { isJavaHttpFetch } from './java-http.js';
import { decodeJavaUtf8 } from './java-utf8.js';
import { createPublicKey, type KeyObject } from 'node:crypto';
import { PrivyAuthenticationError } from '../errors.js';
import { jsonObject, parseLosslessJson } from './lossless-json.js';

export interface JwksPolicy {
  readonly timeoutMs?: number | bigint;
  readonly cacheTtlMs?: number | bigint;
  readonly refreshCooldownMs?: number | bigint;
}

interface VerificationKey {
  readonly key: KeyObject;
  readonly kid: string | undefined;
  readonly alg: string | undefined;
  readonly use: string | undefined;
}

const failure = () => new PrivyAuthenticationError('KEY_SOURCE_UNAVAILABLE');

function positive(value: number | bigint, name: string): bigint {
  if ((typeof value === 'number' && !Number.isSafeInteger(value)) || BigInt(value) < 1n || BigInt(value) > 9223372036854775807n) throw new TypeError(`${name}는 양의 안전한 정수여야 합니다`);
  return BigInt(value);
}

async function retrieve(url: string, fetch: typeof globalThis.fetch, timeoutMs: number): Promise<VerificationKey[]> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  // connect/header 및 각 read에 별도 대기 상한. 자동 재시도나 외부 인증 header가 없다.
  const timed = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(failure());
      }, timeoutMs);
    });
    try { return await Promise.race([timeout, operation]); }
    finally { clearTimeout(timer); }
  };
  try {
    const pending = fetch(url, { signal: controller.signal, redirect: 'error', credentials: 'omit' });
    // 주입 fetch가 AbortSignal을 무시하고 늦게 응답해도 body를 해제한다.
    void pending.then(response => {
      if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
    }, () => {});
    const response = await (isJavaHttpFetch(fetch) ? pending : timed(pending));
    if (response.status !== 200 || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw failure();
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await timed(reader.read());
      if (done) break;
      size += value.byteLength;
      if (size > 131072) throw failure();
      chunks.push(value);
    }
    const text = decodeJavaUtf8(Buffer.concat(chunks, size));
    const jwks = jsonObject(parseLosslessJson(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, 255));
    if (!Array.isArray(jwks.keys)) throw failure();
    const result: VerificationKey[] = [];
    for (const item of jwks.keys) {
      const jwk = jsonObject(item);
      if (typeof jwk.kty !== 'string') throw failure();
      if (jwk.kty !== 'EC') continue;
      if (typeof jwk.crv !== 'string') throw failure();
      for (const field of ['kid', 'use', 'alg']) {
        if (jwk[field] != null && typeof jwk[field] !== 'string') throw failure();
      }
      const size = jwk.crv === 'P-256' ? 32 : jwk.crv === 'P-384' ? 48 : jwk.crv === 'P-521' ? 66 : 0;
      if (!size) throw failure();
      const coordinate = (value: unknown): string => {
        if (typeof value !== 'string') throw failure();
        let decoded = Buffer.from(value, 'base64');
        while (decoded.length > size && decoded[0] === 0) decoded = decoded.subarray(1);
        if (decoded.length > size) throw failure();
        return Buffer.concat([Buffer.alloc(size - decoded.length), decoded]).toString('base64url');
      };
      const key = createPublicKey({ key: { kty: 'EC', crv: jwk.crv, x: coordinate(jwk.x), y: coordinate(jwk.y) }, format: 'jwk' });
      if (jwk.crv !== 'P-256') continue;
      result.push({ key, kid: jwk.kid as string | undefined, alg: jwk.alg as string | undefined,
        use: jwk.use as string | undefined });
    }
    return result;
  } catch {
    controller.abort();
    void reader?.cancel().catch(() => {});
    throw failure();
  } finally {
    reader?.releaseLock();
  }
}

/** 인스턴스별 키 캐시. 인증 성공 결과는 캐시하지 않는다. */
export class JwksSource {
  #url: string;
  #fetch: typeof globalThis.fetch;
  #timeout: number;
  #ttl: bigint;
  #cooldown: bigint;
  #now: () => number;
  #keys: VerificationKey[] | undefined;
  #expires = 0n;
  #windowEnd = 0n;
  #calls = 0;
  #pending: Promise<VerificationKey[]> | undefined;

  constructor(url: string, policy: JwksPolicy, fetch: typeof globalThis.fetch, now: () => number) {
    this.#url = trustedJwksUri(url);
    this.#fetch = fetch;
    const timeout = positive(policy.timeoutMs ?? 5000, 'JWKS timeoutMs');
    if (timeout > 2147483647n) throw new TypeError('JWKS timeout too large');
    this.#timeout = Number(timeout);
    this.#ttl = positive(policy.cacheTtlMs ?? 300000, 'cacheTtlMs');
    this.#cooldown = positive(policy.refreshCooldownMs ?? 30000, 'refreshCooldownMs');
    if (this.#timeout > 2147483647 || this.#ttl <= this.#cooldown) throw new TypeError('JWKS 캐시/timeout 설정이 올바르지 않습니다');
    if (typeof fetch !== 'function') throw new TypeError('fetch가 필요합니다');
    this.#now = now;
  }

  async keys(kid: string | undefined): Promise<readonly KeyObject[]> {
    let keys = this.#keys;
    if (!keys || BigInt(this.#now()) >= this.#expires) {
      keys = await this.#refresh();
    }
    const select = (entries: VerificationKey[]) => entries.filter(entry =>
      (kid === undefined || entry.kid === kid) && (entry.alg == null || entry.alg === 'ES256')
      && (entry.use == null || entry.use === 'sig')).map(entry => entry.key);
    let result = select(keys);
    if (result.length === 0) result = select(await this.#refresh());
    return result;
  }

  #refresh(): Promise<VerificationKey[]> {
    if (this.#pending) return this.#pending;
    const now = BigInt(this.#now());
    if (now >= this.#windowEnd) { this.#windowEnd = now + this.#cooldown; this.#calls = 0; }
    if (this.#calls >= 2) return Promise.reject(failure());
    this.#calls++;
    const pending = retrieve(this.#url, this.#fetch, this.#timeout).then(keys => {
      this.#keys = keys;
      this.#expires = BigInt(this.#now()) + this.#ttl;
      return keys;
    }).finally(() => { this.#pending = undefined; });
    this.#pending = pending;
    return pending;
  }
}

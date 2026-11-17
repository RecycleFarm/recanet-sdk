import { privyOrigin, trustedJwksUri } from './internal/dmrvn-uri.js';
import { Duration } from './duration.js';
import { isJavaBlank } from './member-identity.js';
import type { TokenVerificationOptions } from './token-verifier.js';

function text(value: string): string {
  if (typeof value !== 'string' || isJavaBlank(value)) throw new TypeError('Nonblank value required');
  return value;
}
function positive(value: Duration): Duration {
  if (!(value instanceof Duration) || value.isNegative() || value.toMillis() < 1n) throw new TypeError('At least one millisecond required');
  return value;
}

/** Immutable Java-compatible configuration; secret getters are explicit. */
export class PrivyClientConfig {
  #appId: string; #secret: string; #origin: string; #timeout: Duration;
  #verification: TokenVerificationOptions | undefined;
  constructor(appId: string, appSecret: string, baseUri = 'https://api.privy.io', requestTimeout = Duration.ofSeconds(30)) {
    this.#appId = text(appId); this.#secret = text(appSecret);
    if (/[:\u0000-\u0020\u007f-\u009f\u1680\u2000-\u2006\u2008-\u200a\u2028-\u2029\u205f\u3000]/u.test(appId)) throw new TypeError('Invalid appId');
    this.#origin = privyOrigin(baseUri); this.#timeout = positive(requestTimeout);
    Object.freeze(this);
  }
  withTokenVerification(verification: PrivyTokenVerificationConfig | TokenVerificationOptions): PrivyClientConfig {
    if (!verification) throw new TypeError('Verification configuration required');
    const result = new PrivyClientConfig(this.#appId, this.#secret, this.#origin, this.#timeout);
    result.#verification = verification instanceof PrivyTokenVerificationConfig ? verification.options() : verification;
    return result;
  }
  appId(): string { return this.#appId; }
  appSecret(): string { return this.#secret; }
  baseUri(): string { return this.#origin; }
  requestTimeout(): Duration { return this.#timeout; }
  toString(): string { return `PrivyClientConfig[appId=${this.#appId}, appSecret=[REDACTED], baseUri=${this.#origin}, requestTimeoutNanos=${this.#timeout.nanoseconds}]`; }
  toJSON(): Record<string, unknown> { return { appId: this.#appId, appSecret: '[REDACTED]', baseUri: this.#origin }; }
  /** @internal */
  verificationOptions(): TokenVerificationOptions | undefined { return this.#verification; }
}

/** Lazy key-source configuration, with the same validation timing as Java. */
export class PrivyTokenVerificationConfig {
  #source: { publicKeyPem: string } | { jwksUrl: string };
  #skew = Duration.ZERO; #timeout = Duration.ofSeconds(5);
  #ttl = Duration.ofMinutes(5); #cooldown = Duration.ofSeconds(30);
  private constructor(source: { publicKeyPem: string } | { jwksUrl: string }) { this.#source = source; }
  static usingJwks(uri: string): PrivyTokenVerificationConfig {
    trustedJwksUri(uri);
    return new PrivyTokenVerificationConfig({ jwksUrl: uri });
  }
  static usingPublicKey(pem: string): PrivyTokenVerificationConfig { return new PrivyTokenVerificationConfig({ publicKeyPem: text(pem) }); }
  withClockSkew(skew: Duration): PrivyTokenVerificationConfig {
    if (!(skew instanceof Duration) || skew.isNegative() || skew.compareTo(Duration.ofMinutes(1)) > 0) throw new TypeError('Invalid clock skew');
    const result = this.#copy(); result.#skew = skew; return result;
  }
  withJwksPolicy(timeout: Duration, ttl: Duration, cooldown: Duration): PrivyTokenVerificationConfig {
    positive(timeout); positive(ttl); positive(cooldown);
    if (timeout.toMillis() > 2147483647n || ttl.toMillis() <= cooldown.toMillis()) throw new TypeError('Invalid JWKS policy');
    const result = this.#copy(); result.#timeout = timeout; result.#ttl = ttl; result.#cooldown = cooldown; return result;
  }
  #copy(): PrivyTokenVerificationConfig {
    const result = new PrivyTokenVerificationConfig(this.#source);
    result.#skew = this.#skew; result.#timeout = this.#timeout; result.#ttl = this.#ttl; result.#cooldown = this.#cooldown;
    return result;
  }
  clockSkew(): Duration { return this.#skew; }
  jwksTimeout(): Duration { return this.#timeout; }
  cacheTtl(): Duration { return this.#ttl; }
  refreshCooldown(): Duration { return this.#cooldown; }
  /** @internal */
  options(): TokenVerificationOptions {
    if ('publicKeyPem' in this.#source) return { ...this.#source, clockSkewMs: Number(this.#skew.nanoseconds) / 1000000 };
    return { ...this.#source, clockSkewMs: Number(this.#skew.nanoseconds) / 1000000,
      jwksPolicy: { timeoutMs: this.#timeout.toMillis(), cacheTtlMs: this.#ttl.toMillis(), refreshCooldownMs: this.#cooldown.toMillis() } };
  }
}

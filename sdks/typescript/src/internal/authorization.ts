import { Float32, Float64 } from '../number-value.js';
import { DmrvnDecimal } from '../dmrvn-json.js';
import { JsonNumber } from './lossless-json.js';
import { javaDouble } from './java-number.js';
import { createPrivateKey, sign } from 'node:crypto';

export interface SignedRequest {
  readonly bodyJson: string;
  readonly signature: string;
  readonly idempotencyKey: string | undefined;
}

/** Privy 0.59 호환 경로. 표준 JCS나 DMRVN 정규화에 재사용하지 않는다 (D-11). */
export function canonicalPrivy059(value: unknown): string {
  if (value instanceof JsonNumber) return value.source;
  if (value instanceof Float32 || value instanceof Float64 || value instanceof DmrvnDecimal) {
    const literal=value.toString();return ['NaN','Infinity','-Infinity'].includes(literal)?JSON.stringify(literal):literal;
  }
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || Object.is(value,-0))) return Number.isFinite(value)?javaDouble(value):JSON.stringify(String(value));

  if (value === null || typeof value !== 'object') {
    const scalar = JSON.stringify(value);
    if (scalar === undefined) throw new TypeError('JSON 값이 필요합니다');
    // Jackson의 제어문자 Unicode escape는 대문자 hex를 사용한다.
    // 이스케이프된 역슬래시를 먼저 한 토큰으로 소비하여 문자열 "\\u000f"의
    // 실제 내용까지 대문자로 바꾸지 않는다.
    return scalar.replace(/\\(?:u00[01][a-f0-9]|.)/g,
      part => part.startsWith('\\u00') ? '\\u' + part.slice(2).toUpperCase() : part);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalPrivy059).join(',') + ']';
  const object = value as Record<string, unknown>;
  // 기준 의존성은 key를 escape하지 않는다. 이 비표준 동작은 명시적 호환 경계다.
  return '{' + Object.keys(object).sort().map(key => '"' + key + '":' + canonicalPrivy059(object[key])).join(',') + '}';
}

export function authorizationPrivateKey(privateKey: string): string {
  const base64 = privateKey.replaceAll('-----BEGIN PRIVATE KEY-----', '').replaceAll('-----END PRIVATE KEY-----', '')
    .replace(/[\x20\t\n\r\f\v]/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    throw new TypeError('승인 개인키는 PKCS#8 Base64 또는 PEM이어야 합니다');
  }
  return base64;
}

/** 단 한 번 snapshot한 body를 서명과 전송 모두에 사용한다. */
export function prepareAuthorization(appId: string, url: string, body: unknown, privateKey: string,
  idempotencyKey?: string): SignedRequest {
  const snapshot = snapshotWire(body);
  const bodyJson = wireJson(snapshot);
  const headers: Record<string, string> = { 'privy-app-id': appId };
  const wireKey = idempotencyKey;
  if (wireKey !== undefined) headers['privy-idempotency-key'] = wireKey;
  const canonical = canonicalPrivy059({ version: 1, method: 'POST', url, body: snapshot, headers });
  try {
    const key = createPrivateKey({ key: Buffer.from(authorizationPrivateKey(privateKey), 'base64'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
    const signature = sign('sha256', Buffer.from(canonical, 'utf8'), { key, dsaEncoding: 'der' }).toString('base64');
    return Object.freeze({ bodyJson, signature, idempotencyKey: wireKey });
  } catch {
    throw new TypeError('승인 요청에 P-256 PKCS#8 개인키가 필요합니다');
  }
}

// Keep the Java numeric class until both the wire body and authorization digest have been encoded.
function snapshotWire(value: unknown): unknown {
  if (value instanceof Float32 || value instanceof Float64 || value instanceof DmrvnDecimal) {
    const source = value.toString();
    return ['NaN','Infinity','-Infinity'].includes(source) ? source : new JsonNumber(source);
  }
  if (typeof value === 'bigint') return new JsonNumber(String(value));
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return Number.isNaN(value) ? 'NaN' : value < 0 ? '-Infinity' : 'Infinity';
    return Number.isSafeInteger(value) && !Object.is(value,-0) ? value : new JsonNumber(javaDouble(value));
  }
  if (value !== null && typeof value === 'object') {
    if ('toJSON' in value && typeof value.toJSON === 'function') return snapshotWire(value.toJSON());
    if (Array.isArray(value)) return value.map(snapshotWire);
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,snapshotWire(item)]));
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') throw new TypeError('JSON value required');
  return value;
}
function wireJson(value: unknown): string {
  if (value instanceof JsonNumber) return value.source;
  if (Array.isArray(value)) return '[' + value.map(wireJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).map(([key,item])=>JSON.stringify(key)+':'+wireJson(item)).join(',') + '}';
  return JSON.stringify(value).replace(/\\(?:u00[01][a-f0-9]|.)/g,part=>part.startsWith('\\u00')?'\\u'+part.slice(2).toUpperCase():part);
}

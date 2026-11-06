import { createPrivateKey, sign } from 'node:crypto';

export interface SignedRequest {
  readonly bodyJson: string;
  readonly signature: string;
  readonly idempotencyKey: string | undefined;
}

/** Privy 0.59 호환 경로. 표준 JCS나 DMRVN 정규화에 재사용하지 않는다 (D-11). */
export function canonicalPrivy059(value: unknown): string {
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
  const bodyJson = JSON.stringify(body);
  if (bodyJson === undefined) throw new TypeError('요청 body가 필요합니다');
  const snapshot: unknown = JSON.parse(bodyJson);
  const headers: Record<string, string> = { 'privy-app-id': appId };
  if (idempotencyKey !== undefined) headers['privy-idempotency-key'] = idempotencyKey;
  const canonical = canonicalPrivy059({ version: 1, method: 'POST', url, body: snapshot, headers });
  try {
    const key = createPrivateKey({ key: Buffer.from(authorizationPrivateKey(privateKey), 'base64'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
    const signature = sign('sha256', Buffer.from(canonical, 'utf8'), { key, dsaEncoding: 'der' }).toString('base64');
    return Object.freeze({ bodyJson, signature, idempotencyKey });
  } catch {
    throw new TypeError('승인 요청에 P-256 PKCS#8 개인키가 필요합니다');
  }
}

import { createHash } from 'node:crypto';

// Java Character.isWhitespace와 동일한 집합. JS trim은 NBSP도 제거한다.
const JAVA_BLANK = /^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028-\u2029\u205f\u3000]*$/u;

/** Java String.isBlank 호환 판정. */
export function isJavaBlank(value: string): boolean {
  return JAVA_BLANK.test(value);
}

/** Java UTF-8 인코더처럼 고립 surrogate를 '?' 바이트로 대체한다 (D-06 미결). */
function javaUtf8(value: string): Buffer {
  return Buffer.from(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    part => part.length === 2 ? part : '?'), 'utf8');
}

/** 회원 ID는 인증 수단이 아니다. 서비스에서 인증·tenant 권한을 먼저 확인한다. */
export function memberExternalId(namespace: string, userId: string, partnerId?: number): string {
  if (typeof namespace !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)) {
    throw new TypeError('namespace는 1–64자의 ASCII 영숫자, 밑줄, 하이픈이어야 합니다');
  }
  if (typeof userId !== 'string' || isJavaBlank(userId)) {
    throw new TypeError('userId는 비공백 문자열이어야 합니다');
  }
  if (partnerId !== undefined && (!Number.isInteger(partnerId) || partnerId < 1 || partnerId > 0xffffffff)) {
    throw new TypeError('partnerId는 양의 uint32여야 합니다');
  }
  const preimage = namespace + '\0' + (partnerId === undefined ? '' : `${partnerId}\0`) + userId;
  const digest = createHash('sha256').update(javaUtf8(preimage)).digest('base64url');
  return (partnerId === undefined ? 'user_' : 'partner_') + digest;
}

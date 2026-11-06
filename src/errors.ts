export type PrivyApiErrorCode = 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'RATE_LIMITED'
  | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'INTERRUPTED';

/** 외부 응답 본문·자격 증명·원인 예외를 보관하지 않는 API 오류. */
export class PrivyApiError extends Error {
  readonly code: PrivyApiErrorCode;
  readonly statusCode: number;
  /** 서버가 제시한 대기 시간(밀리초). SDK는 자동 재시도하지 않는다. */
  readonly retryAfterMs: bigint | undefined;

  constructor(code: PrivyApiErrorCode, statusCode = 0, retryAfterMs?: bigint) {
    super(`Privy API 요청 실패: ${code}`);
    this.name = 'PrivyApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

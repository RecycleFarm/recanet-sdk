export type PrivyApiErrorCode = 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'RATE_LIMITED'
  | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'INTERRUPTED';

export type PrivyAuthenticationErrorCode = 'MISSING_TOKEN' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'KEY_SOURCE_UNAVAILABLE';

export type DmrvnErrorCode = 'UNAUTHORIZED_SIGNER' | 'RPC_UNAVAILABLE' | 'INTERRUPTED'
  | 'INVALID_INPUT' | 'GAS_ESTIMATION_FAILED' | 'WRONG_CHAIN' | 'SUBMISSION_UNRESOLVED' | 'SIGNATURE_INVALID';

export type TransactionQueryErrorCode = 'WRONG_CHAIN' | 'CHAIN_CHANGED' | 'RPC_UNAVAILABLE' | 'INVALID_RESPONSE' | 'INTERRUPTED';

/** 조회 오류는 부재나 빈 목록으로 변환하지 않는다. */
export class TransactionQueryError extends Error {
  readonly code: TransactionQueryErrorCode;
  constructor(code: TransactionQueryErrorCode) {
    super(`거래 조회 실패: ${code}`);
    this.name = 'TransactionQueryError';
    this.code = code;
  }
}

/** 서명/RPC 경계의 정리된 오류. 제출 여부를 확정하지 않는다. */
export class DmrvnError extends Error {
  readonly code: DmrvnErrorCode;
  constructor(code: DmrvnErrorCode) {
    super(code);
    this.name = 'DmrvnError';
    this.code = code;
  }
}

/** 원본 token이나 검증 라이브러리의 예외를 포함하지 않는다. */
export class PrivyAuthenticationError extends Error {
  readonly code: PrivyAuthenticationErrorCode;

  constructor(code: PrivyAuthenticationErrorCode) {
    super(`Privy 사용자 인증 실패: ${code}`);
    this.name = 'PrivyAuthenticationError';
    this.code = code;
  }
}

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

export type PrivyApiErrorCode = 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'RATE_LIMITED'
  | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'INTERRUPTED';

export type PrivyAuthenticationErrorCode = 'MISSING_TOKEN' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'KEY_SOURCE_UNAVAILABLE';

const dmrvnCodes = ['UNAUTHORIZED_SIGNER', 'RPC_UNAVAILABLE', 'INTERRUPTED',
  'INVALID_INPUT', 'GAS_ESTIMATION_FAILED', 'WRONG_CHAIN', 'SUBMISSION_UNRESOLVED', 'SIGNATURE_INVALID', 'REPORT_MISMATCH',
  'METHODOLOGY_UNAVAILABLE', 'EVIDENCE_CONTRACT_UNCONFIGURED',
  'DEPLOYMENT_NOT_READY', 'UNAPPROVED_IMPLEMENTATION', 'DEPLOYMENT_COLLISION', 'JOURNAL_UNAVAILABLE',
  'STORAGE_ACCESS_DENIED', 'STORAGE_UNAVAILABLE', 'DEPLOYMENT_MISMATCH', 'OPERATION_INPUT_CHANGED',
  'OPERATION_NOT_PREPARED', 'SUBMISSION_INPUT_CHANGED', 'OBJECT_UNSEALED', 'STORAGE_CREATE_UNRESOLVED',
  'STORAGE_ACCOUNT_UNFUNDED', 'STORAGE_MISMATCH', 'REQUEST_EXPIRED', 'NONCE_CONFLICT', 'INSUFFICIENT_FUNDS',
  'REPORT_LOOKUP_RANGE', 'REPORT_TX_NOT_FOUND', 'REPORT_READ_FAILED'] as const;
export type DmrvnErrorCode = typeof dmrvnCodes[number];
export function isDmrvnErrorCode(value: unknown): value is DmrvnErrorCode {
  return typeof value === 'string' && (dmrvnCodes as readonly string[]).includes(value);
}

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
  readonly definitelyNotBroadcast: boolean;
  readonly definitelyRejected: boolean;
  constructor(code: DmrvnErrorCode, facts: { readonly definitelyNotBroadcast?: boolean; readonly definitelyRejected?: boolean } = {}) {
    super(code);
    this.name = 'DmrvnError';
    this.code = code;
    this.definitelyNotBroadcast = facts.definitelyNotBroadcast === true;
    this.definitelyRejected = facts.definitelyRejected === true;
  }
  retryable(): boolean {
    return ['SUBMISSION_UNRESOLVED', 'STORAGE_CREATE_UNRESOLVED', 'OBJECT_UNSEALED', 'STORAGE_UNAVAILABLE',
      'RPC_UNAVAILABLE', 'REPORT_TX_NOT_FOUND', 'REPORT_READ_FAILED', 'JOURNAL_UNAVAILABLE', 'METHODOLOGY_UNAVAILABLE'].includes(this.code);
  }
  action(): 'RECONCILE_ONLY' | 'FUND_CONFIGURED_ROLE' | 'RETRY_SAME_OPERATION' | 'FIX_INPUT_OR_CONFIGURATION' {
    if (this.code === 'SUBMISSION_UNRESOLVED' || this.code === 'STORAGE_CREATE_UNRESOLVED') return 'RECONCILE_ONLY';
    if (this.code === 'STORAGE_ACCOUNT_UNFUNDED' || this.code === 'INSUFFICIENT_FUNDS') return 'FUND_CONFIGURED_ROLE';
    return this.retryable() ? 'RETRY_SAME_OPERATION' : 'FIX_INPUT_OR_CONFIGURATION';
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

/** Same logical precondition failure as Java IllegalStateException; no domain error code. */
export class IllegalStateError extends Error {
  constructor(message: string) { super(message); this.name = 'IllegalStateException'; }
}

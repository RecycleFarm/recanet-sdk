import type { DmrvnErrorCode } from './errors.js';

export type ActivityStage = 'REQUEST_ACCEPTED' | 'BENEFICIARY_READY' | 'EVIDENCE_SIGNED' | 'EVIDENCE_CREATE_BROADCAST'
  | 'EVIDENCE_SEALED' | 'CLAIM_APPROVED' | 'BENEFICIARY_SIGNED' | 'SUBMISSION_BROADCAST' | 'SUBMISSION_CONFIRMED';
export interface ActivityOutcome {
  readonly outcome: 'CONFIRMED' | 'UNKNOWN' | 'FAILED';
  readonly lastConfirmedStage: ActivityStage;
  /** ID와 관찰 사실이다. 각 필드의 존재 조건은 API 문서를 확인한다. */
  readonly confirmed: Record<string, unknown>;
  readonly requested: Record<string, unknown>;
  readonly errorCode?: DmrvnErrorCode;
}

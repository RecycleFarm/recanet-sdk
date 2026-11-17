/** 기록은 분리된 JSON snapshot이어야 한다. 개인키는 journal에 넣지 않는다. */
export interface OperationJournal {
  /** durable 어댑터는 작업자 간 잠금과 소유권 상실 후 쓰기/부작용 차단을 제공해야 한다. */
  withLock<T>(key: string, action: () => T | Promise<T>): Promise<T>;
  load(key: string): Promise<Record<string, unknown> | null>;
  /** durable 어댑터는 반환 전에 저장 완료를 보장해야 한다. */
  store(key: string, snapshot: Readonly<Record<string, unknown>>): Promise<void>;
  /** 전역 claim-id lock 하에서 배포 전체의 operation을 찾아야 한다. 미지원이면 닫힌 실패다. */
  findOperationsByClaimId?(claimId: string): Promise<readonly Record<string, unknown>[]>;
}

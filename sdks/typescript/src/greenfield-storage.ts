/** 주소와 네트워크를 식별하는 저장소 서명자. EVM 운영 지갑과 같을 필요는 없다. */
export interface GreenfieldIdentity {
  readonly address: string;
  readonly chainId: string;
}

export interface GreenfieldHead {
  readonly exists: boolean;
  readonly sealed: boolean;
}

/** 읽기는 실제 Greenfield 객체를 조회해야 한다. DB 사본으로 대체하지 않는다. */
export interface GreenfieldStorage extends GreenfieldIdentity {
  head(location: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<GreenfieldHead>;
  /** private 객체를 한 번 만들고 원래 CreateObject transaction hash를 반환한다. */
  create(location: Readonly<Record<string, unknown>>, bytes: Uint8Array, signal?: AbortSignal): Promise<string>;
  /** 원래 생성 hash를 재사용한다. 이 메서드는 객체를 생성하지 않는다. */
  upload(location: Readonly<Record<string, unknown>>, bytes: Uint8Array, createTxHash: string, signal?: AbortSignal): Promise<void>;
  read(location: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Uint8Array>;
  /** 해당 uploader가 이 객체를 만든 원래 거래임을 읽기 전용으로 확인한다. */
  matchesCreateTransaction(location: Readonly<Record<string, unknown>>, createTxHash: string, signal?: AbortSignal): Promise<boolean>;
}

# 개발 현황

기준: 2026-11-06, Java `37c78cfa01d9892ca26de61bb74df827923917cf`.
작은 단위마다 구현 → 로컬 검증 → 독립 리뷰 → 수정 → 커밋을 반복한다.

| 순서 | 범위 | 상태 |
| --- | --- | --- |
| 1 | TypeScript/ESM 빌드 기반 | 구현 |
| 2 | 회원 식별자·바이트 계산 (C-01 일부) | 구현, 문서 벡터 8개와 경계 시험 통과 |
| 3 | 서버 인증·제한된 HTTP (C-02 일부) | 구현, 로컬 HTTP 및 주입 fetch 시험 통과 |
| 4a | 공개키 JWT (C-02 일부) | 구현, 생성 P-256 서명으로 문서 claim 23개 및 경계 시험 통과 |
| 4b | JWKS (C-02 일부) | 구현, 동시 조회·회전·캐시·조회 제한·장애 시험 통과 |
| 4c | 승인키 생성·운영 지갑 등록/조회·회원 조회/생성 (C-01 일부) | 구현, pagination·중복·409 경쟁 복구 시험 통과 |
| 4d | Privy 요청 승인 서명 (C-03 일부) | 구현, canonical payload/digest 3개·DER 검증·snapshot 결속 시험 통과 |
| 4e | 운영 지갑 메시지/EIP-712/거래 제출 (C-03 일부) | 구현, 정확한 body/header·권한·오류·무재시도 시험 통과 |
| 4f | 회원 서명·파트너 권한 어댑터 (C-01 일부) | 구현, 권한 거부·철회·콜백 오류·snapshot 시험 통과 |
| 4g | 지갑 export·초기화 편의 기능의 미결 정책 | 남은 작업 |
| 5a | EVM HTTP RPC·체인 JSON (C-04 기반) | 구현, id/응답·JSON 정밀도·4 MiB·deadline/취소 시험 통과 |
| 5b | ETH 잔액·전송 (C-04 일부) | 구현, 정확한 wei·호출 순서·실패 경계 시험 통과 |
| 5c | 거래 상세/상태 (C-04 일부) | 구현, 상태·receipt/블록 결속·수치 경계·snapshot 시험 통과 |
| 5d | 발신 거래 목록/cursor (C-04 일부) | 구현, 블록 내부/100블록 페이지·anchor·reorg·cursor 벡터 시험 통과 |
| 6a | DMRVN 암호·JSON (C-05 일부) | 구현, 복구/JSON/escape 고정 벡터 시험 통과 |
| 6b | ABI (C-05 일부) | 구현, selector/topic·과거 calldata·strict decode 시험 통과 |
| 6c | EIP-712·provenance·commitment (C-05 일부) | 구현, 6개 타입/3개 digest·PET 해시/서명/calldata 시험 통과 |
| 6d | 방법론·Evidence 본문 (C-05 일부) | 구현, manifest/WASM·버전·본문 7키/1 MiB 시험 통과 |
| 6e | 배포 manifest·config (C-06 일부) | 구현, 정규화·릴리스/identity·저장소/비용 범위 시험 통과 |
| 6f | 배포 실측·Chain 읽기 (C-06 일부) | 구현, pinned tag·slot/release/code/domain·변경 실패 시험 통과 |
| 6g | preflight·저장소 경계 (C-06 일부) | 구현, 항목별 결과/오류·무부작용·준비 의미 시험 통과 |
| 6h | journal 경계·메모리 상태 (C-08 일부) | 구현, 동시/중첩 잠금·snapshot·claim 검색 시험 통과 |
| 6i | 공개 Greenfield 객체 reader (C-11 기반) | 구현, 직접 GET·인코딩·권한/크기/timeout·취소 시험 통과 |
| 6j | Evidence 준비·생성 복구 (C-07 일부) | 구현, intent·서명/hash 재사용·예약·정확 bytes·동시 호출 시험 통과 |
| 6k | Claim 승인 (C-09 일부) | 구현, 서명 전 요청 저장·원 요청 재사용·예약·승인 검증 시험 통과 |
| 6l | 대납/직접 제출 준비·beneficiary 서명 기록 (C-09 일부) | 구현, 고정 gas·mode 충돌·서명 fingerprint·직접 intent 시험 통과 |
| 6m | receipt·이벤트·bounded 로그 검색 (C-09–11 기반) | 구현, 블록 결속·최초 일치·1000블록 창/범위·오류 시험 통과 |
| 6n | 영속 journal·전송/확인·보고서 (C-08–11) | 예정 |
| 7 | 실제 외부 서비스 인수 (C-12) | 미실행 |

로컬 시험과 실제 Privy/체인/Greenfield 인수는 별개다. 모든 기능 구현 또는 운영 인수 완료를 의미하지 않는다.

## 검증 기록

- Node 25.5.0, TypeScript 6.0.3: 빌드 및 `npm run check` 통과.
- 회원 식별자: 문서 계산 벡터 8개, Java 공백 집합·입력 경계·Unicode 비정규화 시험.
- 서버 통신: 초기화 무통신, 인증 header, 설정 snapshot, 비밀 비노출, 상태 오류·재시도 0회,
  JSON 오류, Retry-After 첫 필드·날짜·int64 경계, 정확히 4 MiB/초과 body,
  loopback HTTP의 body timeout과 AbortSignal 취소.
- 독립 리뷰의 Retry-After 중복 헤더 처리 지적을 수정하고 회귀 시험 추가.
- 고정 SPKI P-256 JWT: 문서 claim 사례 23개를 생성한 키로 서명해 검증. 위조·변조·header,
  NumericDate 정밀도/범위·Bearer·시계/skew·오류 비노출 시험. 서명 전후 claim 재검사.
- 문서 claim fixture는 계산 사례이며 실제 Privy token을 수집한 자료가 아니다.
- JWKS: 동시 32건 최초/unknown-kid 조회 공유, 5분 TTL, 30초당 최대 2회 갱신,
  키 회전, 캐시 만료 후 조회 실패의 인증 거부, 128 KiB 경계, 로컬 HTTP 읽기 timeout,
  사전 claim 실패 시 조회 0회, 키 조회 중 만료의 사후 검사. 전체 28개 테스트 통과.
- 지갑: P-256 생성 키의 실제 서명/검증·PEM 형식·개인키 비노출, 등록 body/선택 필드,
  운영 목록·legacy 소유권 비교, 회원 pagination/중복·cursor 검증, 409 재조회 성공/실패,
  503/응답 유실 시 재생성 없음. 전체 38개 테스트 통과.
- 키 자동 로깅·환경변수 기반 ensureBackendWallet·export는 아직 미구현.
  결정이 필요한 편의 기능을 자동으로 채택하지 않으며, 남은 범위를 완료로 계산하지 않는다.
- 요청 승인: Privy 0.59의 합성 벡터 3개 canonical UTF-8·SHA-256·DER 검증, 새 P-256 키로 서명/검증,
  URL/body/idempotency key 결속·단일 snapshot·비표준 key escape 경계 확인. 실제 Privy 수용은 미실행.
- 운영 서명자: 승인키 목록으로 wallet ID·ethereum 확인, 저장 주소 사용, 세 RPC의 wire body·header를
  캡처해 DER 승인 서명 검증. 큰 chain bigint/큰 typed 정수 문자열·선택 필드 생략·호출자 변경 분리,
  401/403·503·유형 오류·취소 매핑과 재시도 0회 확인. 반환 signature/hash의 복구·체인 포함 여부는 검증하지 않음.
- RPC 독립 리뷰에서 Fetch의 idempotency header 공백 정규화로 승인값/전송값이 달라지는 문제 발견.
  실제 header 값으로 한 번 확정하도록 수정하고 native Request 기반 DER 회귀 시험 및 재리뷰 승인.
- 회원 서명은 조회→승인키 권한 확인→RPC 순서, 없으면 생성하지 않음. 파트너 scope 분리,
  파트너 불일치·권한 false 시 외부 요청 0회, 확보 후 동의 철회 시 모든 서명/전송 차단,
  callback 오류 보존·주소 읽기 무검사·비동기 권한 대기 중 snapshot 확인.
- 회원/파트너 구현 시점 전체 52개 테스트와 `npm pack --dry-run` 통과. 승인 계산·RPC·회원/파트너 단위 각각 독립 리뷰 승인 후 커밋.
- EVM HTTP RPC: 32개 동시 id, 문자열/수치 id, error=null 우선, 상태/오류/무재시도,
  JSON 정수/소수 원문 검증·중복 키·malformed UTF-8/Unicode·-0 거부,
  4 MiB 정확 경계·로컬 body timeout/취소·header 대기 제한 시험. Privy 자격 증명 미전송.
- ETH: 9007199254740993 wei의 정확 보존, 주소 표기 유지, chain→gas 추정→가격→pending nonce 순서,
  gas/price 0의 조회 순서, signer 호출 전/후 오류 구분, 형식이 잘못된 hash의 미확정 결과, 재시도 0회 확인.
- 거래 단건: NOT_FOUND/PENDING/MINED/SUCCEEDED/REVERTED, null 수신자·optional fee, uint256/height/index 경계,
  receipt의 hash/from/to/index·block 결속, head 후퇴·confirmations overflow·RPC 오류,
  원본 tx/receipt/logs의 깊은 복사·동결 확인. 반환 상태/확인 수는 합의/L1 최종성이 아니다.
- 발신 목록: 문서 cursor 3개 발급 바이트, 블록 내 역순/limit 변경, 100개 full-block 제한/빈 페이지,
  genesis 종료, latest snapshot 고정·증가 head의 confirmations, 범위/cursor 입력 사전 거부,
  anchor·parent·거래 위치/index·페이지 반환 직전 reorg 검사 확인.
- EVM 구현 시점 전체 79개 시험 통과. EVM RPC·ETH·단건 상세/상태·발신 목록을 각각 독립 리뷰 승인 후 커밋.
- DMRVN 암호/JSON: Keccak·hex·uint·EIP-55·low-s 서명 복구 3개 고정 벡터·EIP-191 바이트 길이,
  Java JSON 사례 11개·제어 문자 9개 hash, decimal/정수 구분과 기존 비왕복 경계 확인.
- ABI: Java의 Claim/Forwarder/ProxyAdmin JSON 사본 3개 byte 일치. selector/topic 전체 벡터,
  과거 PET의 submitClaim/execute/onReport calldata byte 일치 및 재디코딩, 별도 ethers codec 대조,
  동적 배열 offset/1024 상한·uint/address/bool/bytes1/UTF8·call trailing/padding 거부 시험.
- 과거 PET fixture는 offlineOnly/actuallySubmitted=false이며 새 Evidence 계약의 수용 증거가 아니다.
- 프로토콜: 6개 encodeType/typeHash·Claim/Assignment/Observation digest/복구 주소, EvidenceLocation hash,
  과거 PET Evidence/provenance/Claim/Forwarder·submit/execute calldata·committee 순서·report signer 정렬 commitment,
  누락/범위/변조 및 typed data snapshot 확인. quorum·역할·최종 상태 검증을 대신하지 않음.
- 방법론: manifest/WASM 정확 commitment, registry 명시 조회·활성 거부, 원시 소수 ID 거부,
  explicit schemaVersion, Evidence의 7개 키·ownerHash·inputs 독립 복사·형식·1 MiB 정확 경계 검증.
- 테스트 schemaVersion=999는 시험 전용이며 외부 검증자의 승인 버전이 아니다.
- 방법론 리뷰에서 DmrvnDecimal을 객체 inputs로 잘못 허용하던 경계를 발견. plain/null-prototype 객체 검사로 수정하고
  Evidence 생성/검증·ABI 빈 tuple 회귀 시험 및 재리뷰 승인. 현재 전체 102개 시험과 패키징 확인 통과.
- 배포/config: raw proxy/direct·정규 metadata 왕복, 승인 릴리스 순서/중복/충돌·비영 주소/hash·버전,
  과거 direct 쓰기 거부·저장된 identity/release 호환, 명시 config·uint 범위/양의 무상한 비용·object UTF8 경계 확인.
- 배포 실측: 같은 tag의 4개 code/2개 slot·실제 승인 릴리스 선택·proxy version/owner·EIP-712 domain·trusted forwarder,
  22개 불일치 시나리오, direct 경로, Chain quantity/nonce/role/confirmedHead, 마지막 raw hash 경계 확인.
- preflight: 초기화 무통신·Greenfield 네트워크/서명자 주소, 순차 검사/실패 후 계속 진행,
  zero balance·storage/validator 미확인 표식·일반 callback 오류 전파·취소의 검사별 결과 경계 확인.
- 메모리 journal: 32개 동시·16개 nested fan-out 및 재진입, 외부 load/store 대기, 호출 시점 store snapshot,
  load/claim 검색 독립 복사·배포 전체 operation 검색, 오류 후 lock 해제·미지원 claim 검색의 닫힌 실패 확인.
- journal 리뷰에서 Promise.all 조기 실패 시 자식 종료 전에 전역 lock이 해제되던 문제 발견.
  자식 queue를 모두 drain한 후 해제하도록 수정하고 외부 작업의 중첩 방지 회귀 시험·재리뷰 승인.
- 공개 Greenfield reader: Java URLEncoder 호환 segment·한글/공백/기호/trailing slash·raw bytes,
  chain/type 사전 검증·401/403 구분·4 MiB·로컬 전체 body timeout/취소·늦은 body 취소 확인.
- Evidence 단계: 같은 작업 16개 동시 호출의 단일 서명/생성, 배포·설정/입력 fingerprint, claim/source 예약,
  응답 유실 intent 보존·원래 거래 proof 복구·명시 미전송/거절만 재생성 허용, journal 실패 전 저장 경계,
  sealed 원시 bytes 비교·어댑터 변경 분리·재실측 실패 시 ready 초기화 검증. 독립 리뷰 승인.
- Claim 승인: 16개 동시 호출 단일 서명·큰 nonce·체인 시각 deadline, 역할/provenance/활성/실제 bytes/본문 검사,
  서명·저장 실패 후 원 요청 재사용, 만료/nonce 충돌 미갱신·beneficiary 예약 유지, 캐시 승인과 배포 재실측 확인.
- 제출 준비: signed target gas 100000..2000000·문자열 불변, nonce/calldata/typed digest 결속,
  제출 전 승인/provenance/역할/시각/nonce 검사·cache 경계, SELF_PAID/SPONSORED 충돌,
  유효한 다른 서명 표현도 fingerprint 교체 거부, 직접 intent 저장 응답 유실·입력 snapshot 검증.
- DMRVN 조회: receipt 부재/확인 높이·거래 hash/원시 blockHash 결속, 주소/topic/claimId 첫 event 선택,
  1000블록 창·100001개 높이 상한·큰 nonce 정확 비교·removed/주소 오류·취소 전파 검증.
- 현재 전체 162개 시험 통과. 저장소 시험은 합성 adapter이며 실제 Greenfield 서비스 인수와 구분한다.
- Node 22 실행, 실제 Java 프로세스와의 비교, 실제 Privy 자격 증명 검증은 미실행.

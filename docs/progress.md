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
| 4f | 회원 서명·파트너 권한 어댑터·export | 예정 |
| 5 | EVM 조회·ETH 전송 (C-04) | 예정 |
| 6 | DMRVN 계산·배포·저장·복구·제출·보고서 (C-05–11) | 예정 |
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
- 키 자동 로깅·환경변수 기반 ensureBackendWallet·export 및 파트너 권한/서명은 아직 미구현.
  결정이 필요한 편의 기능을 자동으로 채택하지 않으며, 남은 범위를 완료로 계산하지 않는다.
- 요청 승인: Privy 0.59의 합성 벡터 3개 canonical UTF-8·SHA-256·DER 검증, 새 P-256 키로 서명/검증,
  URL/body/idempotency key 결속·단일 snapshot·비표준 key escape 경계 확인. 실제 Privy 수용은 미실행.
- 운영 서명자: 승인키 목록으로 wallet ID·ethereum 확인, 저장 주소 사용, 세 RPC의 wire body·header를
  캡처해 DER 승인 서명 검증. 큰 chain bigint/큰 typed 정수 문자열·선택 필드 생략·호출자 변경 분리,
  401/403·503·유형 오류·취소 매핑과 재시도 0회 확인. 반환 signature/hash의 복구·체인 포함 여부는 검증하지 않음.
- Node 22 실행, 실제 Java 프로세스와의 비교, 실제 Privy 자격 증명 검증은 미실행.

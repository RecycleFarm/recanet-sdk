# 의사결정 대기 목록

이 문서는 채택 기록이 아니다. 미결 정책은 구현 편의로 확정하지 않는다.
원본: [추가 의사결정 사항 D-01–D-30](https://chatgpt.com/space/page_e02a6acd8cec8191809fd022e8f534b8).

| ID | 결정할 내용 | 현재 개발 처리 |
| --- | --- | --- |
| TS-01 | 배포 패키지명·npm scope·지원 Node 버전·CJS 제공 여부 | 임시 이름 recanet-typescript, private, Node 22+, ESM으로 로컬 개발 |
| TS-02 / D-06 | 잘못된 UTF-16 입력의 인코딩 정책 | 회원 ID 계산은 Java의 UTF-8 대체 바이트 `3f` 호환; 정식 정책 미채택 |
| TS-03 / D-07 | SDK 전체 오류·취소 모델 | 기능별 현재 명세를 유지, Java interrupt는 AbortSignal에 대응 |
| TS-04 | 밀리초 및 Retry-After 공개 자료형 | timeoutMs는 JS 안전 정수 범위만 수용(원본 int64 범위보다 작음), retryAfterMs는 bigint로 int64 초를 손실 없이 보존. 최종 API 채택은 대기 |
| TS-05 / D-09 | JWT 파서의 비표준 입력 수용·중복 claim·중첩 한도 | 원시 숫자를 보존하는 별도 파서 사용. 중복 key·128단계 초과 중첩·비정상 UTF-8·비 base64url compact 입력은 INVALID_TOKEN. Nimbus 비표준 허용 범위와 교차 검증 전 전체 파서 호환 선언 보류 |
| TS-06 | 인증 결과의 시각 표현 | `issuedAtMs`·`expiresAtMs`는 UTC epoch 밀리초 bigint. NumericDate 전체 범위는 JS Date 범위를 초과하므로 Date/number로 축소하지 않음. 최종 공개 API 채택 대기 |
| TS-07 / D-09 | JWKS 전송·키 선택 경계 | fetch의 header 대기와 각 body read에 timeout 적용. Java 소켓의 connect/read와 완전히 같은 시간 경계는 미검증. EC/P-256, kid/alg/use 기준 후보 선택; Nimbus의 모든 비표준 JWK 파싱·선택 규칙 교차 검증 대기. `now` 주입은 claim과 캐시/갱신 제한 시계 모두에 적용 |
| TS-08 / D-04 | 승인키 자동 출력·환경변수 기반 초기화 편의 기능 | 키 생성·명시적 입력만 구현. Java generateAndLog/ensureBackendWallet/exportAndLog의 비밀 자동 출력과 첫 지갑 선택 정책은 미채택·미구현. 소비자 비밀 저장소와 환경변수 매핑은 호출자 책임 |
| TS-09 / D-07 | 등록/목록 일반 전송 예외의 노출 | 직접 fetch 계층에서는 공통 sanitize 오류로 반환. Java 공식 SDK의 일부 일반 실행 예외 노출까지 복제하지 않음. 계약 통합 채택은 대기 |
| TS-10 / D-11 | Privy 승인 정규화의 기존 비표준 동작과 수치 표현 | Privy 0.59 경로를 별도 구현: 키 UTF-16 정렬·key escape 생략·Jackson 제어문자 escape. 정상 payload 3개 바이트/digest/DER 벡터 검증. 숫자는 JS JSON wire 표현을 사용하여 Java Double의 `1.0`·지수 표기까지 동일하다는 보장은 없음. 큰 정수는 10진 문자열 사용. malformed Unicode·임의 수치 표현의 최종 정책 및 외부 수용 범위는 결정 대기 |
| TS-11 / D-12 | chainId와 직접 서명자 입력 검증의 공개 타입 | chainId는 안전한 number 또는 bigint로 Java signed int64 범위 보존. 직접 signer는 양수·key blank·Quantity 문법을 추가 검사하지 않음. 회원 API는 별도 양수/key 검사를 유지할 예정. 반환 hash/signature는 문자열 반환이며 암호학적 검증은 상위 계층 책임 |
| TS-12 / D-11 | idempotency key의 HTTP 공백 처리 | native Fetch가 앞뒤 HTTP 공백을 제거하므로 동일하게 정규화한 실제 header 값으로 승인하고 전송. 교차 SDK의 공백 key 허용/거부 정책은 결정 대기. 연동 시 앞뒤 공백 없는 안정적 key 사용; 원본 body와 wire key를 함께 보존 |
| D-01·03·04 | 지갑 소유권 충돌·파트너 매핑·승인키 출력 | 구현 시 명시적 어댑터, 키 자동 출력 없음 |
| D-02·17·30 | Evidence wire 버전·숫자 정규화·제어문자 escape | 운영 기본 버전을 추정하지 않음 |
| D-05·08–16 | API 표면·회원 연결·외부 공급자·승인 서명·거래 정책 | 각 상세 구현 전 원본 계약 대조 |
| D-18–29 | 배포·권한·제출·저장·journal·대기·보고서 신뢰 | 원본의 개별 질문을 해소하기 전 운영 호환 선언 보류 |

실환경 인수에는 승인된 배포·방법론·권한·비용 범위 및 테스트 자격 증명 설정이 필요하다.

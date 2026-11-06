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
| D-01·03·04 | 지갑 소유권 충돌·파트너 매핑·승인키 출력 | 구현 시 명시적 어댑터, 키 자동 출력 없음 |
| D-02·17·30 | Evidence wire 버전·숫자 정규화·제어문자 escape | 운영 기본 버전을 추정하지 않음 |
| D-05·08–16 | API 표면·회원 연결·외부 공급자·승인 서명·거래 정책 | 각 상세 구현 전 원본 계약 대조 |
| D-18–29 | 배포·권한·제출·저장·journal·대기·보고서 신뢰 | 원본의 개별 질문을 해소하기 전 운영 호환 선언 보류 |

실환경 인수에는 승인된 배포·방법론·권한·비용 범위 및 테스트 자격 증명 설정이 필요하다.

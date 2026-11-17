# 공통 Contract 검증 기록

환경: macOS ARM64, JDK 17.0.18, Node 22.23.5. 실제 서비스 호출·키 영속 저장·거래 전송·패키지 발행은 하지 않았다. 공통 runner의 HTTP 요청은 loopback fixture server에만 전달한다.

| 검사 | 결과 |
| --- | --- |
| 실제 Java/TS 공통 입력·결과·오류·adapter trace 비교 | 5,922/5,922 일치. 상세 영역/소스 해시는 [parity.json](parity.json) |
| Java↔Node journal | 교차 snapshot 읽기/쓰기, 6개 혼합 프로세스 120회 갱신, 0700/0600 통과 |
| 양쪽 worker bytes 및 UTF-8 chunk | 동일 파일, 133개 분할 입력 통과 |
| Java JUnit / worker / 보안 회귀 / 승인 WASM | 126 / 8 / 6 통과, 로컬 WASM 벡터 통과 |
| TypeScript 단위 / worker / 보안 회귀 | 273 / 14 / 6 통과 |
| 전체 API coverage / 검사기 회귀 | Java 363개 선언·TS 416개 시그니처, 5개 회귀 통과 |
| 공개 API 기준 | Java 66개 class entry·TS 65개 선언 파일 일치. 과거 이관 baseline 변경 없음 |
| CI 규칙 / 이관 보존 / whitespace | 19개 통과, 양쪽 원본 refs·import tree 보존, diff check 통과 |
| 공개 소비자 | strict TypeScript 컴파일 및 offline runtime smoke 통과 |
| Linux x64 tarball 설치 | 로컬 macOS에서 EBADPLATFORM. 기존 os/cpu 제한 유지. TypeScript Linux CI에 설치 검사 유지 |

`make contract-test`로 공통 비교와 worker 검사를 재실행한다. `make contract-check`는 API 누락/미분류·계약 링크·5개 ABI/배포 파일을 검사한다. `make verify-api`는 별도의 현재 API 기준을 검사한다. 공통 CI에 같은 명령을 연결했으며 이번 작업에서 원격 CI를 실행하거나 성공으로 표시하지 않았다.

테스트 코퍼스 일치는 모든 입력/취소 스케줄에 대한 형식 증명이나 실제 Privy/Greenfield/validator 운영 수용 결과가 아니다. [불일치 해소와 인수 범위](../../contracts/gaps.md)를 따른다.

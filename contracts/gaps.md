# 공통 Contract 불일치 해소와 인수 기준

Java를 기준으로 TypeScript를 수정했다. 아래 GAP-01~12는 이 변경의 코드·공개 API·공통 회귀 범위에서 해소했다. `mapped`는 API 대응이며 동작 증명은 아니므로 실행 비교도 별도로 유지한다. 모든 가능한 입력·스케줄·외부 서비스까지 완전히 동등하다는 수학적 주장은 하지 않는다.

## 1. 해소 목록

| ID | 상태 | 수정 및 검증 근거 |
| --- | --- | --- |
| GAP-01 | 해소 | BackendWalletKeyPair 및 generateAndLog/registration/fromEnvironment/ensureBackendWallet/exportWalletPrivateKeyAndLog 제공. record 생성 검증, 환경 두 키의 준비 여부, 첫 지갑 선택, 명시 키 로그를 Java에 정렬. `java-contract.test.mjs` 및 공통 privy 시나리오. |
| GAP-02 | 해소 | PrivyClient.config(), PrivyClientConfig/PrivyTokenVerificationConfig의 정규화 getter·정책·마스킹 제공. 공개 대응표와 설정 회귀 검사. |
| GAP-03 | 해소 | bigint 나노초 Duration으로 signed-int64 초·sub-ms·overflow 경계 보존. 실제 TCP/TLS connect와 JWKS read timeout 분리, 큰 Node timer 분할, Activity 단조 시계 대기. 공통 duration/activity 경계 및 RPC/worker 단위 검사. |
| GAP-04 | 해소 | DmrvnConfig의 11인자 historical direct 및 명시 deployment overload, DmrvnClient의 deprecated approver/relay overload와 주소 불일치 거부 구현. 공통 deployment 및 생성자 회귀. |
| GAP-05 | 해소 | TS 전용 petV3/validatePartner와 partner101/petBottleCount 제한 제거. 일반 명시 schema 생성자를 사용하고 기존 Evidence bytes/hash 유지. 방법론 공통·고정 벡터 회귀. |
| GAP-06 | 해소 | Jackson/Nimbus 중첩·중복·Base64·UTF-8 대체·JWK 좌표/선택·NumericDate LONG_OR_DOUBLE 경계 정렬. Java17 Float/Double 숫자 문자열과 타입 바인딩 구현. 공통 JSON/JWT/JWKS/cursor 및 부동소수점 경계/무작위 코퍼스 비교. |
| GAP-07 | 해소 | 없는 회원 signer와 미설정 verifier는 상태 오류. Privy 원문 idempotency key/승인 canonical bytes 및 Java wire 숫자 사용. malformed provider JSON/schema는 INVALID_RESPONSE/status200, semantic 목록 불일치는 status0. 공통 privy/numberWire 및 signer 회귀. |
| GAP-08 | 해소 | Asset estimate.from과 transfer 반환 hash의 원래 대소문자 보존. 공통 asset의 RPC trace와 mixed-case hash 비교. |
| GAP-09 | 해소 | Java URI의 host/port/percent escape 및 Privy/JWKS origin 검증을 공통화하고 기본 HTTP transport가 raw URI path를 보존. public reader의 literal dot segment 추가 거부 제거. 공통 실제 loopback HTTP 요청과 reader 회귀. 커스텀 fetch는 해당 adapter가 같은 전송 의미를 제공해야 한다. |
| GAP-10 | 해소 | Java↔Node 공유 FileOperationJournal snapshot 읽기/쓰기, 6개 실제 혼합 프로세스×20회 갱신=120 및 0700/0600 권한 검사. OS lock/원자성 교차 사용 검증. 분산 fencing은 양쪽 모두 별도 adapter 책임. |
| GAP-11 | 해소 | TS root에서 Java package-private 구현/상수/helpers 제외, @internal 선언 제거. Java-named Json 제공, Json.copy는 object만 허용. 전체 API inventory/별도 current baseline 검사. |
| GAP-12 | 해소 | Query/WalletCreateRequest runtime 생성자와 Java 검증 제공. 회원/partner 승인 및 signer 조회 후 입력 소비 순서, adapter 참조·복사 경계 정렬. 공통 workflow/reader/transaction 오류·호출 기록과 mutation 회귀. |

공통 Java 기준 소스는 `06a9a560054b1154ce096839da3bfe9c6d7a67ff`다. Java 공개 API는 유지했다. Linux x64 검증에서 999·1000단계 JSON canonical의 Stream 재귀가 기본 스택을 넘는 결함을 발견해 동일한 순서/bytes의 반복문으로 바꿨다. Java 1 MiB 스택에서 이전 실패와 수정 후 통과를 재현했고, 깊은 배열/객체 회귀를 추가했다. 공통 worker UTF-8 chunk 시험에서 Java worker의 chunk별 디코딩 결함을 발견해 StringDecoder 누적 디코딩으로 최소 수정했으며 양쪽 worker 파일 bytes를 동일하게 유지한다.

## 2. 실행 방법과 근거

```sh
make install
make contract-test
make contract-check
make verify-api
```

- [공통 runner](../scripts/test-sdk-contract.py)는 실제 Java SDK와 빌드한 TS SDK에 동일 JSONL 입력·고정 외부 응답을 제공한다. 값, 부재/null, 오류 family/code/status/retryAfter/전송 사실, HTTP/RPC/storage/sign 호출 인자·순서·횟수를 비교한다.
- [공통 벡터](../tests/contracts/typescript/vectors.mjs) 및 [업무 시나리오](../tests/contracts/typescript/workflow-vectors.mjs)는 설정, JSON, 전체 31개 DMRVN 오류 정책, 숫자/Duration, JWT/JWKS, Privy, asset, 거래 상태/페이지/cursor, Evidence 저장·제출·조사·보고서 검증을 포함한다. 응답 유실·봉인 대기·bytes 조작·권한 회수·nonce 변경·비용/기한/서명 실패도 재현한다.
- [실행 보고서](../reports/contracts/parity.json): 5,924/5,924 일치, 차이 0. 별도로 공유 journal 및 동일 worker/133개 UTF-8 분할 입력을 검증한다. 로컬 JDK17/Node22.23.5/macOS ARM64 실행이며 Linux x64는 [공통 CI](../.github/workflows/contract-ci.yml)에 같은 명령을 연결했다.
- [coverage 검사](../scripts/check-sdk-contract.py)는 363개 Java public 선언과 416개 TS 시그니처의 누락/미분류·계약 링크·5개 공통 ABI/배포 파일 bytes를 검사한다. 5개 검사기 회귀는 누락된 overload/추가 export/잘못된 대상/optional 변경을 실패시킨다.
- [현재 API baseline](public-api-baseline.json)은 이번 공개 API 변경을 동결한다. [과거 baseline](../docs/migration/phase2-public-api-baseline.json)은 그대로 보존한다. 검사 명령이 baseline을 자동 승인/갱신하지 않는다.

## 3. 공통 판정과 남은 운영 인수 범위

같은 논리 입력·외부 응답에서 성공/부재 값, 정밀 수치, 오류, 부수 효과와 중단 시점이 같아야 한다. JSON bytes/hash, ABI calldata, EIP-712 digest, source commitment, cursor는 byte 단위로 비교한다. 확률적 키/서명은 고정 공급 또는 복구 주소/digest로 비교한다. 자동 retry가 없는 쓰기에 추가 create/send가 발생하면 결과가 같아도 실패다.

이 suite는 로컬 scripted adapter와 loopback HTTP를 사용한다. 실제 Privy/Greenfield/validator 배포 수용, 분산 DB fencing/NFS, 모든 네트워크 및 취소 스케줄은 별도 운영 인수 범위다. 해당 범위는 Java·TS 차이를 허용하는 예외가 아니다. Linux x64 tarball 설치는 Linux CI에서 검증하며 macOS에서 os/cpu 제한을 우회하지 않는다. 기존 고정 Evidence/암호 벡터는 다시 생성하지 않았다.

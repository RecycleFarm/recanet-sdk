# SDK 진단 로그

SDK는 **로그만 생성·전송하며 Span을 생성하지 않습니다.** 기본 출력은 로컬 JUL이고,
애플리케이션이 OpenTelemetry 인스턴스를 주입하면 같은 이벤트를 OTLP로 전송합니다.
SDK가 전역 provider나 호스트 애플리케이션의 트레이스 설정을 변경하지는 않습니다.

## 기록 범위

Privy 인증·지갑 생성/조회·서명·전송, 회원별 지갑 작업, 자산 잔액/전송, 거래 조회,
DMRVN 각 단계와 결과 검증, RPC 호출, Greenfield 객체 생성·업로드·조회가 계측됩니다.
기본 모드는 정상 하위 호출의 로그를 생략하고 **작업 완료 요약, 중요한 부수효과 상태, 상세 오류**만 기록합니다.
하위 단계의 완료/체크포인트는 메모리에 계속 갱신하므로 오류 로그의 실패 단계와 마지막 확인 상태는 유지됩니다.
파라미터, 반환 객체, 지갑/회원 식별자, 요청/응답 본문 전체는 기록하지 않습니다.
각 내부 라이브러리의 모든 네트워크 요청이나 암호 연산을 계측하는 기능은 아닙니다.

## 기본 전송 정책

이 정책은 특정 작업명에 대한 예외 처리가 아니라 `SdkTelemetry`의 공통 기본 정책입니다.
Privy 인증/지갑 생성/조회/export/서명/전송, 회원·파트너 지갑, 거래 상태/목록 조회,
DMRVN의 개별 단계 API와 결과 조회, 독립 RPC 및 Greenfield 호출에도 동일하게 적용됩니다.
아래의 4개 수치는 대표 시나리오 측정값입니다. 적용 대상을 4개로 제한한 것이 아닙니다.
파트너 지갑의 생성·서명·전송 전 권한 검사 오류도 같은 로거에서 작업 ID와 실패 단계로 기록합니다.

- 정상 조회: 최상위 작업 완료 요약 1건. 하위 RPC의 시작/완료 로그는 전송하지 않습니다.
- 생성·전송·업로드: `submission_started`를 실제 delegate 호출 전에 기록하고,
  확인된 수락/확인은 `submission_accepted`/`submission_confirmed`로 기록합니다.
  서명기와 transport가 같은 요청을 중첩 계측해도 동일 요청의 상태를 반복 전송하지 않습니다.
- 중요 체크포인트: `APPROVED`, `EVIDENCE_SEALED`는 논리 작업당 각각 한 번 기록합니다.
  그 밖의 체크포인트와 반복 journal 복원은 내부 상태에만 반영합니다.
- 오류: 같은 예외가 호출 스택을 따라 전파되는 경우 최초 실패 단계에서 한 번 기록합니다.
  새 오류나 별도 재시도에서 재사용한 예외는 각각 기록합니다. 오류 코드만으로 합치지 않습니다.
  중복 판별 캐시는 크기가 제한되며 포화 시에는 오류 보존을 우선해 중복이 발생할 수 있습니다.
- 하위 오류를 처리한 후 작업이 반환되면 오류 기록과 최상위 완료 요약이 함께 존재할 수 있습니다.
  `completed`는 메서드 반환이며 업무 성공이나 체인 확정을 보장하지 않습니다.

기본 로그에는 반복되는 호출 관계 UUID, 중복 `operation`/`stage`, 별도 timestamp 속성과
소요 시간을 넣지 않습니다. 이벤트 시간은 OpenTelemetry LogRecord의 timestamp에 기록하고,
로컬 JSON에는 편의를 위해 timestamp를 추가합니다.
정상 완료 요약에는 업무 상태만 간단히 담고, 오류와 생성/전송 상태에는 상세 상태를 유지합니다.
`error.message`와 동일한 `error.reason`은 생략합니다.

프로세스 강제 종료에 대비한 생성/전송 직전 로그도 비동기 전송이므로 서버 저장을 보장하지는 않습니다.
요약 정책은 감사 원장이나 재시도 판단용 영속 journal을 대체하지 않습니다.

동일한 로컬 mock 시나리오에서 기본 정책 적용 전후의 로그 수는 다음과 같습니다.

| 작업 1건 | 이전 | 기본 요약 모드 |
| --- | ---: | ---: |
| 잔액 조회 성공 | 8 | 1 |
| 지갑 생성 실패 | 9 | 2 |
| DMRVN 처리 성공 | 354 | 10 |
| DMRVN 제출 결과 미확인 | 346 | 9 |

업무 로직과 실제 외부 호출 횟수는 바꾸지 않았습니다. DMRVN 정상 시나리오의 로그 속성을
JSON으로 직렬화한 합계는 약 263KB에서 약 5.2KB로 줄었습니다.
이는 로그 속성의 비교값이며 OTLP wire 크기, 압축 저장량 또는 Grafana 청구량 자체는 아닙니다.

## 작업 식별자와 단계

| 속성 | 의미 |
| --- | --- |
| `recanet.operation_id` | 작업 ID. 최상위 입력 ID를 상속하며 없거나 형식이 부적합하면 자동 생성 |
| `recanet.call_id` | 상세 진단 모드에서만 기록하는 개별 호출 ID |
| `recanet.root_call_id`, `recanet.parent_call_id` | 상세 진단 모드에서만 호출 관계를 연결 |
| `recanet.operation` | 기본 모드에서는 최상위 논리 작업명 |
| `recanet.stage` | 중요 이벤트의 하위 단계. 작업명과 같으면 생략. 상세 모드에서는 항상 기록 |
| `recanet.phase` | `completed`, `checkpoint`, `failed`, `submission_started`, `submission_accepted`, `submission_confirmed`. 상세 모드에만 `started` 추가 |
| `recanet.failed_stage` | 같은 예외가 전파될 때 최초 실패한 하위 단계 |
| `error.type`, `error.code` | 예외 클래스, SDK/외부 서비스 오류 코드 또는 HTTP 코드 |
| `error.message` | 필요한 오류 메시지만 추출하고 민감정보를 마스킹한 텍스트, 최대 512자 |
| `error.reason` | SDK에서 정의한 안전한 설명. 메시지와 같으면 생략 |
| `http.response.status_code` | HTTP 상태, 없는 경우 0 |
| `recanet.upstream`, `recanet.upstream_code` | 외부 서비스 종류, 숫자형 원본 코드 |
| `recanet.last_confirmed_stage` | 마지막 완료/체크포인트 단계. 기본 모드의 정상 완료 요약에서는 생략 |
| `recanet.last_confirmed_state` | 마지막 업무 상태. 아래 설명 참고 |
| `recanet.submission_target` | 마지막 부수효과 요청을 실행한 단계 |
| `recanet.submission_state` | 제출 결과를 얼마나 알고 있는지 구분 |
| `recanet.submission_sequence` | 한 작업 내 개별 생성/전송 요청 번호. 병렬 요청도 별도로 구분 |
| `recanet.failure_handled` | 예외 대신 결과 객체로 오류를 반환한 경우 true |
| `recanet.partner_id`, `deployment.environment.name` | 파트너/실행 환경 검색 라벨 |
| `recanet.sdk.version`, `recanet.duration_ms` | SDK 버전, 소요 시간(상세 모드에만 기록) |

최상위 작업 ID가 없는 호출에도 ID가 생기지만, 자동 ID는 재시도 간 동일하지 않습니다.
여러 API를 하나의 업무로 묶으려면 아래처럼 명시적인 비밀정보 없는 ID를 사용하세요.
하위 호출의 별도 idempotency key는 최상위 업무 ID를 바꾸지 않습니다.

```java
telemetry.observe("WalletProvisioning.create", "wallet-job-123", () ->
    wallets.getOrCreateWallet(authenticatedMemberId));
```

입력 ID의 로그 허용 형식은 `[A-Za-z0-9._:-]{1,128}`입니다. 부적합한 ID는 로그에서만
자동 ID로 대체하며 원래 업무 API의 입력 검증은 유지됩니다. 별도 스레드로 작업을 넘길 때는
애플리케이션에서 OpenTelemetry Context를 전파해야 동일 작업으로 연결됩니다.

## 마지막 확인 상태의 의미

- 지갑: `WALLET_NOT_FOUND`, `WALLET_FOUND`, `WALLET_CREATED`
- 체인: `CHAIN_VERIFIED`, `BALANCE_READ`, `SUBMITTED`, `SUBMISSION_CONFIRMED`
- DMRVN: `PREPARING`, `EVIDENCE_SIGNED`, `EVIDENCE_CREATE_BROADCAST`, `EVIDENCE_SEALED`, `APPROVED`
- 보고서: `REPORT_READ`, `REPORT_VERIFIED`
- 아직 업무 체크포인트가 없으면 `NOT_STARTED` 또는 `STEP_COMPLETED`

`last_confirmed_stage`는 마지막 메서드 완료를, `last_confirmed_state`는 명시적인 업무
체크포인트를 나타냅니다. RPC 응답이 반환됐다는 사실만으로 제출·봉인·확정을 추정하지 않습니다.
`NOT_ATTEMPTED`인 정상 완료 요약에서는 submission 관련 필드도 생략합니다.
DMRVN의 기존 journal 상태를 읽어 복구한 경우 해당 기록의 마지막 상태도 로그에 반영합니다.
이 상태는 SDK가 관찰/보관한 사실이며, 영속 원장 또는 현재 체인 상태 자체를 대체하지 않습니다.

제출 상태는 다음과 같습니다.

| 값 | 의미 |
| --- | --- |
| `NOT_ATTEMPTED` | 해당 작업에서 아직 부수효과 요청을 시작하지 않음 |
| `OUTCOME_UNKNOWN` | 요청 수행 단계에 진입했지만 수락/거절 결과를 확인하지 못함 |
| `ACCEPTED` | 유효한 제출 해시나 성공 응답을 받음. 체인 확정과 다름 |
| `CONFIRMED` | SDK의 기존 확인 절차가 제출을 확인함. DMRVN 최종 검증 승인과 다름 |
| `NOT_BROADCAST`, `REJECTED` | 기존 adapter가 명시적으로 보장하거나, 해당 Privy 요청이 명확히 거절됨 |

타임아웃을 단순한 미제출로 기록하지 않습니다. 기존 예외와 반환값은 유지하며
로그를 남기기 위해 생성/전송/조회 요청을 자동 재시도하지 않습니다.
메서드가 결과 객체의 `reportError`로 오류를 반환하면 `failed`와 `failure_handled=true`를
기록합니다. 오류를 포함한 결과를 일반 완료로 표시하지 않습니다.

## 오류 메시지와 민감정보

Privy 응답의 `error.message`/`message`/문자열 `error`, RPC·Greenfield의 오류 메시지,
SDK 정의 예외 메시지 중 필요한 부분만 사용합니다. 구조화된 오류 코드는 별도로 보존합니다.
인증 헤더, 토큰/secret/password/private key 등의 명명된 값, PEM, JWT, URL,
긴 opaque 값·hex 값과 제어문자는 마스킹하며 전체 메시지는 512자로 제한합니다.
구조화되지 않은 전체 응답, 큰 본문, 알 수 없는 애플리케이션 예외는 고정된 안전한 설명으로 대체합니다.
원문 응답, stack trace, 원인 예외의 메시지 전체는 전송하지 않습니다.
임의의 외부 텍스트에 모든 비밀정보의 형식을 알 수 있는 것은 아니므로 업무 ID와
파트너 라벨에 개인정보나 인증값을 넣지 말고 외부 오류에도 민감정보가 포함되지 않도록 관리하세요.

기존 `generateAndLog()`, `exportWalletPrivateKeyAndLog()` 및
`ensureBackendWallet()` bootstrap 경로는 별도 JUL 로거에 개인키를 출력할 수 있습니다.
이 기존 API 동작은 변경하지 않았습니다. **전체 JUL을 수집하는 agent/브리지를 연결하면 이 출력도
수집될 수 있으므로 운영에서는 해당 경로를 피하고 전용 telemetry만 연결하세요.**

## SDK 연결과 비활성화

```java
var telemetry = SdkTelemetry.builder()
    .openTelemetry(applicationOpenTelemetry)
    .partnerId("partner-a")
    .environment("production")
    .localLogging(true)
    .detailedLogging(false) // 기본값. 문제 조사 기간에만 true로 상세 로그 활성화
    .build();
var client = new PrivyClient(new PrivyClientConfig(appId, appSecret).withTelemetry(telemetry));
var assets = new AssetClient(rpcUrl, telemetry);
var transactions = new EvmTransactionClient(chainId, rpcUrl, telemetry);
var dmrvn = new DmrvnClient(config, rpc, operator, storage, methodology, journal, telemetry);
var reader = new DmrvnReader(config, rpc, reportReader, reportResolver, telemetry);
```

독립적인 `HttpEvmRpc`, `NodeGreenfieldStorage`, `GreenfieldPublicReader`에도 telemetry를 받는
생성자가 있습니다. 같은 객체로 구성해야 전체 작업을 같은 전송 경로로 수집할 수 있습니다.
외부에서 직접 만든 하위 transport의 독립적인 로깅 설정은 그 객체가 관리합니다.
`SdkTelemetry.disabled()`는 해당 인스턴스의 로깅을 끕니다. 직접 구성한 하위 객체도
같은 disabled 인스턴스로 구성해야 그 객체의 로깅까지 꺼집니다.

JUL 로거는 `com.youngminkim.recanet.telemetry`이고 메시지는 JSON입니다.
완료/중요 상태는 `INFO`, 실패는 `WARNING`이며 JUL 포매터는 별도로 적용됩니다.
상세 모드의 개별 호출 시작은 JUL `FINE`, OpenTelemetry `DEBUG`입니다.
OpenTelemetry의 정상 요약/상태는 `INFO`, 오류는 `ERROR`입니다.
`.detailedLogging(true)`는 모든 하위 단계의 시작·완료·체크포인트와 호출 관계 ID를 복원하며
오류 전파 과정도 상세히 기록합니다. 로그량이 크게 증가하므로 조사 기간에만 사용하세요.
같은 논리 작업에 구성값이 다른 하위 객체가 포함되면 최상위 telemetry의 모드·출력 대상·파트너 라벨을 따릅니다.
기존 `tracing(boolean)`은 호환용 무동작 메서드이며 true를 넣어도 SDK Span은 생성되지 않습니다.
기존 `traceStep()`도 로그용 `step()`의 deprecated 별칭입니다.
호스트 애플리케이션의 외부 Span이 이미 있으면 로그의 OTel Context에는 그 ID가 붙을 수 있으나,
SDK가 그 Span을 만들거나 전송하는 것은 아닙니다.

## Grafana Cloud로 전송

예제 `TelemetryExample`은 로컬 mock Privy 서버에서 지갑 조회 성공 후 생성 실패(403)를
만들어 진단 로그를 보냅니다. 실제 지갑을 생성하거나 거래를 제출하지 않습니다.
최상위 ID는 `wallet-create-demo`이고, 오류 로그에는 조회 후 `WALLET_NOT_FOUND` 상태와
생성 실패 단계, 오류 메시지가 남습니다.

애플리케이션에서 자동 설정을 쓰려면 아래 의존성이 필요합니다. SDK의 전이 의존성에는 포함되지 않습니다.

```kotlin
implementation("io.opentelemetry:opentelemetry-sdk-extension-autoconfigure:1.68.0")
runtimeOnly("io.opentelemetry:opentelemetry-exporter-otlp:1.68.0")
```

```text
RECANET_PARTNER_ID=partner-a
RECANET_ENVIRONMENT=development
OTEL_SERVICE_NAME=recanet-sdk
OTEL_EXPORTER_OTLP_ENDPOINT=https://<제공된 OTLP 호스트>/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<인코딩된-인증값>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_LOGS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=none
OTEL_METRICS_EXPORTER=none
```

`./gradlew telemetrySmoke`로 실행합니다. 공통 endpoint에는 `/otlp`까지만 넣으면
exporter가 `/v1/logs`를 붙입니다. `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`를 별도로 지정한다면
`/otlp/v1/logs`까지 넣습니다. signal별 환경변수가 공통 설정보다 우선합니다.
인증값은 환경변수/secret manager로 주입하고 파일/Git에 저장하지 않습니다. `logs:write` 권한이면 충분합니다.
예제는 환경변수에 이전 `OTEL_TRACES_EXPORTER=otlp`가 남아 있어도 trace/metrics exporter를
`none`으로 강제합니다. 기존 애플리케이션에 주입할 provider는 애플리케이션에서 설정해야 합니다.
HTTPS만 허용하며 loopback에 한해 로컬 검증용 HTTP를 허용합니다.

예제 provider는 전역 등록 없이 별도로 만들고, bounded batch 큐로 전송한 뒤 종료 시 로그를 flush합니다.
flush 완료가 서버 저장 성공을 보장하지는 않습니다. 장애·큐 포화·강제 종료에서는 로그가 유실될 수 있으며,
이 로그는 감사 원장이나 업무 복구 journal을 대신하지 않습니다.
전체 JUL 브리지와 직접 OTel 로그 전송을 동시에 연결하면 중복 수집될 수 있습니다.

Grafana Explore에서 Loki 데이터 소스를 선택하고 최근 시간 범위로 검색합니다.
OTLP 속성의 점은 Loki structured metadata에서 밑줄로 바뀝니다.

```logql
{service_name="recanet-sdk"} | recanet_operation_id="wallet-create-demo"
```

오류만 확인하려면:

```logql
{service_name="recanet-sdk"} | recanet_phase="failed"
```

작업·호출 ID는 고유값이 많으므로 인덱스 라벨 대신 structured metadata로 유지하세요.
OpenTelemetry Setup의 trace 수신 테스트는 로그 전용 구성에서는 통과하지 않을 수 있습니다.
로그 수신은 Loki에서 확인하세요. 로그 서비스 비용만 발생하며 이 SDK가 만드는 트레이스 사용량은 없습니다.

## 파트너 접근 권한

Cloud 계정/스택 생성, 토큰 발급, 사용자 초대, LBAC는 별도 인프라 설정입니다.
`partnerId`는 진단 라벨이며 인증 경계가 아닙니다. 파트너별 stack/tenant 쓰기 권한을 분리하거나
인증된 수집 계층이 파트너 식별자를 강제로 부여해야 합니다.
조회 권한도 데이터 접근 계층에서 설정하며 대시보드 필터만으로 격리하지 않습니다.

# 오류 진단 로깅

SDK 운영 API는 기본적으로 로컬 stdout에 구조화된 JSON을 출력합니다. 호스트 로깅 설정이나 OpenTelemetry 전역 provider는 변경하지 않으며 Span을 만들지 않습니다. 로컬 수집기가 이미 이 JSON을 전송한다면 OTLP와 이중 수집하지 않도록 수집 경로를 선택하세요.

## TypeScript 설정

설정은 이 SDK에만 적용됩니다. 요청마다 설정을 변경하지 말고 서비스 초기화 때 한 번 호출하세요. 기존 클라이언트도 호출 시점의 설정을 사용하며, 진행 중인 작업은 시작 시점의 설정을 유지합니다.

```ts
import { configureDiagnostics, withDiagnosticOperation } from 'recanet-typescript';
configureDiagnostics({ partnerId: '101', environment: process.env.NODE_ENV ?? 'production' });

// operationId 인자가 없는 API를 서비스의 논리 작업에 연결할 때 사용합니다.
await withDiagnosticOperation('member.balance', 'request:123', () => assets.getBalance(address));

configureDiagnostics({ localLogging: false, loggerProvider }); // OTLP만 사용
configureDiagnostics({ enabled: false });                     // 완전 비활성화
configureDiagnostics({ detailedLogging: true });              // 명시적인 장애 조사
```

옵션을 다시 설정하면 이전 옵션을 교체합니다. DMRVN의 partnerId와 파트너 지갑 어댑터의 partnerId는 해당 작업의 메타데이터에 반영됩니다. 그 외 API에서는 서비스가 partnerId와 environment를 제공하세요. 설정값은 안전한 식별자만 허용하며 부적합한 메타데이터는 생략합니다.

기존 OpenTelemetry Logs `LoggerProvider`를 `loggerProvider`로 주입할 수 있습니다. SDK는 exporter를 생성하거나 주소/인증을 보관하지 않습니다. 호스트에서 bounded queue를 쓰는 `BatchLogRecordProcessor`를 구성해야 합니다. 단건 동기 exporter 대신 아래 구성을 사용하세요. 예제는 검증한 `@opentelemetry/sdk-logs` 3.1.1, `@opentelemetry/exporter-logs-otlp-http` 0.301.1 API를 사용합니다.

```ts
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { configureDiagnostics } from 'recanet-typescript';

const authorization = process.env.RECANET_OTLP_AUTHORIZATION; // 또는 secret manager
const exporter = new OTLPLogExporter({
  url: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, // 전체 /v1/logs 주소
  headers: authorization ? { authorization } : {},
});
const provider = new LoggerProvider({ processors: [new BatchLogRecordProcessor({
  exporter, maxQueueSize: 2048, maxExportBatchSize: 256,
  scheduledDelayMillis: 1000, exportTimeoutMillis: 5000,
})] });
configureDiagnostics({ loggerProvider: provider, partnerId: '101', environment: 'production' });

// 호스트의 정상 종료 절차에서 실행합니다. SDK는 flush/shutdown하지 않습니다.
await provider.forceFlush();
await provider.shutdown();
```

Promise와 병렬 호출은 AsyncLocalStorage로 연결합니다. 서비스의 별도 callback/executor 경계에서는 `bindDiagnosticContext(callback)`로 현재 컨텍스트를 캡처하세요. 개별 SDK 호출이나 `withDiagnosticOperation`의 Promise가 끝날 때까지 기다려야 작업 전체 완료 시점을 얻을 수 있습니다.

## 공통 이벤트 계약

| 이벤트 | 기본 출력 조건 |
| --- | --- |
| `completed` | 정상 반환한 최상위 호출당 1건. 업무 성공, 체인 확정, DMRVN 검증 승인과 별개 |
| `failed` | 최초 실패 단계. 같은 예외의 상위 전파와 SDK 오류 변환은 중복 제거 |
| `failure_handled` | 오류를 포함한 결과 객체로 정상 반환한 경우. `failed`와 함께 기록 |
| `submission_started` | 실제 생성·전송·업로드 수행 경계 직전 |
| `submission_accepted` | 성공 응답/유효한 hash 확인. 최종 확정과 별개 |
| `submission_confirmed` | 기존 제출 검증 통과. Greenfield는 seal/read 검증, DMRVN 전송은 기존 receipt/claim 검증 |
| `checkpoint` | 새 `EVIDENCE_SEALED`, `APPROVED` 상태로 전이. 논리 호출에서 한 번 |

상세 모드는 하위 호출의 `started`, `completed`, 상태 갱신과 `call_id`, `parent_call_id`, `duration_ms`를 추가합니다. 기본 모드에서는 이 필드와 별도 timestamp 속성을 출력하지 않습니다. OTLP 이벤트 시간은 LogRecord timestamp에만 설정합니다. 로컬 stdout에 시간 접두사가 필요하면 호스트 수집기가 추가하세요.

최상위 API가 받은 유효한 operationId/idempotencyKey를 `operation_id`로 사용하며 허용 형식은 `[A-Za-z0-9._:-]{1,128}`입니다. 부적합하면 로그 ID만 UUID로 바꿉니다. 원래 업무 인자 검증과 업무 idempotency key는 그대로 유지합니다. 중첩 호출의 키는 로그 ID를 변경하지 않습니다. 인자가 없는 API에는 UUID를 생성합니다.

하위 호출이 실패하면 `operation`, `operation_id`, `failed_stage`, `error.type`, 가능한 `error.code`, 안전한 `error.message`, 가능한 `http.status_code`/`upstream.code`, `last_confirmed_stage`, `last_confirmed_state`, `submission_state`를 기록합니다. 요청에 진입한 경우 `submission_target`, `submission_sequence`도 기록합니다. 원인 설명이 메시지와 같으면 별도 reason은 추가하지 않습니다.

제출 상태는 `NOT_ATTEMPTED`, `OUTCOME_UNKNOWN`, `ACCEPTED`, `CONFIRMED`, `NOT_BROADCAST`, `REJECTED`입니다. 타임아웃은 미전송 증거가 아닙니다. 명시적인 미전송/거절 사실만 해당 상태로 기록합니다. 생성·업로드·체인 전송은 각각 독립적인 요청 번호와 상태를 유지합니다. 중첩 signer/SDK/transport는 같은 요청 경계를 공유합니다.

예외 중복 제거는 예외 객체의 전파 관계를 사용합니다. 같은 코드/메시지의 다른 예외와 별도 재시도에서 재사용한 객체는 각각 기록합니다. 호출별 중복 기억은 128개로 제한하며 포화 시 추가 로그를 허용하여 오류를 보존합니다. journal 복원/반복 조회는 기존 체크포인트를 다시 전송하지 않습니다. 새 최상위 조회의 완료 요약은 남습니다.

업무 operationId와 제출 대상이 일치하는 요청만 journal 복원에 연결합니다. 다른 작업의 복원은 별도 요청 번호를 가지며, 진행 중인 제출의 상태를 덮어쓰지 않습니다. 이 연결 정보는 진단용 메모리에만 두며 업무 입력이나 journal 형식은 바꾸지 않습니다. 반환된 파트너 signer를 나중에 독립 호출할 때도 바인딩된 파트너 식별자를 기록합니다.

journal의 `ready=false`는 복구·재검증 중인 내부 상태일 수 있으므로 그 자체로 새 실패를 기록하지 않습니다. 준비 상태를 실패 결과로 해석하는 곳은 preflight 결과 경계입니다. 보고서 읽기 오류를 SDK 코드로 변환할 때도 최초 실패와의 전파 관계를 유지하며, 제출용 Context는 하위 완료 단계·업무 상태와 원래 호출 관계를 보존합니다.

## 민감정보·운영 책임

요청/응답 본문, header, token, 서명, 개인키, 회원 ID, 지갑 주소/hash를 진단 속성에 넣지 않습니다. 기존 SDK 오류의 정리된 메시지만 마스킹하며, 알 수 없는 adapter 예외 메시지는 고정 문구로 대체합니다. PEM/JWT/URL/secret/password/private key/긴 opaque·hex 값과 제어문자를 제거하고 메시지는 최대 512자입니다. stack과 cause 메시지는 전송하지 않습니다.

로그 실패는 업무 결과나 예외를 바꾸지 않습니다. 로그를 위해 업무 callback을 재실행하거나 외부 요청을 재시도하지 않습니다. exporter의 재시도는 로그 전송만 대상으로 합니다. queue 포화/전송 실패 시 로그가 유실될 수 있으므로 journal이나 업무 원장을 대신하거나 재시도 판단의 유일한 근거로 사용하면 안 됩니다.

`localSink`는 동기 함수와 비동기 함수를 모두 지원합니다. SDK는 로그 callback의 동기 예외와 비동기 rejection을 흡수하며 업무 호출에서 로그 완료를 기다리지 않습니다. 비동기 sink의 버퍼 제한과 정상 종료 시 배출은 호스트가 관리합니다.

HTTP 상태는 응답 header 수신 직후 보존하므로 본문 읽기 오류나 타임아웃에서도 확인할 수 있습니다. 내장 signer를 통한 전송은 권한·입력 검사를 통과한 뒤 signer의 제출 경계에서 시작 로그를 남깁니다. 이때 상위 DMRVN 요청 식별자를 이어받으며, 생성·전송을 추가 실행하지 않습니다.

내장 Privy signer의 시작 로그는 사전 취소 검사 후 HTTP 전송 직전에 기록합니다. 응답의 RPC 메서드와 hash 형식을 확인한 뒤 수락 로그를 남기며, 전송 전에 취소된 호출은 `NOT_ATTEMPTED`, 전송 후 결과 확인 전에 취소된 호출은 `OUTCOME_UNKNOWN`으로 구분합니다.

내장 Greenfield 저장소도 사전 취소와 worker 입력 준비가 끝난 뒤 제출 시작을 기록합니다. DMRVN의 상위 생성·업로드 경계는 이 시점까지 계측을 지연하며 요청 ID와 번호를 유지합니다. 사전 취소는 worker를 실행하지 않습니다. 공개 객체 조회의 HTTP 상태도 응답 수신 직후 보존합니다.

오류 코드는 작업 ID와 별도로 검증합니다. 정수 코드와 안전한 짧은 문자열 코드는 보존하고, hex·opaque·JWT 형태의 값은 오류 속성에서도 제외합니다. 로컬 JSON과 OTLP에 같은 정책을 적용합니다.

## Loki와 Grafana

[Collector 예제](diagnostics/collector.yaml)는 logs 파이프라인만 구성합니다. `OTLP_LOGS_LISTEN_ADDRESS`(예: `127.0.0.1:4318`), `LOKI_OTLP_ENDPOINT`(`/otlp`로 끝나는 주소), `LOKI_AUTHORIZATION`은 환경변수/secret manager로 주입합니다. 외부 수신 인증과 TLS는 운영 gateway에서 구성하세요. [Loki label 설정](diagnostics/loki-labels.yaml)은 기존 운영 설정에 병합합니다.

`partner_id`, `environment`를 groupbyattrs processor로 Resource에 올린 뒤 Loki index label로 매핑합니다. `operation_id`는 높은 cardinality를 가지므로 structured metadata로 조회합니다. Grafana Explore 쿼리 예:

```logql
{partner_id="101", environment="production"} | operation_id="request:123"
{partner_id="101"} | event="failed"
```

partnerId는 검색 라벨입니다. tenant 접근 권한은 인증된 gateway의 tenant 라우팅과 Loki/Grafana 접근 제어로 별도 보장해야 합니다. SDK가 partnerId를 tenant header로 변환하지 않습니다. 이 변경에서는 실제 Loki/Grafana 인프라를 배포하지 않았으며 loopback OTLP 수신까지 검증했습니다.

구성 근거: [OpenTelemetry Logs SDK](https://opentelemetry.io/docs/specs/otel/logs/sdk/), [Collector groupbyattrs](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/groupbyattrsprocessor/README.md), [Loki OTLP 수집](https://grafana.com/docs/loki/latest/send-data/otel/).

## 적용 범위와 검증

| 운영 경계 | 적용 위치 |
| --- | --- |
| 인증/토큰/header | PrivyClient, PrivyTokenVerifier |
| 지갑 생성/목록/소유권/export | PrivyClient, wallets, wallet-export, HTTP |
| 회원·파트너 권한과 지연 실행 signer | UserWalletClient/BeneficiaryWallets 어댑터와 반환 signer |
| 메시지/typed data/전송 | Privy signer, AssetClient |
| 잔액/거래 상세·상태·목록 | AssetClient, EvmTransactionClient |
| DMRVN 전체/개별 단계/결과 객체 | DmrvnClient, preflight, reader, 각 단계 함수와 상태 저장 경계 |
| 독립 RPC와 Greenfield | HttpEvmRpc, NodeGreenfieldStorage, GreenfieldPublicReader |

순수 ABI/암호화/JSON 변환, 설정 객체, journal primitive는 업무 작업을 만드는 최상위 운영 API가 아닙니다. 이들의 오류는 호출한 운영 단계에서 기록합니다.

`npm test`, `npm run test:greenfield`, `npm run check:package`로 회귀 검증합니다. `tests/diagnostics.test.mjs`는 기본 요약, 실제 RPC 호출 수, ID/key 구분, 중복/재시도/포화, 병렬 상태, 권한 오류, mock DMRVN, 마스킹, sink 장애, Span 미생성과 실제 OTLP HTTP payload를 검사합니다. provider는 테스트가 생성하고 종료합니다. 장애 후 정상 복구가 오류로 오인되지 않는지, 보고서 읽기 오류 변환이 중복되지 않는지, 제출 후 마지막 완료 단계와 업무 상태가 유지되는지도 검증합니다. 네트워크 오류 변환 전후의 중복 제거, 공개 API로 수행한 별도 작업 복원, 병렬 복원 격리, 지연 signer의 권한 철회와 파트너 식별자 보존도 회귀 검증합니다. OTel provider 타입 호환성은 `tests/fixtures/diagnostic-provider.ts`로 확인합니다.

같은 mock 입력을 변경 전 HEAD `a725690`와 비교했습니다. JSON UTF-8 및 줄바꿈 기준이며 상세 모드 바이트는 duration 값에 따라 조금 달라집니다. 실지갑 생성이나 실제 자금 전송은 없습니다.

| 시나리오 | 변경 전 | 기본 | 상세 | 업무 호출 |
| --- | --- | --- | --- | --- |
| 한 작업에서 잔액 조회 20회 | 0건 / 0 B | 1건 / 101 B | 122건 / 약 32.4 KB | 모두 RPC 40회 |
| DMRVN 제출 확인 | 0건 / 0 B | 12건 / 3,680 B | 615건 / 약 183 KB | 모두 RPC 141회, 생성·업로드·전송 각 1회 |

기본 DMRVN 12건은 완료 1 + 주요 체크포인트 2 + 생성·업로드·전송의 시작/수락/확인 각 3건입니다. 일반 하위 조회는 건수를 늘리지 않습니다. `node scripts/measure-diagnostics.mjs`로 재측정하고, 선택 인자로 동일 helper와 컴파일된 dist가 있는 변경 전 디렉터리를 전달하면 baseline을 측정할 수 있습니다.

측정 원본: [로그 사용량 데이터](diagnostics/volume.json).

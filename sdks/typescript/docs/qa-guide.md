# 내부 QA 시작 가이드

이 문서는 Recanet TypeScript SDK를 처음 전달받은 개발자와 QA 담당자를 위한 실행 순서·판정 기준이다.
SDK는 Node.js 서버 라이브러리이며 테스트 화면이나 HTTP 서버를 제공하지 않는다.
기준일: 2026-11-16. 실제 외부 서비스 인수는 아직 완료되지 않았다.

## 1. 테스트 범위 선택

| 구분 | 필요한 준비 | 확인할 수 있는 것 |
| --- | --- | --- |
| 로컬 회귀 시험 | 소스, Node, C compiler, 의존성 설치 | 합성 RPC/저장소 응답, 암호 벡터, 오류 처리, 로컬 파일 복구 |
| 실제 서비스 QA | 아래 환경 설정과 서비스 adapter | 실제 지갑·private Evidence·Claim 접수·검증자 결과 |

로컬 시험 통과는 실제 Privy/Greenfield/DMRVN 수용을 뜻하지 않는다. 기존 fixture와 동봉 testnet manifest를 현재 승인 설정으로 사용하지 않는다.
실환경 입력이 준비되지 않았으면 해당 시나리오는 **미실행**으로 기록한다.

## 2. 설치와 로컬 확인

소스 저장소 루트에서 실행한다. Node 22 이상, macOS/Linux 및 native 빌드용 C compiler와 `node_api.h`가 필요하다.
헤더 자동 검색이 실패하면 `RECANET_NODE_INCLUDE`에 헤더 디렉터리를 지정한다.

```sh
npm ci
npm ci --prefix tools/greenfield --ignore-scripts
npm run check
npm run check:package
```

- `check`: native/TypeScript 빌드, 본체 267개 및 worker 14개 시험. 현재 기준 실패·skip 0이 기대값이다.
- `check:package`: tarball을 임시 소비자 프로젝트에 설치하고 strict 타입·ESM·native 실행·문서 링크를 확인한다. 설치 시 네트워크가 필요할 수 있다.
- `listen EPERM 127.0.0.1`: 로컬 HTTP 서버를 사용하는 시험의 실행 환경 권한을 확인한다. 이 오류만으로 SDK 결함으로 판정하지 않는다.
- worker 모듈을 찾지 못하면 두 번째 설치 명령이 완료됐는지 확인한다.
- Linux/Node 버전별 기존 검증 범위는 [Linux 검증 기록](linux-verification.md)을 확인한다.

다른 서비스에 전달할 때는 빌드 후 `npm pack`으로 만든 tarball을 설치할 수 있다. 패키지는 현재 npm에 게시하지 않았다.
소비자 프로젝트는 ESM(`package.json`의 `"type": "module"`)으로 설정한다.
설치한 패키지의 `tools/greenfield`에도 별도로 의존성을 설치해야 한다.
다른 OS/arch로 전달하면 해당 패키지에서 `node scripts/build-native.mjs`로 native를 다시 빌드한다.
자세한 worker 설치 조건은 [worker 안내](../tools/greenfield/README.md)를 따른다.

## 3. 실환경 설정 체크리스트

아래 이름은 예제 함수의 입력 이름이다. SDK가 자동으로 읽는 환경변수 이름이 아니다.
비밀 값은 서비스 비밀 저장소에서 주입한다. SDK의 `NodeGreenfieldStorage`만 지정된 이름의 저장소 키 환경변수를 읽는다.

| 입력 | 자료형·조건 | 제공 주체 / 확인할 내용 |
| --- | --- | --- |
| `appId`, `appSecret` | 문자열 | Privy 테스트 앱 담당자, 앱 접근 권한 |
| `authorizationPublicPem`, `authorizationPrivatePem` | PEM 문자열 | 승인키 관리자. 기존 키를 재사용하며 호출마다 새로 생성하지 않음 |
| `operatorWalletId` | 문자열 | Privy 운영 지갑 ID. 승인키 권한과 체인의 approver 역할 필요. 동일 signer가 relay도 담당 |
| `namespace` | 서비스별 문자열 | 회원 식별자 namespace. 기존 매핑과 일치 |
| `deploymentManifest` | JSON 객체 | 배포 담당자의 승인 manifest와 출처. 주소를 임의로 조합하지 않음 |
| `rpcUrl` | EVM RPC URL | 승인 배포의 chainId와 일치 |
| `greenfieldRpcUrl`, `greenfieldChainId` | URL, 십진 문자열 | 저장소 담당자, 기존 bucket이 속한 네트워크 |
| `bucketName`, `objectPrefix` | 문자열, prefix는 `/`로 끝남 | QA 전용 쓰기 범위. prefix는 `/`로 시작하거나 `..`를 포함할 수 없음 |
| `storageAddress`, `storageKeyEnvironmentVariable` | 주소, 환경변수 이름 | 저장소 서명자와 해당 개인키의 환경변수. validator private read 권한 별도 확인 |
| `feeGranter` | 선택 주소 | feegrant를 사용하는 경우 실제 grant와 잔액 확인 |
| `maxRelayCostWei` | 양의 bigint | EVM relay 비용 상한. Greenfield 비용까지 제한하는 값은 아님 |
| `confirmations` | 1 이상의 정수 | 접수 조회의 확인 블록 정책 |
| `methodologyManifest`, `methodologyWasm`, `methodologyHash` | bytes, bytes, bytes32 hex | 승인 PET v3 패키지와 hash. 과거 `PET_HASH` 사용 금지 |
| `registry` | `MethodologyRegistry` 함수 | 실제 승인 registry의 활성 여부 조회. 실환경에서 `() => true`로 대체하지 않음 |
| `authorize` | 파트너·회원별 boolean/Promise 함수 | 서비스 인증·tenant 범위·동의·철회 확인. 모든 서명/전송 때 재확인 |
| `journalDirectory` | 로컬 POSIX 디렉터리 | 재시작 후에도 유지되는 경로. 단일 호스트용이며 NFS/분산 공유 미지원 |
| `reportSpEndpoint`, `reportBucketName` | URL, 문자열 | 신뢰한 공개 보고서 SP와 bucket. private Evidence bucket과 다를 수 있음 |

이번 PET 프로필은 partnerId=101, activityId=1003, methodology=2003/3, Evidence schemaVersion=4다.
`petBottleCount`의 자료형·범위는 아직 확정되지 않았다. 정상 시험값은 담당자가 제공한 벡터를 사용하고,
음수·소수·문자열 거부를 현재 SDK의 통과 기준으로 가정하지 않는다. [계약 상세](evidence-v4.md)

## 4. 클라이언트 구성 예제

아래 TypeScript 코드는 소비자 프로젝트의 `qa-client.ts`로 저장할 수 있는 구성 함수다.
환경 로더·실제 registry 조회·회원 권한 판단은 서비스에서 제공한다. 이 함수 자체는 거래를 전송하지 않지만
Privy 자격 및 운영 지갑 권한 조회를 수행하고 journal 디렉터리를 생성한다.

```ts
import {
  BackendWalletRegistration, PrivyClient, DmrvnDeployment, DmrvnConfig,
  HttpEvmRpc, NodeGreenfieldStorage, DeclaredMethodology,
  FileOperationJournal, DmrvnClient, DmrvnReader, GreenfieldPublicReader,
  type MethodologyRegistry,
} from '@recyclefarm/recanet-sdk';

export interface QaSettings {
  appId: string;
  appSecret: string;
  authorizationPublicPem: string;
  authorizationPrivatePem: string;
  operatorWalletId: string;
  namespace: string;
  deploymentManifest: Record<string, unknown>;
  rpcUrl: string;
  greenfieldRpcUrl: string;
  greenfieldChainId: string;
  bucketName: string;
  objectPrefix: string;
  storageAddress: string;
  storageKeyEnvironmentVariable: string;
  feeGranter?: string;
  maxRelayCostWei: bigint;
  confirmations: number;
  methodologyManifest: Uint8Array;
  methodologyWasm: Uint8Array;
  methodologyHash: string;
  journalDirectory: string;
  reportSpEndpoint: string;
  reportBucketName: string;
}

export async function createQaClient(
  settings: QaSettings,
  registry: MethodologyRegistry,
  authorize: (partnerId: number, userId: string) => boolean | Promise<boolean>,
) {
  const privy = new PrivyClient({ appId: settings.appId, appSecret: settings.appSecret });
  await privy.verifyAppCredentials();
  const registration = new BackendWalletRegistration(
    settings.authorizationPublicPem, settings.authorizationPrivatePem,
  );
  const operator = await privy.signerForWallet(settings.operatorWalletId, registration);
  const members = privy.userWallets(registration, settings.namespace);
  const wallets = members.forPartner(101, authorize);
  const deployment = DmrvnDeployment.fromManifest(settings.deploymentManifest);
  const config = DmrvnConfig.fromDeployment(deployment, {
    rpcUrl: settings.rpcUrl,
    greenfieldChainId: settings.greenfieldChainId,
    bucketName: settings.bucketName,
    objectPrefix: settings.objectPrefix,
    partnerId: 101,
    maxRelayCostWei: settings.maxRelayCostWei,
    confirmations: settings.confirmations,
  });
  const rpc = new HttpEvmRpc(settings.rpcUrl);
  const storage = new NodeGreenfieldStorage({
    rpcUrl: settings.greenfieldRpcUrl,
    chainId: settings.greenfieldChainId,
    address: settings.storageAddress,
    keyEnvironmentVariable: settings.storageKeyEnvironmentVariable,
    ...(settings.feeGranter ? { feeGranter: settings.feeGranter } : {}),
  });
  const methodology = DeclaredMethodology.petV3(
    settings.methodologyManifest, settings.methodologyWasm, settings.methodologyHash, registry,
  );
  const journal = new FileOperationJournal(settings.journalDirectory);
  const client = new DmrvnClient(config, rpc, operator, storage, methodology, journal);
  const reader = new DmrvnReader(
    config, rpc,
    new GreenfieldPublicReader(settings.reportSpEndpoint, settings.greenfieldChainId),
    DmrvnReader.defaultReportResolver(settings.greenfieldChainId, settings.reportBucketName),
  );
  return { privy, members, wallets, config, methodology, client, reader };
}
```

default resolver는 `dmrvn/v4/reports/<hash>.json`을 사용한다. 실제 배치가 다르면 승인된 `ReportResolver`를 주입한다.
공개 reader는 private Evidence를 읽기 위한 접근 권한을 제공하지 않는다.

## 5. 정상 제출과 조회

아래 예제는 앞의 `qa-client.ts`와 함께 사용한다. `runQaActivity` 호출은 지갑 생성·저장소 쓰기·대납 거래와 비용을 발생시킬 수 있다.
인증된 테스트 회원과 정상 입력 벡터, 허용 비용 범위를 확보한 뒤 호출한다.

```ts
import { ActivityRequest } from '@recyclefarm/recanet-sdk';
import type { createQaClient } from './qa-client.js';

type QaClient = Awaited<ReturnType<typeof createQaClient>>;

export async function runQaActivity(
  qa: QaClient, authenticatedUserId: string, sourceEventId: string,
  approvedPetBottleCount: unknown,
) {
  const preflight = await qa.client.preflight();
  if (!preflight.ready) throw new Error('preflight 실패: checks를 확인하세요');
  // ready=true라도 저장소 쓰기·validator 읽기·충분한 잔액은 별도로 확인한다.
  const outcome = await qa.client.submitActivity(qa.wallets, new ActivityRequest(
    authenticatedUserId, sourceEventId, { petBottleCount: approvedPetBottleCount },
    { gas: '900000', confirmationTimeoutMs: 60000, pollIntervalMs: 1000 },
  ));
  // 호출 서비스는 반환 ID를 접근 통제된 기록에 보존한다.
  // UNKNOWN이면 이 함수를 다시 호출하지 말고 7절의 원래 작업 복구를 따른다.
  return outcome;
}

export async function observeQaResult(qa: QaClient, operationId: string) {
  const state = await qa.client.operation(operationId);
  const fromBlock = state.submitFromBlock;
  if (typeof fromBlock !== 'bigint' && typeof fromBlock !== 'number') {
    throw new Error('접수 검색 시작 블록이 없습니다. 원래 제출 상태를 먼저 확인하세요');
  }
  return qa.client.readResult(operationId, qa.reader, fromBlock);
}
```

`sourceEventId`는 `[A-Za-z0-9:_-]` 1~128자다. 같은 이벤트 ID로 위 함수를 재호출해도 새 operation이 생긴다.
서비스에서 이벤트와 operationId를 연결하고 중복 호출을 제어해야 한다.
회원 기반 고수준 호출은 지갑을 확보/생성한다. 기존 일반 회원 지갑과 파트너 지갑은 자동으로 연결되지 않는다.

### 요청 옵션

| 필드 | 기본값 | 범위·의미 |
| --- | --- | --- |
| `claimId` | 새 operation에서 생성 | 지정하면 bytes32 hex. 중복 이벤트 방지 기능을 대신하지 않음 |
| `objectName` | prefix 아래 자동 생성 | 명시하면 설정된 prefix 범위 안의 경로 |
| `gas` | `'900000'` | `'100000'`~`'2000000'` 십진 문자열. 서명 대상 호출 gas |
| `confirmationTimeoutMs` | 60000 | 0~600000. 전송 결과 이후의 접수 확인 대기이며 전체 실행 timeout이 아님 |
| `pollIntervalMs` | 1000 | 1~10000 |

## 6. 반환값을 판정하는 법

`ActivityOutcome`의 필수 필드는 `outcome`, `lastConfirmedStage`, `confirmed`, `requested`다.
실패 시 `errorCode`가 추가될 수 있다. 다음은 값 구조만 보여주는 축약 예시다. ID와 hash는 실제 관찰값으로 대체한다.

```text
{
  outcome: "UNKNOWN",
  lastConfirmedStage: "SUBMISSION_BROADCAST",
  confirmed: {
    deploymentId, chainId, claimAddress,
    operationId, claimId, sourceEventId,
    beneficiary, evidenceHash, evidenceLocation,
    storageStatus: "SEALED", submissionFromBlock, txHash
  },
  requested: { evidenceLocation },
  errorCode: "SUBMISSION_UNRESOLVED"
}
```

| 결과·필드 | 의미 / QA 판정 |
| --- | --- |
| `outcome=CONFIRMED` | Claim 접수 거래 확인. 최종 유효 판정은 별도 |
| `outcome=UNKNOWN` | 부작용의 결과 미확정. 실패나 미전송으로 단정하지 않음 |
| `outcome=FAILED` | 해당 호출의 실패. 이전 지갑 생성·Evidence 저장 등 이미 완료된 단계가 자동 롤백되지는 않음 |
| `confirmed`의 ID들 | 설정/요청/생성 식별자. 이름과 달리 필드 존재만으로 객체·Claim의 존재를 증명하지 않음 |
| `evidenceHash` | 서명된 Evidence 관찰. 저장 완료 증거는 아님 |
| `storageStatus=SEALED` | 봉인과 저장 bytes 일치 확인 |
| `submissionFromBlock` | 전송 intent에 기록한 검색 시작점. 실제 전송 증거는 아님 |
| `txHash` | 전송 응답 또는 조회로 확보한 hash. 실행 성공은 receipt로 확인 |
| `requested.evidenceLocation` | 요청 위치. 검증에 실패한 위치일 수도 있음 |

`readResult`는 자동 polling하지 않는다. 최종 판정 대기는 호출 서비스가 기한을 정해 반복 조회한다.
반환값의 `chainStatus`는 `NONE / PENDING / VALID / INVALID / REVOKED`이며,
`reportVerified`와 `reportError`를 함께 확인한다. `INVALID`도 보고서의 서명·내용은 정상 검증될 수 있다.
정상 PET 수용 시나리오의 통과 기준은 승인된 기대 판정과 chainStatus의 일치 및 필요한 보고서 검증 성공이다.
`VALID`만 보고 보고서 검증 성공으로 기록하지 않는다. `metadataIndependentlyVerified`는 항상 false다.
`waitTimedOut`은 호출자의 대기 종료 표식이며 체인 task 만료를 의미하지 않는다.

## 7. 실패·중단 후 복구

DMRVN journal이 생성된 작업의 복구에는 원래 배포 설정, 동일 journal 디렉터리, operationId와 원래 입력이 필요하다.
`UNKNOWN`과 반환된 operationId만으로 journal의 존재를 보장하지 않는다.
journal을 지우거나 다른 ID로 재생성해 복구하지 않는다. journal snapshot에는 재사용 가능한 서명이 있으므로 전체를 로그에 출력하지 않는다.

| 상황 | 다음 행동 |
| --- | --- |
| `SUBMISSION_UNRESOLVED` / 전송 후 응답 유실 | `client.resolveSubmission(operationId, originalTxHash)`로 원래 거래 조회. hash가 없으면 생략 가능. 미확정이면 재전송하지 않고 조회 유지 |
| `STORAGE_CREATE_UNRESOLVED` | provider에서 원래 create hash를 확보하고 `recoverCreateTransaction(operationId, originalCreateTxHash)`로 결속 확인 후 원래 단계 재개 |
| Evidence 준비/승인 단계에서 중단 | `operation(operationId)`로 저장 상태 확인. 원래 operationId·claimId·beneficiary·objectName·body로 `prepareEvidence` / `approveClaim` 재개 |
| 서명 저장 후 중단 | 원래 ForwardRequest와 서명을 사용. 서명을 교체하거나 직접 납부/대납 모드를 전환하지 않음 |
| 지갑 확보 중 UNKNOWN (`lastConfirmedStage=REQUEST_ACCEPTED`) | 아직 DMRVN journal이 없을 수 있음. 동일 namespace·partnerId·userId로 Privy 지갑 상태를 먼저 확인. 아래 지갑 단계 절차 참고 |
| journal 생성 이후 고수준 ActivityRequest 호출이 UNKNOWN 반환 | 반환된 ID와 기존 journal로 해당 단계 API 사용. 고수준 호출을 다시 실행하면 새 작업이므로 복구가 아님 |
| 만료된 승인 | 자동 갱신되지 않음. 현재 nonce·예약·원래 거래를 확인하고 별도 운영 판단. deadline만 바꿔 같은 작업 재사용 금지 |

### 지갑 확보 단계에서 UNKNOWN이 반환된 경우

Privy 지갑 생성·조회 중 응답 유실이나 취소가 발생하면 `REQUEST_ACCEPTED` 단계에서 `UNKNOWN`이 반환될 수 있다.
이 경로는 Evidence 준비에 진입하기 전이므로 DMRVN journal이 생성되지 않는다.
이때 `operation(operationId)`나 `resolveSubmission`은 `OPERATION_NOT_PREPARED`로 실패하며, 이 오류는 지갑이 생성되지 않았다는 증거가 아니다.

1. 원래 namespace·partnerId·userId와 승인키 기준으로 Privy 측 지갑 생성/조회 결과를 확인한다.
   파트너 지갑의 external ID는 `memberExternalId(namespace, userId, partnerId)`로 계산한다.
   Privy 조회 도구 또는 서비스의 읽기 전용 adapter로 확인하며, 일반 회원용 `members.findWallet(userId)`는 파트너 매핑이 달라 대체할 수 없다.
2. `BeneficiaryWallets`의 공개 API에는 읽기 전용 조회가 없다. `getOrCreateSigner`는 지갑을 생성할 수 있으므로 단순 확인용으로 호출하지 않는다.
3. 지갑 확보 결과와 현재 회원 권한을 확인하고 이 호출이 DMRVN Evidence 준비 전에 종료됐음을 확인한 뒤 새 활동 제출 여부를 결정한다.
   이 경우 새 호출은 새 operation이며, 기존 DMRVN 작업을 재개하는 것이 아니다. 이전 결과와 새 ID의 관계를 QA 기록에 남긴다.

journal이 있어야 하는 이후 단계에서 `OPERATION_NOT_PREPARED`가 발생하면 경로·배포 설정·저장 상태부터 조사한다.
이를 지갑 단계 실패로 간주하거나 새 활동을 자동 제출하지 않는다.

`operation`은 저장 상태만 읽고 체인을 갱신하지 않는다. `readResult`의 관찰 저장도 접수 확인/nonce 예약 해제를 대신하지 않는다.
그 작업은 `resolveSubmission`이 담당한다. 기본 메모리 journal은 재시작 복구를 제공하지 않으므로 QA 구성은 FileOperationJournal을 사용한다.
파일 journal도 단일 호스트 로컬 파일 기준이며 분산 배포의 복구 보장은 별도다.

### 주요 오류 대응

| 코드 | 확인 / 조치 |
| --- | --- |
| `INVALID_CREDENTIALS`, `FORBIDDEN` | Privy 앱 자격·권한 확인. 고수준 활동 API에서는 `UNAUTHORIZED_SIGNER`로 매핑될 수 있음 |
| `MISSING_TOKEN`, `INVALID_TOKEN`, `EXPIRED_TOKEN` | 사용자 인증 입력 확인. `KEY_SOURCE_UNAVAILABLE`은 JWKS 공급원 장애로 구분 |
| `RATE_LIMITED` | `retryAfterMs` 참고. SDK는 자동 재시도하지 않으며 쓰기 결과를 먼저 확인 |
| `UNAUTHORIZED_SIGNER` | 승인키·운영 지갑·파트너 회원 권한/철회 확인 |
| `INVALID_INPUT`, `WRONG_CHAIN` | 값 형식·범위·체인 설정 수정 |
| `DEPLOYMENT_NOT_READY`, `UNAPPROVED_IMPLEMENTATION` | 승인 manifest와 실제 배포 비교 |
| `METHODOLOGY_UNAVAILABLE`, `EVIDENCE_CONTRACT_UNCONFIGURED` | 승인 패키지/hash·registry 활성·명시 프로필 확인 |
| `STORAGE_ACCESS_DENIED`, `STORAGE_ACCOUNT_UNFUNDED` | 저장소 키·객체 권한·feegrant·저장소 계정 잔액 확인 |
| `INSUFFICIENT_FUNDS` | 구성된 비용 부담 계정과 relay 비용 상한 확인 |
| `RPC_UNAVAILABLE`, `INTERRUPTED`, `STORAGE_UNAVAILABLE` | 호출이 중단됐어도 미전송 보장은 없음. journal intent와 기존 거래/객체부터 확인 |
| `OPERATION_INPUT_CHANGED`, `SUBMISSION_INPUT_CHANGED` | 원래 저장 입력과 비교. 같은 작업의 body·gas·서명을 변경하지 않음 |
| `REQUEST_EXPIRED`, `NONCE_CONFLICT` | 기존 승인·nonce·다른 진행 작업 및 원래 거래 확인 |
| `JOURNAL_UNAVAILABLE` | 경로·권한·잠금/adapter 확인. 새 journal로 바꿔 전송하지 않음 |
| `REPORT_LOOKUP_RANGE` | 원래 제출 시작 블록 또는 보고 거래 hash 제공 |
| `REPORT_TX_NOT_FOUND`, `REPORT_READ_FAILED` | 보고 거래 확인 높이·SP 가용성 확인 후 읽기 재시도 |
| `REPORT_MISMATCH` | 보고서/거래/서명 불일치 조사. 검증 성공으로 처리하지 않음 |
| `CHAIN_CHANGED` | 거래 목록 cursor를 폐기하고 새 snapshot으로 조회 |

오류 전체 목록은 `src/errors.ts`에 있다(소스 checkout용).
`DmrvnError.retryable()`과 `action()`은 보조 정보이며 새 ID 생성·무조건 재전송 허가가 아니다.
고수준 ActivityOutcome은 오류를 결과로 반환할 수 있고, 생성자·하위 단계 API는 예외를 던질 수 있으므로 양쪽을 처리한다.

## 8. QA 시나리오와 통과 기준

아래 실패 주입은 로컬 합성 adapter 또는 합의된 테스트 환경에서 수행한다.

| ID | 시나리오 | 통과 기준 |
| --- | --- | --- |
| Q01 | 전체 로컬 시험 / 패키지 설치 | 실패·skip 0 / 소비자 타입·ESM·native 검사 통과 |
| Q02 | 동일 회원 지갑 반복 조회/생성 | 동일 namespace·파트너 범위에서 같은 지갑 반환 |
| Q03 | 권한 거부 및 signer 확보 후 철회 | 권한 없는 서명·전송 차단. 기존 지갑 확보가 이후 사용 권한을 보장하지 않음 |
| Q04 | 정상/만료/잘못된 토큰 | 정상만 인증, 나머지는 해당 인증 오류. JWKS 장애는 토큰 오류와 구분 |
| Q05 | 잔액·ETH 전송·거래 조회 | 정확한 wei와 hash, receipt 실행 상태 대조. hash만으로 성공 판정하지 않음 |
| Q06 | PET 정상 대납 | SEALED bytes 일치, 접수 확인, 최종 기대 판정 및 보고서 검증 |
| Q07 | PET 직접 납부 | 별도 작업에서 직접 전송 후 원래 calldata·sender·receipt·Claim 결속 확인 |
| Q08 | 잘못된 PET 입력 키 / partner 설정 | `INVALID_INPUT`. petBottleCount 값 범위 검사는 미결로 별도 기록 |
| Q09 | 잘못된 배포/방법론 | preflight 또는 초기 검증 실패, 정상 준비로 표시하지 않음 |
| Q10 | 저장소 생성 응답 유실 | 원래 create hash로 복구, 중복 create 없음 |
| Q11 | 제출 응답 유실/대기 만료 | UNKNOWN 또는 미확정 오류 후 원래 거래 조회, 중복 제출 없음 |
| Q11a | 지갑 확보 중 Privy 응답 유실/취소 | REQUEST_ACCEPTED·UNKNOWN 및 DMRVN journal 미생성 확인. 파트너 지갑 상태를 별도 조회하고 단계 API 복구를 시도하지 않음 |
| Q12 | 프로세스 종료 후 재시작 | 같은 파일 journal·ID로 저장 사실 복원 및 기존 작업 복구 |
| Q13 | 동일 작업 입력 변경 | 변경 오류, 기존 승인·서명 보존 |
| Q14 | 보고서 접근 실패/변조 | chainStatus 보존, reportVerified=false와 reportError 확인 |
| Q15 | 빈 거래 목록 페이지 | nextCursor가 있으면 계속 조회; 빈 페이지를 목록 끝으로 오인하지 않음 |

직접 납부는 `prepareSelfPaid(operationId)`의 calldata로 beneficiary가 별도 전송한다.
반환 `value`는 십진 문자열이므로 EvmSigner의 hex Quantity로 변환하고 nonce/gas/gasPrice를 구성해야 한다.
동일 작업의 대납 모드를 직접 납부로 바꾸지 않는다. 상세 인수 순서는 [인수 문서](acceptance.md)를 따른다.

## 9. QA 결과 기록 양식

```text
시나리오 ID / 기대 결과:
실행 상태: 통과 | 실패 | 미실행
SDK commit / Node / OS / arch:
실행 시각과 timezone:
승인 환경·입력 벡터 참조:
deploymentId / methodologyHash:
operationId / claimId / sourceEventId:
createTxHash / 제출 txHash / reportTxHash:
lastConfirmedStage / outcome / chainStatus / reportVerified:
errorCode 또는 reportError.code:
재시작·복구 절차 및 중복 부작용 여부:
실제 결과 / 증거 위치 / 미실행 사유:
```

개인키·appSecret·토큰·전체 서명 snapshot·private Evidence 본문은 결과 보고서에 넣지 않는다.
식별자도 접근 통제된 QA 기록에 보존한다. bigint 값을 표시할 때 문자열로 변환하되,
해시·서명용 Evidence bytes 생성에는 일반 JSON 변환 대신 `DmrvnJson`을 사용한다.

## 10. 상세 문서

- [README](../README.md): 전체 기능과 API 사용 개요
- [인수 현황](acceptance.md): C-01~C-12 증거와 실환경 준비 항목
- [Evidence v4/PET v3](evidence-v4.md): 확정 계약과 미결 값 규칙
- [Java 대응](java-parity.md): API 차이와 보류 기능
- [의사결정 목록](decisions.md): 미확정 정책
- [Greenfield 의존성](greenfield-dependencies.md): 고정 의존성 감사 기록과 채택 미결 사항

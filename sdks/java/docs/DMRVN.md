# DMRVN Java SDK 연동

현재 구현은 Claim v7과 PET `activityId=1003`, `methodologyId=2003`, `version=1`을 사용한다. 신고 입력 `petBottleCount=3`의 예상 노드 계산 결과는 `estimated_co2e={value:"60",unit:"gCO2e",scale:0}`이다. Java SDK는 계산하거나 노드 합의를 대신하지 않는다. 승인 WASM의 실행은 오프라인 테스트에서만 한다.

반영 기준은 [공유 명세 `6da7d02`](https://github.com/RecycleFarm/specifications/tree/6da7d029ca9a9dad71e5b2928de0f3c06cc5b499/dmrvn/backend-sdk)의 2026-11-04 파트너 단일 요청 계약이다. `source.kind` 제거, 파트너 입력 보존, journal 선택화, 수혜자 지갑 생성·서명, 단일 운영 지갑, 단일 요청을 반영한다. Claim ABI/domain 및 WASM ABI는 유지한다.

공유 명세의 새 Evidence 버전·정확한 wire 규격, Privy 매핑/권한 정책, 결과 미확인 재시도 규칙은 아직 미결이다. 구현은 기존 공통 필드와 JCS/provenance 결속을 바탕으로 하며 새 버전을 임의로 정하지 않는다. 신규 고수준 API와 preflight는 명시한 `evidenceSchemaVersion`이 없으면 `EVIDENCE_CONTRACT_UNCONFIGURED`로 중단한다. 운영자가 합의한 공통 필드·JCS·버전 및 검증자 지원을 확인하고 설정해야 한다. 버전 설정만으로 새 wire 규격이나 실제 DMRVN 공동 인수가 완료되지는 않는다. 4인자 `DeclaredMethodology`는 기존 버전 값 3의 호환 경로이며 신규 고수준 API에는 사용할 수 없다. 과거 fixture·서명·저장 객체는 다시 쓰거나 재해시하지 않는다.

## 어디에 무엇을 저장하는가

| 위치/역할 | 저장하거나 수행하는 내용 |
| --- | --- |
| Greenfield Evidence | schemaVersion, sourceEventId, partner/activity/methodology, inputs, ownerHash, 발급자 provenance 서명을 포함한 전체 원본. JCS UTF-8 bytes를 private 객체로 저장한다. |
| Claim Contract v7 | beneficiary, approver, 활동/방법론, evidenceHash, methodologyHash, **전체 evidenceLocation**, location struct hash, 상태 및 최종 outputHash/reportHash를 보관한다. outputs 수치는 Final Report에 있다. |
| 운영 지갑 | provenance·Claim 승인과 Relay 대납에 동일한 EOA를 사용한다. 원본이나 Claim을 저장하는 장소가 아니다. 사용자가 서명한 요청을 `Forwarder.execute`로 전송하고 EVM 가스를 낸다. |
| Forwarder Contract | 사용자 ForwardRequest 서명·nonce·deadline을 검사한 뒤 Claim `submitClaim`을 호출한다. 서명에는 nonce가 있지만 execute tuple에는 nonce가 없다. |
| 선택적 파트너 journal | operationId, 입력/config fingerprint, 원본/서명/hash/전체 경로, CreateObject txHash, Claim 승인, 사용자 요청/서명, 전송 의도/시작 블록/txHash/receipt, 보고 거래와 조회 결과. |

`objectPrefix="partners/101/"`는 SDK가 파일 경로를 제한하는 설정이다. 실제 경로는 예를 들어 `partners/101/activities/1003/<sourceEventId>/evidence.json`이다. `prepareEvidence`에는 **전체 objectName**을 전달한다. prefix를 설정하는 행위가 Greenfield 권한을 부여하지 않으며, Claim에는 prefix만이 아니라 전체 경로가 들어간다.

## 현재 테스트 설정

- partnerId: `101`
- EVM 승인자 / Relay / Greenfield 업로더: `0xf288EC9EcC516a7E4C6780b417f3a247fE20cC77`
- Privy wallet ID: `y2hl7bcafkz4aapnw36dykav`
- 사용자 beneficiary: `0xeA9ecC2F4D32E075e961Afffd522bbf88BBA40a9`
- EVM: Arbitrum Sepolia `421614`
- 신규 Claim proxy: `0x5984B6C7773031497AcA9BF0C7C1155bdeAEd24e`
- 현재 구현: `0x9433EA187E38f9c7328cCDc2c229ED12E8746776`, `contractVersion=1.0.1`
- 과거 직접 배포(조회·receipt 복구 전용): `0x10615cB528FE09c73819f8F3345efb8024A81d15`
- Forwarder: `0x8A5CF02d9c8855d8dcdBb75b8ABd6d3e0C4e6c7c`
- Greenfield: testnet `5600`, bucket `dmrvn`, prefix `partners/101/`

이 값은 테스트넷 설정이다. 프로덕션 주소를 추정하지 않는다. `DmrvnConfig`에서 배포/namespace/Relay 비용 한도/확인 블록 수를 명시한다. `petTestnet()`은 확인 블록 수 1을 사용하는 시험용 설정이다. 운영 최종성 정책은 별도로 지정한다.

## Proxy 준비 검증과 호환 upgrade

`petTestnet()`은 JAR에 포함된 `deployment-testnet.json`의 승인 proxy manifest를 읽는다. Claim 승인 domain.verifyingContract, 직접 거래 `to`, `ForwardRequest.to` 모두 proxy다. EIP-712 Claim/Task/Observation version은 `7`, Forwarder는 `1`이며 구현 버전 `1.0.1`과 구분한다. 구현 또는 ProxyAdmin 주소로 업무 호출을 보내지 않는다.

`preflight()`의 `ready`와 `verifiedMetadata`로 현재 준비 상태를 확인한다. 동일한 블록 번호에 고정하여 chainId, proxy/Forwarder/ProxyAdmin/구현 code hash, ERC1967 구현·admin slot, ProxyAdmin owner, `contractVersion()`, 두 domain, trusted Forwarder를 검증하고 블록 hash도 재확인한다. 현재 manifest 구현 및 `approvedReleases`에 승인된 주소·hash·버전이 모두 맞아야 통과한다. 현재 활성 표시는 실제 slot에 따른다.

파트너가 제공한 승인 manifest는 `DmrvnDeployment.fromManifest(Json.object(manifestBytes))`와 `DmrvnConfig.fromDeployment(...)`로 명시적으로 선택한다. 사전 승인 release를 보완할 때는 갱신된 설정과 같은 journal로 클라이언트를 재구성한다. 원래 snapshot의 구현도 승인 목록에 남아 있어야 한다. 현재 지원하는 구현 버전은 명세의 `1.0.0`/`1.0.1`이다. 다른 버전은 명세·SDK 검토 후 추가한다.

operation의 최초 `deployment`는 불변이며 `verifiedMetadata`만 재검증 후 갱신한다. `deploymentId=chainId:contractAddress`와 입력 fingerprint에는 구현 버전을 넣지 않는다. 실패하면 `ready=false`와 `deploymentError`를 기록하고 이전 `verifiedMetadata`를 제거한다. 원본·ClaimRequest·승인·사용자 서명은 유지한다. `DEPLOYMENT_NOT_READY`, `UNAPPROVED_IMPLEMENTATION`, `DEPLOYMENT_COLLISION`은 자동 fallback이나 서명 재생성으로 해결하지 않는다.

앱 서명을 받고 전송을 나중에 할 경우 `recordSponsoredSignature(operationId, forwardRequest, userSignature)`로 먼저 저장한다. 이 함수는 거래를 보내지 않는다. 승인된 upgrade 후 `submitSponsored`는 저장된 정확한 서명을 사용하며, 현재 approver role·Claim/Forwarder nonce·deadline을 다시 검증한다. 만료·nonce 소비는 명시적 실패이며 자동 재승인하지 않는다.

과거 조회는 `DmrvnConfig.historicalDirectTestnet(...)` 또는 원래 승인 manifest·RPC·ABI v7·resolver로 구성한 reader를 사용한다. direct의 `contractVersion=null`, `contractVersionSupported=false`를 유지하며 version getter를 호출하지 않는다. 기존 11인자 `DmrvnConfig` 생성자는 과거 테스트넷 설정만 허용하는 deprecated 호환 경로다. 사용자 정의 배포는 전체 hash를 포함한 `fromDeployment`로 이전한다. 과거 direct에서 새 원본/승인을 만들 수 없으며 이미 제출한 거래와 결과의 조회·복구는 가능하다.

제출 전 원본 provenance signer와 approval signer의 일치 및 현재 역할을 확인한다. 생성 후에는 저장된 `Claim.approver`로 provenance를 검증한다. 이후 role 회수는 과거 Claim/보고서 무효화 사유가 아니다. `sdk.readResult`는 journal 원본도 검증하며, 독립 reader에서 원본 bytes를 확보한 경우 `verifyEvidenceProvenance(claimId, evidenceBytes)`를 사용할 수 있다. Report 검증은 성공 receipt·onReport·실제 다운로드 bytes의 서명/hash/source 결속을 근거로 하며 현재 역할을 소급 적용하지 않는다.

## 의존성과 signer

Java 17, 기존 Privy Java SDK, Jackson, Bouncy Castle을 사용한다. 공개 DMRVN API는 `Map<String,Object>`의 JSON 자료형과 자체 인터페이스를 사용하며 Privy/암호 라이브러리 타입을 노출하지 않는다. nonce/gas/value/deadline과 Greenfield chainId는 문자열이다.

EVM 승인·대납은 `PrivyEvmSigner`로 수행한다. authorization key 필터로 해당 지갑에 대한 접근을 확인하고, 실제 EIP-191/EIP-712 API를 호출한다. 지갑의 `public_key`는 블록체인 공개키이므로 P-256 authorization key와 비교하지 않는다. 사용자 개인키를 받거나 Privy export로 우회하지 않는다.

Greenfield는 Java용 `GreenfieldStorage` 인터페이스와 `NodeGreenfieldStorage` 구현을 제공한다. 공식 JS SDK의 protobuf·Reed–Solomon·CreateObject·ECDSA SP 인증을 사용하기 때문에 **이 어댑터 사용 시 Node 22 이상과 tools/greenfield 디렉터리가 추가로 필요하다. Java JAR만으로 Greenfield 쓰기가 동작하지 않는다.**

```bash
npm ci --prefix tools/greenfield --ignore-scripts --no-audit --no-fund
```

공식 `@bnb-chain/greenfield-js-sdk=2.2.2`, `@bnb-chain/reed-solomon=1.1.4` 및 전달 패키지의 lockfile을 고정했다. 라이선스/배포 의무와 전이 의존성 경고는 운영 배포 전 확인해야 한다. SDK 2.2.2의 일부 Cosmos 의존성은 deprecated다. 이번 작업에서 호환성을 확인하지 않은 버전으로 임의 변경하지 않았다.

storage signer 키는 `NodeGreenfieldStorage` 생성자에 지정한 환경변수에서만 읽는다. worker에는 그 키만 `GREENFIELD_STORAGE_PRIVATE_KEY`로 전달하고 Privy app secret/authorization key는 전달하지 않는다. timeout과 stdout 크기를 제한하며 upstream stderr를 로그에 내보내지 않는다. Greenfield chain 및 key에서 유도한 주소가 설정과 다르면 거부한다. 자체 Java/원격 signer가 있으면 `GreenfieldStorage`를 교체할 수 있다.

현재 로컬 예제 runner는 이미 설정된 `BACKEND_BLOCKCHAIN_WALLET_PRIVATE_KEY`를 Greenfield 전용 signer로 **명시적으로** 매핑한다. 새로운 키 내보내기를 수행하지 않는다. 일반 SDK는 `.env`를 자동으로 읽지 않는다.

## 초기화와 원본 준비

```java
var config = DmrvnConfig.petTestnet(101, "partners/101/", new BigInteger("1000000000000000"));
var rpc = new HttpEvmRpc(config.rpcUrl());
var keys = BackendWalletRegistration.fromEnvironment();
var signer = new PrivyEvmSigner(privyClient, "y2hl7bcafkz4aapnw36dykav", keys);
var storage = new NodeGreenfieldStorage(
    Path.of(System.getenv("DMRVN_NODE_PATH")), Path.of("tools/greenfield/worker.cjs"),
    URI.create("https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org"),
    "5600", signer.address(), "GREENFIELD_STORAGE_PRIVATE_KEY",
    System.getenv("GREENFIELD_FEE_GRANTER"), Duration.ofSeconds(240));

// 승인된 public package bytes를 읽고 manifest hash와 WASM hash를 검증한다.
// registry는 운영자의 현재 ACTIVE 확인을 제공하는 파트너 어댑터다.
// 운영자와 확인한 새 Evidence 버전. SDK가 기본값으로 추정하지 않는다.
var methodology = new DeclaredMethodology(
    manifestBytes, wasmBytes, DeclaredMethodology.PET_HASH, registry, confirmedEvidenceSchemaVersion);
var sdk = new DmrvnClient(config, rpc, signer, storage, methodology); // journal 불필요
// 필요하면 마지막 인자에 소비자 소유 OperationJournal을 명시적으로 추가한다.
var readiness = sdk.preflight();

var body = methodology.evidenceBody(101, beneficiary, sourceEventId, Map.of("petBottleCount", 3));
var prepared = sdk.prepareEvidence(operationId, claimId, beneficiary, objectName, body);
var approved = sdk.approveClaim(operationId);
```

단계별 API의 `claimId`는 호출자가 정하는 bytes32이고 `sourceEventId`는 실제 행위별 고유 ID다. SDK는 `inputs` 객체의 필드·값 타입·배열 순서를 보존한다. `inputSchema`/`evidenceValidation.kind`로 입력 프로필을 강제하지 않으며 PET 수량 범위나 기기 인증서의 의미를 판단하지 않는다. 입력의 형식·값은 파트너 책임이며 승인 방법론에 따른 검증은 DMRVN 노드가 담당한다. `source`에는 beneficiary에 결속된 `ownerHash`만 넣고 `kind`는 받지 않는다.

공통 JSON 직렬화·크기·배포·활동/방법론·ownerHash·서명·hash·저장 bytes 결속 검사는 유지한다. 중첩 객체·배열·문자열·boolean·null·소수 입력을 허용한다. JSON 정수는 안전 정수 범위, 소수는 IEEE-754 JCS로 값 손실 없이 왕복 가능한 수를 사용하고 NaN/Infinity·잘못된 Unicode·중복 JSON 키는 거부한다. 고정밀 수치는 파트너가 처음부터 문자열 등으로 표현해야 하며 SDK가 문자열/수치를 바꾸지 않는다.

원본 준비 순서는 입력 snapshot → provenance 서명 → journal 저장 → CreateObject 의도 기록 → CreateObject hash 저장 → upload → SEALED 조회 → 실제 저장 bytes 일치 확인이다. 이후 승인에서는 저장 bytes·ownerHash·방법론·승인자 role·Claim nonce를 다시 확인한다. 읽기 전용 preflight는 실제 private 쓰기/검증자 읽기까지 통과했다고 표시하지 않는다.

`DeclaredMethodology.Registry`는 배포마다 주입한다. handoff에는 공개 Registry 조회 API가 없으므로 현재 상태를 SDK가 Firebase로 직접 조회하지 않는다. 실행 예제만 제공된 **2026-10-07 ACTIVE 스냅샷**을 명시적으로 사용한다. manifest/WASM public bytes는 실시간 조회·검증하지만 현재 Registry ACTIVE 및 5개 노드 준비는 RCF 확인 대상이다.

## 회원 지갑 생성·자동 서명과 단일 호출

```java
var memberWallets = new UserWalletClient(privyClient, keys, "recanet-prod");
// 애플리케이션의 인증된 파트너 자격·범위와 회원 동의/철회를 확인하는 정책.
// userId만으로 true를 반환해서는 안 된다. 검증 실패 시 false 또는 예외로 거부한다.
var beneficiaries = memberWallets.forPartner(101, (partnerId, userId) ->
    accessPolicy.isWalletUseAuthorized(authenticatedPartnerCredentials, partnerId, userId));

var submission = sdk.submitActivity(beneficiaries,
    new ActivityRequest(memberId, sourceEventId, Map.of("petBottleCount", 3)));
```

한 번의 호출로 **권한 확인 → 수혜자 지갑 조회/생성 → Evidence 생성·provenance 서명 → Greenfield 생성·봉인·실제 bytes 재조회 → Claim 승인 → 수혜자 서명 → 운영 지갑 Relay 제출 → 성공 receipt/Claim 확인**을 수행한다. 사전 지갑 생성, Evidence body 조립, 사용자 서명 전달은 필요 없다. `BeneficiaryWallets`를 구현하면 파트너가 확정한 기존 지갑 매핑/권한 시스템을 사용할 수 있다. 반환 signer도 실제 서명 직전에 권한을 확인해야 한다.

`UserWalletClient.forPartner`는 서비스 namespace + partnerId + memberId의 명시적 Privy external ID 매핑을 선택하는 어댑터다. 같은 memberId도 partnerId가 다르면 별도 지갑이다. 기존 비파트너 매핑의 지갑을 자동 채택하지 않는다. 파트너 요청이 다른 partnerId를 지정하면 지갑 조회 전에 거부하고, 지갑 준비 시점과 각 서명/전송 직전에 파트너 정책을 재확인한다. 실제 자격 검증·동의/철회는 위 정책으로 연결하며 Privy wallet 소유 권한은 Privy 어댑터가 확인한다. 이 매핑은 공유 명세의 미결 사항을 확정한 표준이 아니다.

기본 `ActivityRequest`는 호출마다 새 내부 operationId·claimId·objectName을 만들고, receipt 확인을 최대 60초 동안 1초 간격으로 조회한다. 전체 생성자는 선택적 claimId·objectName, 서명할 inner gas, confirmationTimeout/pollInterval을 받는다. 대기 한도는 제출 후 확인 조회의 한도이며 전체 Greenfield/Privy/RPC 처리 시간 제한은 각 어댑터에 적용된다. gas 기본값은 `900000`이고 서명 후 변경하지 않는다. 새 호출은 새 작업이므로 같은 sourceEventId로 재호출해도 복구·중복 방지·경로 재사용을 보장하지 않는다. 여러 프로세스의 같은 운영 지갑 사용과 nonce 직렬화는 소비자가 관리한다.

반환은 `outcome`, `lastConfirmedStage`, `confirmed`, `requested` 및 오류 시 `errorCode`다.

| outcome | 의미 |
| --- | --- |
| `CONFIRMED` | 성공 receipt·발신 운영 지갑·Forwarder 실행 이벤트·Claim 결속을 확인했다. `confirmed.chainStatus=PENDING`은 최종 VALID가 아니다. |
| `FAILED` | 확인한 단계에서 다음 처리를 중단했다. 봉인 후 실패라면 저장 객체는 남을 수 있다. |
| `UNKNOWN` | 저장/전송 결과 또는 receipt 확인이 미확인이다. 실패·미전송·안전한 재시도의 뜻이 아니다. |

`confirmed`에는 실제 확인한 evidenceHash, createTxHash, evidenceLocation, storageStatus, submissionFromBlock, txHash, receipt/chainStatus만 해당 시점에 포함한다. 요청 식별자와 배포도 보존한다. `requested.evidenceLocation`은 생성 응답 유실 시 조사할 **의도한 경로**이며 저장 성공 증거가 아니다. 외부 어댑터의 원문 오류·키·토큰·재사용 서명은 반환하지 않는다. 소비자가 응답과 필요한 기록을 보존하고 장애 조사·복구를 수행한다. 결과 조회는 반환된 claimId·submissionFromBlock과 `DmrvnReader`로 journal 없이 진행할 수 있다.

기존 `submitActivity(UserWalletClient, ... evidenceBody ...)`와 `submitActivity(EvmSigner, ...)`는 사전 준비한 지갑/body를 쓰는 조합 경로로 남는다. 새 연동은 위 `BeneficiaryWallets`/`ActivityRequest` 경로를 사용한다. `prepare(...)`와 사용자 직접 가스비 납부용 단계별 API도 유지한다.

## 대납 / 직접 납부 (단계별 API)

대납에서는:

```java
var signingRequest = sdk.prepareSponsored(operationId, "900000");
// 앱이 domain/types/primaryType/forwardRequest를 beneficiary 지갑으로 서명한다.
var submission = sdk.submitSponsored(operationId, forwardRequest, userSignature);
var confirmed = sdk.resolveSubmission(operationId, submissionTxHash);
```

SDK는 저장된 ForwardRequest와 앱 입력의 동일성, 서명 복구, Claim/Forwarder nonce, 대상/가스/기한을 확인하고 `verify`·가스 추정·simulation을 수행한다. outer Relay tx gas는 추정값의 130%로 설정하되 **사용자가 서명한 inner gas/data는 바꾸지 않는다.** 비용 한도와 잔액을 검사하고 Relay nonce를 직렬화한다. `BROADCAST`는 API 접수, `CONFIRMED`는 실제 성공 receipt 및 Claim 검증이다. 최종 `VALID`와 다르다.

직접 납부에서는:

```java
var transaction = sdk.prepareSelfPaid(operationId);
// 앱의 beneficiary 지갑이 chainId/to/value/data를 전송한 후 txHash를 반환한다.
var confirmed = sdk.resolveSubmission(operationId, appTransactionHash);
```

`prepareSelfPaid`는 앱이 전송하기 전에 시작 블록과 전송 의도를 저장한다. operation당 제출 방식을 하나 선택한다. 대납/직접 납부 시험에는 **서로 다른 sourceEventId·claimId·operationId**가 필요하다. 이 단계별 경로에서는 앱이 사용자 거래를 서명하며 SDK는 ETH를 자동 충전하지 않는다.

receipt 조회는 sender/to/value/calldata, Claim 생성 이벤트와 nonce, approver·beneficiary·방법론·원본/location을 대조한다. 대납은 `ExecutedForwardRequest` signer/nonce/success도 검증한다. 단순 txHash 수신이나 nonce 증가를 성공으로 보지 않는다.

## 결과 조회

```java
var reader = new DmrvnReader(config, rpc,
    new GreenfieldPublicReader(URI.create("https://gnfd-testnet-sp1.bnbchain.org"), "5600"),
    DmrvnReader.defaultReportResolver("5600", "dmrvn"));
var result = sdk.readResult(operationId, reader, submissionStartBlock, reportTxHash, false);
// 또는 journal/Privy 없이 reader.readResult(claimId, fromBlock, reportTxHash, waitTimedOut, expectedFileHash)
```

검증 내용:

1. chain ID·Claim runtime code hash·trusted Forwarder와 확인 블록 수 확인.
2. getClaim 상태와 성공한 onReport receipt·canonical block hash·이벤트/calldata 대조.
3. TaskAssignment·committee hash·coordinator 서명·quorum Observation 서명·원본/location·protocol reportHash 대조.
4. 실제 Greenfield Final Report bytes를 읽고 outputs·Observation·서명자·원본 위치를 대조.

`reportTxHash`를 알고 있으면 직접 조회한다. 모르면 명시적 fromBlock부터 최대 100,000블록을 1,000블록씩 조회한다. 오래된 건은 파트너 index/저장한 txHash를 사용한다. 기본 resolver는 `dmrvn/v4/reports/<reportHash without 0x>.json`이며 배포별 교체가 가능하다.

- PENDING → WAITING 또는 LOCAL_WAIT_TIMEOUT, taskStatus=UNKNOWN. NO_QUORUM/EXPIRED를 추정하지 않는다.
- VALID/INVALID는 chainStatus다. INVALID의 빈 outputs/zero outputHash도 정상 결과다.
- 보고서 읽기/검증 실패는 `reportError`로 표시하고 확인한 chainStatus는 유지한다.
- `fileHash`는 다운로드 bytes checksum이며 protocol reportHash와 다르다.
- 외부 파일 commitment가 없으면 `fileHashVerification=DOWNLOAD_CHECKSUM_ONLY`, `metadataIndependentlyVerified=false`다. 설명 메타데이터나 실제 재활용 행위를 검증했다고 표시하지 않는다.

## 선택적 영속화와 소비자 복구

기본 초기화 및 신규 단일 요청에 durable journal은 필요 없다. 기본 상태는 메모리에만 존재하며 새 단일 요청마다 격리된다. SDK는 자동 복구·정확히 한 번 제출·중복 방지를 보장하지 않는다. 아래 내용은 소비자가 선택적으로 journal과 기존 단계별 조사 API를 사용하는 경우의 어댑터 계약이다. 오류의 `retryable()`/`action()`은 해당 단계별 경로의 분류이며 새 요청을 안전하게 재전송하라는 지시가 아니다.

`OperationJournal`은 파트너 DB로 교체하는 인터페이스다. `withLock/load/store/findOperationsByClaimId`를 제공하며 operation·source event·사용자 Claim nonce·Relay nonce 예약을 함께 보관한다. `store`는 전체 snapshot을 교체하고, load는 사본을 반환해야 한다. 분산 환경은 모든 SDK 인스턴스가 공유하는 트랜잭션/잠금과 fencing을 구현해야 한다.

`claim-id:<claimId>` 잠금·예약은 배포를 가로질러 공유한다. DB adapter의 `findOperationsByClaimId`는 모든 배포의 기존 operation(이전 버전 기록 포함)을 반환해야 한다. 미구현 default는 `JOURNAL_UNAVAILABLE`로 준비를 중단한다. File journal은 이전 index 없는 operation도 검색한다. 다른 배포의 같은 claimId는 `DEPLOYMENT_COLLISION`, 같은 배포의 다른 operation 예약은 `NONCE_CONFLICT`이며 원래 예약을 덮어쓰지 않는다. 전환 시 이전 SDK writer를 중지하고 DB의 과거 claimId index를 준비한다.

`FileOperationJournal`은 **하나의 호스트에 연결된 로컬 디스크용**이다. OS file lock·0600 파일·0700 디렉터리·atomic rename·fsync를 사용한다. NFS/다중 호스트 DB 대용이 아니다. 승인/사용자 서명이 포함되므로 디렉터리를 비공개로 보관하고 접근·보존 기간을 관리한다. 키와 토큰은 journal에 넣지 않는다.

- 같은 operation 입력/config 변경: OPERATION_INPUT_CHANGED. 원본을 조용히 덮어쓰지 않는다.
- 최초 전송 의도 이후: SUBMISSION_UNRESOLVED이면 **조사만** 수행한다. timeout/없는 Claim은 미전송 증거가 아니다.
- CreateObject 응답 유실: 같은 경로를 조회하고 기존 거래를 찾는다. 원래 hash를 확보하면 `recoverCreateTransaction`이 creator/객체/성공 거래를 검증한 뒤 업로드를 재개한다. 못 찾으면 STORAGE_CREATE_UNRESOLVED를 유지한다.
- storage adapter가 **broadcast 이전 실패** 또는 **CheckTx의 명시적 거절**을 확정한 경우 create intent를 해제하고 같은 원본으로 재시도할 수 있다. timeout/연결 단절은 여기에 해당하지 않는다.
- 사용자/Relay 예약은 확인된 성공 receipt 이후 해제한다. 만료·실패/불명 거래의 예약 해제와 nonce/deadline 재발급은 자동 수행하지 않는다. 운영자가 기존 제출을 조사한 뒤 명시적인 새 작업/복구 절차를 마련해야 한다.
- 별도 서비스/사용자가 같은 Relay를 동시에 쓰면 SDK journal이 제어할 수 없다. Relay를 전용으로 사용한다.

## 실행 예제

아래 testnet 실행기는 과거 단계별 대납/직접 납부 경로의 진단용이다. 새 단일 요청의 Privy·DMRVN 공동 인수 증거가 아니다. `DMRVN_EVIDENCE_SCHEMA_VERSION`은 운영자가 확인한 값으로 명시해야 하며 새 Evidence를 기존 노드가 지원하는지 확인하기 전에 쓰기 시험을 수행하지 않는다. 과거 operation/객체를 새 형식으로 재작성하지 않는다.

```bash
./gradlew clean build compileExamplesJava
npm test --prefix tools/greenfield
npm run test:pet-wasm --prefix tools/greenfield

# 읽기 전용. wallet/sign 모드만 로컬 .env의 Privy 키를 명시적으로 로드한다.
python3 tools/run-dmrvn-diagnostics.py chain
# 과거 직접 배포 결과는 원래 경로를 명시한다.
DMRVN_DEPLOYMENT=direct-v7 DMRVN_READ_CLAIM_ID=0x... DMRVN_READ_REPORT_TX_HASH=0x... python3 tools/run-dmrvn-diagnostics.py read
# 별도 승인 manifest는 환경 변수로 파일 경로를 제공한다(선택 실패 시 중단).
DMRVN_DEPLOYMENT_MANIFEST=/absolute/path/approved-deployment.json python3 tools/run-dmrvn-diagnostics.py chain
python3 tools/run-dmrvn-diagnostics.py wallet
python3 tools/run-dmrvn-diagnostics.py sign  # 메시지 및 만료 Claim 서명; 거래 전송 없음
node tools/greenfield/permissions.cjs

# 실제 Greenfield 테스트넷 비용 발생. 사용자 주소와 101 설정은 현재 예제에 반영돼 있다.
# 기존 direct 세션을 보존하고 명시적인 새 proxy 이벤트로 시작하는 경우:
export DMRVN_PET_RUN_ID=proxy-20261012
python3 tools/run-dmrvn-pet.py evidence
# 앱 서명 준비가 됐을 때만 실행: 승인 기한은 현재 블록 시간부터 15분이다.
python3 tools/run-dmrvn-pet.py sponsored
# .dmrvn-journal/sponsored-sponsored.json의 typed data를 앱에서 서명한다.
DMRVN_USER_SIGNATURE_FILE=/absolute/path/signature.txt python3 tools/run-dmrvn-pet.py submit
python3 tools/run-dmrvn-pet.py resolve
python3 tools/run-dmrvn-pet.py read

# 직접 납부는 별도 원본과 operation으로 시험한다.
DMRVN_SUBMISSION_MODE=self-paid python3 tools/run-dmrvn-pet.py evidence
DMRVN_SUBMISSION_MODE=self-paid python3 tools/run-dmrvn-pet.py self-paid
# 앱이 .dmrvn-journal/self-paid-self-paid.json을 전송한 후:
DMRVN_SUBMISSION_MODE=self-paid DMRVN_SUBMISSION_TX_HASH=0x... python3 tools/run-dmrvn-pet.py resolve
```

테스트 내부에서 사용자 서명을 생성해 실제 테스트넷 대납 경로를 검증하려면 다음을 실행한다:

```bash
python3 tools/run-dmrvn-live-test.py
# 별도 신규 이벤트로 재시험할 때만 새 run ID를 지정한다.
DMRVN_LIVE_RUN_ID=proxy-20261012 python3 tools/run-dmrvn-live-test.py
# 같은 Claim의 결과 대기를 늘릴 때는 run ID를 그대로 유지한다.
DMRVN_LIVE_RUN_ID=proxy-20261012 DMRVN_LIVE_WAIT_MINUTES=30 python3 tools/run-dmrvn-live-test.py
```

`DmrvnPetLiveTest`는 일반 `test` 실행에서 제외된 명시적 실환경 JUnit 테스트다. 테스트 전용 beneficiary가 EIP-712 서명을 만들고 SDK에는 서명만 전달한다. 승인자·Relay는 실제 Privy 지갑, 저장소는 실제 Greenfield를 사용한다. PET 3개로 새 이벤트를 만들어 `SEALED → Claim receipt → VALID → reportVerified=true → 60 gCO2e`를 검증한다. 사용자 ETH 잔액은 0인 상태를 확인한다.

테스트 지갑 키는 `.dmrvn-test-secrets/`에 0600 권한으로만 저장하며 Git·journal·출력에 포함하지 않는다. 실제 사용자 지갑을 서명하거나 제품 코드에 사용자 서명 로직을 추가하지 않는다. 동일한 `DMRVN_LIVE_RUN_ID`(미지정 포함)로 재실행하면 같은 테스트 지갑·operation을 사용하며 이미 전송한 거래를 조회해 이어간다. 새 run ID는 새 sourceEventId·원본·Claim을 생성한다. 결과와 실제 receipt/보고서는 `.dmrvn-journal/`의 `live-test:pet-result:<operationId>` 및 `live-test:pet-latest-result` 항목에 보관한다. 최종 결과의 기본 대기는 10분이며 `DMRVN_LIVE_WAIT_MINUTES`로 1~60분을 지정할 수 있다. 기한 내 미확정이면 전체 E2E 성공으로 처리하지 않으며, 로컬 대기 시간 초과를 네트워크의 검증 실패로 해석하지 않는다.

`sign` 진단은 실제 전송 가능한 승인을 만들지 않는다. PET runner는 자동 사용자 서명, 자금 이체, Feegrant 생성, 권한 변경을 하지 않는다. Greenfield Feegrant를 쓰려면 `NodeGreenfieldStorage`의 granter에 운영자가 제공한 공개 주소를 넣는다. SDK는 권한·잔액 부족을 숨기거나 다른 지갑으로 우회하지 않는다.

현재 테스트넷 Feegrant granter는 `0x812EA1e3fb2EFA004AE1308ed27EcEd0b05Cae66`이다. 업로더 잔액 0 BNB에서 CreateObject·private 업로드·SEALED·동일 bytes 재조회가 성공했다. 이 단일 CreateObject의 서명자는 업로더 1명이며 granter의 거래별 서명은 추가하지 않는다.

Greenfield worker는 creator/payer/granter를 EIP-55 체크섬 주소로 통일한다. 테스트넷에서 creator/payer를 소문자로 넣으면 동일 지갑이어도 `wrong number of signers; expected 2, got 1: unauthorized`가 재현됐다. 체크섬 주소로 서명한 거래는 서명 1개로 통과했다. 이 오류는 `SIGNATURE_INVALID`로 구분하며 쓰기 권한 부족으로 표시하지 않는다.

## 검증 범위와 미완료 사항

실행 기록은 [DMRVN_VALIDATION.md](DMRVN_VALIDATION.md)를 따른다. 현재 구현의 단위/HTTP mock·참조 벡터·실제 읽기 검증을 새 제품의 전체 E2E PASS로 합치지 않는다. 실제 Greenfield 봉인과 업로더 재조회는 완료했다. 앱 사용자 서명/직접 전송, 새 Claim의 최종 결과, RCF 검증자 private 원본 접근과 5명/3-of-5 공동 증거, DB 분산 fencing, 로컬 EVM 실제 revert 변형은 별도 확인 대상이다.

공식 구현 참조: [Greenfield object API](https://docs.bnbchain.org/greenfield-js-sdk/api/object/), [Privy 서명 API](https://docs.privy.io/wallets/using-wallets/ethereum/sign-a-message), [Privy authorization 구조](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls). 프로토콜 기준은 위 공유 명세 commit의 v7 ABI/벡터/PET 문서다. 고정 과거 벡터 bytes는 유지한다. `DMRVN_PET_RUN_ID`와 `DMRVN_LIVE_RUN_ID`는 별도의 runner 설정이며 실행을 이어갈 때 동일한 값을 사용한다. 과거 세션에 proxy 설정을 적용하면 충돌로 중단하며 자동으로 새 Claim을 만들지 않는다.

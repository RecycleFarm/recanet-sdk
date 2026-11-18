> 이 문서는 이전 이관 조사 기록이다. 2026-11-17 공통 Contract 정렬로 아래의 미구현/보류/PET 전용 정책은 대체되었다. 현재 동작과 검증은 저장소 `contracts/recanet-sdk-contract.md`, `contracts/gaps.md`를 따른다.

# Java SDK 기능 비교

후속 갱신: 이 표는 Java 기준 commit과의 비교 기록이다. 이후 2026-11-05 Page 댓글의 확정 Evidence4/PET3를
반영해 petV3 프로필과 새 제출/조회 시험을 추가했다. 현재 구현과 미검증 범위는 [후속 계약](evidence-v4.md)을 확인한다.

확인일: 2026-11-09. 비교 기준은 형제 저장소 `recanet-java`의 현재 HEAD인
`37c78cfa01d9892ca26de61bb74df827923917cf`다.
Java `src/main/java`의 공개 최상위 타입 39개와 내부 타입 7개를 TypeScript 공개 진입점 및 구현과 대조했다.
이 기록은 API와 구현 경로의 대응 감사이며, 모든 입력의 바이트/오류 동등성이나 외부 서비스 수용을 증명하지 않는다.
구체적인 언어별 경계와 미결 정책은 [의사결정 목록](decisions.md)을 함께 확인한다.
C-12는 사용자의 요청으로 추후 결정 상태를 유지한다.

## 이번에 보완한 호출

| Java API | TypeScript 보완 | 검증 |
| --- | --- | --- |
| EvmTransactionClient.listTransactions(address, limit, cursor) | 같은 이름의 overload, genesis/latest 기본 범위 | cursor 재개·입력 거부·취소 전달·기존 query 호출 회귀 |
| DmrvnClient.submitActivity(UserWalletClient, userId, operationId, claimId, objectName, body, gas) | 같은 이름의 overload, 기존 회원 signerFor 조회 | 자동 생성 없음·조회 오류 전파·await 전 본문 복사·기존 활동 경로 회귀 |
| Json.object(bytes) | DmrvnJson.object(bytes) | 최상위 객체 제한·decimal/특수 키 보존·기존 JSON 거부 경계 |

## 공개 타입 39개의 대응

타입 이름이 같더라도 Java 생성자·getter를 그대로 복제했다는 의미는 아니다.
TypeScript는 Promise, options 객체, readonly property/interface로 대응하며,
아래에 별도 표시한 편의 기능과 진단 조회 차이는 남아 있다.

| Java 공개 타입 | TypeScript 대응 및 기능 |
| --- | --- |
| AssetClient | AssetClient: ETH 잔액·단일 전송·체인/금액 검증 |
| AuthenticatedUser | AuthenticatedUser: app/user/session과 UTC epoch 밀리초 bigint 시각 |
| BackendWallet | BackendWallet interface |
| BackendWalletCreateRequest | BackendWalletCreateRequest interface |
| BackendWalletKeyPair | BackendWalletRegistration.generate와 publicKey/privateKey property로 통합; 자동 로그 보류 |
| BackendWalletRegistration | 같은 이름의 등록/승인키 타입; 환경 로더 보류 |
| EvmTransaction | 같은 이름의 readonly 상세 interface, 원본 transaction/receipt snapshot |
| EvmTransactionClient | 상세·상태·범위 query 및 limit/cursor 편의 목록 호출 |
| EvmTransactionPage | 같은 이름의 readonly 페이지 interface |
| EvmTransactionQuery | 같은 이름의 query interface; withCursor는 `{ ...query, cursor }`로 표현 |
| EvmTransactionStatus | 같은 이름의 readonly 상태 interface 및 EvmTransactionState |
| PrivyApiException | PrivyApiError: code/statusCode/retryAfterMs |
| PrivyAuthenticationException | PrivyAuthenticationError |
| PrivyClient | 자격 진단·토큰 검증·등록·목록·기존 소유권 비교·명시 export; bootstrap/로그·config 조회 차이는 아래 참조 |
| PrivyClientConfig | PrivyClientOptions: 앱 자격·origin·timeoutMs·tokenVerification; 설정 getter 차이 |
| PrivyEvmSigner | await client.signerForWallet: 승인키 목록 권한 검사 후 메시지/EIP-712/거래 서명자 반환 |
| PrivyTokenVerificationConfig | TokenVerificationOptions/JwksPolicy: 고정 공개키 또는 JWKS·clockSkewMs·캐시/갱신 정책 |
| PrivyTokenVerifier | verifyAccessToken·authenticateAuthorizationHeader |
| TransactionQueryException | TransactionQueryError |
| UserWallet | 같은 이름의 readonly interface |
| UserWalletClient | client.userWallets 반환 interface: 조회·생성·회원 서명/전송·signerFor·forPartner |
| ActivityRequest | 같은 이름의 class와 ActivityRequestOptions: 불변 입력·식별자·gas·대기 설정 |
| BeneficiaryWallets | 같은 이름의 async interface: 파트너/회원별 signer 확보 |
| DeclaredMethodology | manifest/WASM/hash·registry·메타데이터·활성 조회·Evidence 생성 |
| DmrvnClient | preflight·Evidence/생성 복구·승인·준비·서명 기록·대납·활동 3가지 호출·제출 복구·operation·readResult |
| DmrvnConfig | 명시 options·fromDeployment·petTestnet·historicalDirectTestnet·deploymentId |
| DmrvnDeployment | manifest·고정 testnet/direct snapshot·주소/체인/code hash |
| DmrvnException | DmrvnError: code/retryable/action 및 명시적 전송 오류 사실 |
| DmrvnProtocol | provenance·domain/typedData/digest/structHash·recover·owner/location hash·submit/execute calldata |
| DmrvnReader | 기본 resolver·독립 결과 읽기·Evidence 출처 검증 |
| EvmRpc | 같은 이름의 async interface |
| EvmSigner | 같은 이름의 async interface |
| FileOperationJournal | POSIX 파일·OFD 잠금·fsync/원자 교체·claim 검색; 지원 환경 경계는 TS-36·37 |
| GreenfieldPublicReader | 공개 객체 bytes 읽기 |
| GreenfieldStorage | 같은 이름의 async interface: head/create/upload/read/원래 생성 거래 확인 |
| HttpEvmRpc | JSON-RPC 전송·id/응답 검증·크기/시간/취소 경계 |
| Json | DmrvnJson: parse/object/copy/bytes/hash/canonical; 소수는 DmrvnDecimal |
| NodeGreenfieldStorage | 별도 공식 SDK worker 기반 private 생성·업로드·읽기·생성 거래 확인 |
| OperationJournal | 같은 이름의 async interface: withLock/load/store/findOperationsByClaimId |

PrivyClient.listWalletsByAuthorizationKey는 TypeScript의 listWalletsByAuthorizationKey로 이름을 달리한다.
Java의 토큰 정책 with 메서드는 새 options 객체 구성으로, HTTP client 주입은 fetch 주입으로 대응한다.
PrivyClient.sdk()는 Java에서도 package-private이며 공개 API 누락으로 분류하지 않았다.
Java DmrvnClient의 deprecated approver/relay 분리 생성자는 서로 다른 주소를 거부하는 이행용 호출이다.
TypeScript의 단일 operator 생성자가 같은 기능을 제공하며, 별도 relay 지갑 기능이 Java에 존재한다고 해석하지 않았다.

## 내부 구현과 동봉 자료

| Java 내부 타입 | TypeScript 대응 |
| --- | --- |
| PrivyHttpTransport | internal/http: 제한된 HTTP 전송 |
| TransactionData | internal/transaction-data 및 evm-transaction: 응답 검증·불변 snapshot |
| Abi | DmrvnAbi |
| Chain | DmrvnChain |
| Crypto | DmrvnCrypto |
| MemoryOperationJournal | 공개 MemoryOperationJournal |
| ReportVerifier | internal/report-verifier, DmrvnReader에서 사용 |

Java main resources의 배포 JSON 2개와 ABI JSON 3개는 TypeScript 사본과 바이트가 일치한다.
PET manifest/publication JSON 2개는 Java 예제·시험용 자료이며 TypeScript 패키지에는 동봉하지 않았다.
SDK 본체가 이를 자동 로드하는 기능은 Java에도 없으며, TypeScript DeclaredMethodology도 호출자가 bytes와 registry를 제공한다.
Java의 실행용 진단/PET 예제·실환경 시험 CLI는 TypeScript 실행 예제로 이식하지 않았다.
이 자료의 과거 ACTIVE 표식을 현재 registry 승인으로 사용하지 않는다.
Greenfield worker는 동봉하지만 UTF-8 스트림 경계 수정이 있어 원본과 바이트가 다르다.
차이와 hash는 [worker 기록](greenfield-dependencies.md)에 있다.

## 보류하거나 결정해야 할 차이

- TS-08/D-04: generateAndLog, exportWalletPrivateKeyAndLog, ensureBackendWallet의 자동 출력/첫 지갑 선택과 fromEnvironment는 미구현·정책 미채택이다.
  비출력 키 생성·명시 설정·지갑 목록/등록·명시 export 경로는 구현돼 있다.
- TS-42: PrivyClient.config() 및 Java 설정 getter에 대응하는 런타임 설정 조회 API는 없다.
  호출자는 생성 options를 보유할 수 있지만, SDK가 정규화한 설정을 다시 읽는 Java 진단 호출은 제공하지 않는다.
  비밀 포함 조회 또는 비밀 제외 진단 snapshot 중 어떤 계약을 제공할지는 미결이다.
- C-12: 실제 provider·배포·저장소·validator 수용은 추후 결정이다. [승인 입력과 인수 순서](acceptance.md)를 따른다.

위 보류 및 API 표현 차이 외에 추가 핵심 업무 기능 누락은 이번 소스 대조에서 발견하지 못했다.
이 결론은 비교 기준 commit에 한정하며, Java 변경 또는 미결 정책 확정 시 다시 비교해야 한다.

## 검증 증거와 한계

- macOS ARM64 / Node 25.5.0에서 npm run check: 본체 253개 + 공식 worker 14개 = 267개, 실패/skip 0.
- npm run check:package: 실제 tarball 설치 후 DOM 없는 strict Node 타입 컴파일·ESM·ABI·native journal·JSON object 실행·동봉 문서 링크 검증 통과.
  두 새 overload도 이 소비자 타입 시험에 포함했다.
- 초기 오프라인 설치는 오래된 npm 캐시 메타데이터의 HPKE 전이 의존성 해석에서 ETARGET로 실패했고, 온라인 설치 검증은 통과했다.
- 각 구현 단위를 독립 리뷰하고 지적 사항이 없는 상태에서 커밋했다.
- 기존 Linux ARM64/Node22 검증은 이전 263개 시험 기준이다. 이번 추가 4개 시험을 Linux/Node22에서 다시 실행했다고 주장하지 않는다.
- 실제 서비스의 지갑 생성·개인키 export·거래 전송·비용 집행은 하지 않았다. Java 전체 입력 교차 실행이나 전체 오류 동등성의 증거로 해석하지 않는다.

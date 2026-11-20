# Recanet SDK 상세 공통 API 계약

[공통 Contract](recanet-sdk-contract.md)의 세부 명세다. Java를 기준으로 양쪽 언어에 동일하게 적용한다. 모든 정확한 public 시그니처·overload·상수·accessor는 [전체 대응표](api-map.md), 현재 구현 누락/차이는 [gaps](gaps.md)를 따른다. 아래 표의 여러 메서드 병기는 같은 규칙을 공유하는 경우에만 사용한다.

<a id="models"></a>
## 1. 값·타입·결과 비교

### 1.1 언어 바인딩

| 논리 타입 | Java | TypeScript | 동등성 조건 |
| --- | --- | --- | --- |
| 문자열/boolean | String/boolean | string/boolean | 값 동일. 임의 trim, Unicode normalization, case 변환 금지. 명시된 정규화만 수행 |
| nullable 값 | null/Optional.empty() | null, 선택 인자의 undefined | 부재 의미 동일. 응답에서 조건부로 빠지는 필드와 값이 null인 필드를 구분 |
| 임의 정수 | BigInteger | bigint | 정확한 정수 동일; JSON number로 축소 금지 |
| signed int64 | long/Long | bigint 또는 안전한 number 입력 | -2^63~2^63-1. 필드별 양수/상한 조건 추가 |
| signed int32 | int/Integer | number | 정수 -2^31~2^31-1. 필드별 범위 추가 |
| Duration | 초+나노초 정밀도 | `Duration`(bigint 나노초) 또는 legacy 밀리초 options | 같은 기간과 경계 비교. Duration은 signed-int64 초와 나노초를 보존하며 toMillis/toNanos overflow를 검사 |
| Instant | Instant | epoch 밀리초 bigint | JWT NumericDate가 생성하는 정확한 시각. Date 범위로 축소 금지 |
| bytes | byte[] | Uint8Array | 길이와 각 byte 동일 |
| JSON object/list | Map/List | plain object/array | key 순서와 무관한 값 동등성, 배열 순서 보존. hash/저장 시 JSON 절의 정확한 bytes 사용 |
| 함수/결과 | 동기 callback/반환/throw | callback/Promise/resolve/reject | 다음 단계 진행 전에 완료 대기. callback 호출 순서·인자·거부 시 부수 효과 동일 |

Java record 생성자/accessor는 같은 필드의 값 객체 생성/조회에 대응한다. 검증이 없는 Java DTO 생성자에 업무 검증을 임의 추가하지 않는다. 단, 명시된 compact 생성자 검증은 같은 논리 시점에 적용한다. TS interface만 존재해 검증이 다음 호출로 늦춰지면 차이 목록에 기록한다. equals/hashCode, enum values/valueOf, 표준 Throwable/Error 상속 유틸리티는 언어 바인딩이다. 비밀을 포함하는 값의 진단 문자열/직렬화는 secret을 마스킹해야 한다.

### 1.2 데이터 모델 전체 필드

| 모델 | 공통 필드/제약 |
| --- | --- |
| AuthenticatedUser | appId,userId,sessionId: string; issuedAt,expiresAt: 시각. 원본 JWT/secret 없음. TS 필드명 issuedAtMs/expiresAtMs |
| BackendWallet | id,address,chainType: string; publicKey: nullable string. 응답 메타데이터이며 publicKey를 authorization owner로 단정하지 않음 |
| BackendWalletCreateRequest | chainType 필수 nonblank; displayName/externalId nullable, blank는 null로 정규화. 1인자 생성은 나머지 null |
| BackendWalletKeyPair / BackendWalletRegistration | publicKey/privateKey 문자열. Registration은 nonnull/nonblank, 생성 시 곡선/키쌍 일치 검증 추가 없음. KeyPair record 자체는 별도 검증 없음 |
| UserWallet | userId,id,address,chainType. 회원 API의 chainType은 ethereum |
| EvmTypedData | domain: object; types: 이름별 [{name,type}]; primaryType: string; message: object. 별도 Privy 타입 노출 없음 |
| signer transaction | to/data: nullable string; value/gas/gasPrice/nonce: hex quantity string. from과 chainId는 signer가 지정 |
| EvidenceLocation | storageType=1, chainId: uint64 10진 문자열, bucketName/objectName: string |
| Greenfield Head | exists,sealed: boolean. exists=false를 권한 실패/조회 장애의 대체 결과로 쓰지 않음 |

나머지 EvmTransaction/Query/Page/Status, ActivityRequest, DmrvnConfig, 배포/승인/제출/결과 snapshot 필드는 각 절에 모두 정의한다. API가 반환하는 조건부 필드는 관찰된 사실이 있을 때만 추가한다. 아직 모르는 hash/receipt/location을 추측하지 않는다.

<a id="errors"></a>
## 2. 오류 모델과 기본 재시도 규칙

공통 오류 식별은 `(family, code)`다. Java Exception과 TS Error 클래스 이름/메시지 언어/stack은 같을 필요가 없다. code/status/retryAfter/명시적 전송 사실과 부수 효과는 같아야 한다. 모든 code 목록과 DMRVN retryable/action은 [공통 Contract 9절](recanet-sdk-contract.md#9-오류재시도)을 따른다.

| 논리 분류 | Java 기준 | TS에서 요구하는 의미 | 기본 처리 |
| --- | --- | --- | --- |
| 인자 누락 | NullPointerException | 인자 오류(TypeError 등), 업무 성공/인증 code로 변경 금지 | 호출 수정, 자동 요청 없음 |
| 잘못된 인자 | IllegalArgumentException | 인자 오류(TypeError/RangeError 등) | 호출 수정 |
| 설정/사전 상태 오류 | IllegalStateException | 설정/상태 오류; 회원 지갑 미발견을 UNAUTHORIZED_SIGNER로 바꾸지 않음 | 설정/사전 준비 수정 |
| Privy 인증 | PrivyAuthenticationException | PrivyAuthenticationError, 동일 code | 키 원천 장애는 토큰 위조와 구분 |
| Privy 서버 API | PrivyApiException | PrivyApiError, 동일 code/statusCode/retryAfter | GET만 호출자가 재조회 가능. POST 결과 불명은 조사 |
| TX 조회 | TransactionQueryException | TransactionQueryError, 동일 code | 조회 재실행; CHAIN_CHANGED는 cursor 폐기 |
| DMRVN | DmrvnException | DmrvnError, 동일 code/facts/retryable/action | action 우선, 불명 제출은 조사만 |
| 주입 callback 오류 | 원래 전파 또는 상위 API의 명시 변환 | 같은 경계에서 변환 | 단일 호출 envelope 외의 오류를 임의 삼키지 않음 |

오류 우선순위는 아래 각 API의 검증/실행 순서다. 둘 이상의 입력/외부 조건이 동시에 잘못되면 먼저 실행한 검사가 결과를 결정한다. 일반 서버 API wrapper는 공식 SDK APIException을 정리하지만 모든 unchecked 오류를 하나의 code로 감싸지는 않는다. 반대로 member 조회·signer·고수준 단일 호출 등 명시된 catch 경계에서는 정리한다. 오류 정리 경계 및 상태 코드도 공통 runner로 비교한다.

공통 재시도 프로필:

| 표기 | 규칙 |
| --- | --- |
| L | 로컬 계산/설정. 네트워크·서명·쓰기 없음. 같은 값 재평가 가능 |
| R | 읽기. 자동 재시도 없음. 호출자가 재조회 가능; 결과는 시점별로 달라질 수 있음 |
| W | 외부 생성/서명/전송. 자동 재시도 없음. 응답 유실이 부수 효과 미발생의 증거가 아님 |
| S | 단계별 동일 operation/입력으로 재개. 저장 상태/intent/서명을 먼저 검사하며 필요한 미완료 단계만 진행 |
| Q | 기존 생성/제출 조사만 수행. 새 거래를 보내지 않음 |

Privy HTTP: 401→INVALID_CREDENTIALS, 403→FORBIDDEN, 429→RATE_LIMITED, 5xx→UNAVAILABLE, 다른 API status/응답 오류→INVALID_RESPONSE. 응답 미수신 statusCode=0. Retry-After는 정수 초 또는 HTTP date를 해석한 선택적 Duration이며 TS bigint 밀리초로 손실 없이 대응한다. 4 MiB 응답 한도와 본문 수신까지 deadline, 중단 시 취소를 지킨다. 원문 응답/secret/token을 오류로 노출하지 않는다.

### 2.1 DMRVN 오류별 발생 조건

| code | Java 기준 발생 조건/의미 |
| --- | --- |
| INVALID_INPUT | ID/주소/uint/JSON/크기/gas/기간/경로 등 공통 형식·범위 거부 |
| EVIDENCE_CONTRACT_UNCONFIGURED | 신규 고수준/preflight에 명시 Evidence 버전 없음 |
| WRONG_CHAIN | 설정 체인과 RPC/storage/location/reader 결과 배포 불일치 |
| DEPLOYMENT_MISMATCH | 배포 검증 중 기대한 온체인 identity/code/domain/metadata 불일치의 분류. 공개 검증 경계에서 DEPLOYMENT_NOT_READY로 축약될 수 있음 |
| DEPLOYMENT_NOT_READY | manifest/배포 준비 검증 실패 또는 historical direct에 신규 쓰기 |
| UNAPPROVED_IMPLEMENTATION | 활성/저장 구현 주소·hash·버전이 승인 release와 맞지 않음 |
| DEPLOYMENT_COLLISION | 같은 claim/operation을 다른 deployment로 재사용하거나 호환 불가능한 배포 변경 |
| UNAUTHORIZED_SIGNER | 승인 역할/지갑 권한/파트너 정책 실패 또는 서명 API 401/403 |
| OPERATION_INPUT_CHANGED | 원래 operation의 body/config/fingerprint/복구 create hash 변경 |
| OPERATION_NOT_PREPARED | 필요한 operation/승인/upload/intent/Claim이 없음 |
| SUBMISSION_INPUT_CHANGED | mode/gas/forward/signature fingerprint 변경 또는 제출 Claim/receipt/transaction/event 결속 불일치 |
| SUBMISSION_UNRESOLVED | 전송 intent 이후 결과를 확인 못했거나 send/hash/저장 응답 불명 |
| STORAGE_ACCESS_DENIED | 저장소 키/권한/HTTP401·403 등 원본 접근 거부 |
| OBJECT_UNSEALED | 봉인 완료 확인 전 |
| STORAGE_UNAVAILABLE | 저장소/worker/전송 장애 또는 알 수 없는 worker 오류 |
| STORAGE_CREATE_UNRESOLVED | CreateObject intent/hash/수락 결과 불명, 안전한 새 생성 근거 없음 |
| STORAGE_ACCOUNT_UNFUNDED | 설정된 저장소 역할의 자금 부족 |
| STORAGE_MISMATCH | 실제 저장 bytes 또는 원래 CreateObject creator/객체 증거 불일치 |
| SIGNATURE_INVALID | 서명 형식/복구/서명자/provenance/Forwarder 검증 실패 |
| REQUEST_EXPIRED | Claim deadline이 현재 체인 timestamp보다 크지 않음 |
| NONCE_CONFLICT | Claim/Forwarder nonce 불일치, 다른 operation 예약 또는 Relay pending/latest nonce 불일치 |
| INSUFFICIENT_FUNDS | Relay 추정 비용 상한 초과 또는 pending 잔액 부족 |
| GAS_ESTIMATION_FAILED | HttpEvmRpc의 eth_estimateGas/eth_call JSON-RPC error |
| RPC_UNAVAILABLE | RPC 전송/응답/체인 조회 장애 또는 signer 경계 일반 실패 |
| REPORT_LOOKUP_RANGE | 보고 hash 없는데 검색 시작 블록 미제공 또는 허용 검색 범위 초과 |
| REPORT_TX_NOT_FOUND | 보고 event/거래/receipt를 확인 못함 |
| REPORT_READ_FAILED | 실제 보고서 bytes 다운로드 실패/null/4MiB 초과 |
| REPORT_MISMATCH | 보고서/assignment/committee/서명/outputs/source/외부 file hash 검증 불일치 |
| JOURNAL_UNAVAILABLE | 영속/잠금/snapshot 오류, claim 검색 미지원, 필수 lock 미소유 |
| INTERRUPTED | 해당 adapter/실행 경계의 중단·취소 |
| METHODOLOGY_UNAVAILABLE | 승인 manifest/WASM hash 불일치 또는 registry ACTIVE 아님 |

오류 code가 존재한다는 이유로 모든 API가 그 code를 그대로 전파하는 것은 아니다. 전송·배포·단일 호출·보고서 경계의 변환 순서는 각 절을 따른다. DmrvnException(code) 생성자는 facts=false이며 code()/definitelyNotBroadcast()/definitelyRejected()/retryable()/action()은 저장 code/facts와 공통 Contract 9절 정책을 반환한다. 다른 예외의 code/status/retryAfter accessor도 동일한 데이터 조회(L)다. enum 상수의 문자열은 변경하지 않는다.

<a id="auth"></a>
## 3. 설정·인증의 모든 호출

| Java / 공통 연산 | TS 바인딩 | 입력/기본값·처리 → 출력 | 오류 / 재시도 |
| --- | --- | --- | --- |
| PrivyClientConfig(appId,secret) | PrivyClientOptions | nonblank 자격; 기본 origin=https://api.privy.io, timeout=30s → 불변 설정 | null/인자 오류, L |
| PrivyClientConfig(appId,secret,baseUri,timeout) | options origin/timeoutMs | origin은 absolute HTTP(S), host 필수, userinfo/path/query/fragment 없음. HTTP loopback만. appId에 colon/공백/제어문자 없음. timeout>=1ms 및 int64 ms 표현 가능 | null/인자 오류, L |
| withTokenVerification(config) | 새 options.tokenVerification | nonnull 검증 설정을 넣은 새 불변 설정. 기존 값 변경 없음 | null, L |
| appId/appSecret/baseUri/requestTimeout/config | getter/설정 조회 | 설정된 정확한 값 반환. config는 정규화된 실행 설정. secret getter는 비밀 값이며 toString은 마스킹 | 양쪽 정규화 runtime 조회, L |
| usingJwks(uri) | {jwksUrl} | HTTPS 또는 loopback HTTP; host 필수, userinfo/fragment 금지. 경로/query 허용. 설정 생성 자체는 fetch 없음 | null/인자 오류, L |
| usingPublicKey(pem) | {publicKeyPem} | nonblank SPKI P-256 PEM. 실제 키 parse는 verifier 생성에서 수행 | 인자 오류, L |
| withClockSkew(duration) | clockSkewMs | 0~60s, 기본 0. 새 설정 반환 | null/인자 오류, L |
| withJwksPolicy(timeout,ttl,cooldown) | jwksPolicy | 기본 5s/300s/30s. 각 값>=1ms; ttl.toMillis>cooldown.toMillis; timeout.toMillis<=2^31-1. positive millis는 int64 내 표현 | null/인자 오류, L |
| clockSkew/jwksTimeout/cacheTtl/refreshCooldown | 정책 조회 | 설정에 적용된 기간 반환 | 양쪽 정책 조회, L |
| PrivyClient(config[,httpClient]) | new PrivyClient(options incl fetch) | 설정·transport·선택 verifier 구성. 외부 요청 없음 | null/잘못된 키 등 설정 오류, L |
| PrivyTokenVerifier(appId,config) | new PrivyTokenVerifier(appId,options) | nonblank appId, 신뢰된 key source. 고정 PEM을 parse하고 JWKS source는 lazy 구성 | null/인자 오류, L |
| verifyAppCredentials() | 동일 | GET /v1/users?limit=1 1회, 정상 목록 응답 검사 → void | Privy API, R |
| verifyAccessToken(rawJWT) | 동일 | 아래 순서 검증 → AuthenticatedUser | 인증 code, R(고정키는 L) |
| authenticateAuthorizationHeader(header) | 동일 | nonblank, 길이<=16416, case-insensitive `Bearer +([^ASCII-whitespace,]+)` 전체 일치, 앞뒤 trim 없음 → rawJWT 검증 | MISSING_TOKEN/INVALID_TOKEN 및 하위 인증 code, R |

JWT 검증 순서: null/blank→MISSING_TOKEN; 길이>16384→INVALID_TOKEN(길이 검사가 blank보다 먼저); compact parse; ES256/typ=JWT/미지원 crit 없음/kid<=256; NumericDate 검사; claim 거부 사전 검사; 신뢰 키 조회 및 서명 검사; 현재 시각으로 claim 재검사; 최소 사용자 결과 반환.

NumericDate iat/exp 및 있으면 nbf는 수치이며 정확한 비음수 정수 초, 초×1000이 signed int64 범위여야 한다. exp>iat, iat/nbf<=now+skew, exp>now-skew. issuer=privy.io; audience는 정확히 앱 하나(문자열 또는 단일 원소 배열); subject는 did:privy: 뒤 nonempty; sid nonblank; linked_accounts가 nonnull이면 거부한다. 사전 claim 검사는 신뢰된 인증 성공이 아니며 서명 후 재검사한다.

JWKS: 동시 최초/갱신 공유, unknown kid refresh, 30초 구간 최대 2회(기본 정책), 128 KiB 한도. secret/token을 키 조회에 보내지 않는다. 백그라운드 refresh/자동 retry/만료키 outage fallback 없음. claim 오류로 불필요한 JWKS 요청을 발생시키지 않는다. KEY_SOURCE_UNAVAILABLE와 INVALID_TOKEN/EXPIRED_TOKEN을 구분한다. JWT/JWKS는 Nimbus의 Base64/UTF-8 대체/중복 키/255단계 중첩과 NumericDate LONG_OR_DOUBLE 파싱을 따른다. decimal/exponent는 binary64 반올림 후 정수 및 날짜 범위를 검사한다.

<a id="adapters"></a>
<a id="wallet"></a>
## 4. 키·백엔드 지갑·회원 지갑의 모든 호출

| 연산 | 입력/출력 및 처리 순서 | 오류 / 재시도 |
| --- | --- | --- |
| BackendWalletKeyPair(publicKey,privateKey) | 값 보존 record. 생성은 별도 검증 없음 | L; 양쪽 생성 시 값 보존, 별도 검증 없음 |
| generate() | P-256 키쌍, SPKI public PEM/PKCS8 private PEM 반환; 로그 없음 | 생성 불가 상태 오류, W(로컬 난수 생성) |
| generateAndLog() | generate 후 public/private 키 명시 로그 → 같은 pair 반환 | W, 명시 호출에서만 키 로그 |
| registration() | 같은 public/private를 BackendWalletRegistration으로 변환 | Registration 인자 오류, L |
| BackendWalletRegistration(publicKey,privateKey) | nonnull/nonblank; 곡선·서로 일치 검증 추가 없음 | null/인자 오류, L |
| fromEnvironment() | BACKEND_WALLET_PUBLIC_KEY/PRIVATE_KEY 읽고 registration 생성. 로그 없음 | null/인자 오류, L |
| publicKey/privateKey | 정확한 저장 문자열 반환. 두 키 객체의 toString은 private key 마스킹 | L |
| BackendWalletCreateRequest(chainType[,displayName,externalId]) | nonblank chainType, 선택 blank는 null. 체인 지원 여부는 등록 시 판정 | null/인자 오류, L |
| registerBackendWallet(registration,request) | 지원 chainType 선택 → public key owner+선택 metadata로 POST /v1/wallets → 비밀 없는 BackendWallet. private key 전송 금지 | 인자/Privy API, W |
| isBackendWallet(walletId,registration) | nonblank ID → retrieve wallet → public_key 문자열 비교, 없음 false. owner 승인 판단에 사용 금지 | null/인자/Privy API, R |
| listWalletsByAuthorizationKey | nonblank key → authorization_key+limit100으로 전체 페이지 → 불변 목록. null/blank cursor 종료. 일반 목록은 반복 cursor/중복 wallet을 별도 거부하지 않는 Java 동작 유지 | 인자/Privy API, R |
| ensureBackendWallet(request) | verifyAppCredentials → 두 env key 모두 nonblank면 그 key 목록 첫 지갑(요청 chain 필터 추가 없음), 없으면 등록. 한쪽이라도 없으면 generateAndLog 후 등록 | 인자/API/키 생성 오류, W |
| exportWalletPrivateKey(walletId,registration) | nonblank ID/등록키 → authorization 서명 → HPKE 응답 복호화 → 실제 EVM private key. 로그/자동 저장 없음 | API; 중단 INTERRUPTED, 나머지 일반 오류 UNAVAILABLE, W |
| exportWalletPrivateKeyAndLog | 위 export 후 실제 EVM private key 로그 → 같은 값 | 위와 같음, W |
| UserWalletClient(client,registration,namespace) / client.userWallets | nonnull client/key; namespace=[a-zA-Z0-9_-]{1,64}. 지갑 생성/네트워크 없음 | null/인자, L |
| findWallet(userId) | nonblank ID → 고정 externalId → external_id+authorization_key+include_archived=false+limit100으로 전체 검색. 0개→부재; 1개→UserWallet; externalId/ethereum 불일치·중복·반복 cursor 거부 | null/인자/API. 일반 runtime은 UNAVAILABLE, status0로 정리. R |
| getOrCreateWallet(userId) | externalId 계산/조회 → 있으면 반환 → ethereum+externalId로 등록. 409면 같은 조건 재조회해 발견 시 반환, 없으면 원 오류. 생성 응답 externalId 재비교는 추가하지 않음 | find/register 오류, W; 유실 후 같은 ID 재조회 가능 |
| signerFor(userId) | findWallet → 없으면 상태 오류 → 승인키 목록 기반 signer 구성. 자동 생성/export 없음 | IllegalStateException 대응, API/signer 오류, R |
| signMessage(userId,message) | message nonnull → signerFor → EIP-191 메시지 서명 | null/상태/API/signer 오류, W |
| signTypedData(userId,data) | data nonnull → signerFor → EIP-712 서명 | null/상태/API/signer 오류, W |
| sendTransaction(userId,chainId,tx,key) | chain>0 → tx nonnull → key nonblank → signerFor → 정확한 완성 거래 전송. 자동 gas/nonce 조회 없음 | 인자/상태/API/signer 오류, W |
| forPartner(partnerId,authorization) | 양수 uint32/nonnull callback → partner scoped adapter. getOrCreateSigner는 requestedPartner 일치+정책 확인 → 회원 지갑 준비+signer 구성. 각 sign/send 직전에 정책 재확인 | 범위/누락, 정책 false→UNAUTHORIZED_SIGNER, callback 예외는 그 경계에서 전파. W/R |
| WalletAuthorization.isAuthorized / TS callback | (partnerId,userId) → boolean. TS async 완료까지 대기. 요청자 자격/tenant/동의 철회는 이 정책이 수행 | false는 wallet/sign 이전 중단 |

BeneficiaryWallets.getOrCreateSigner(partnerId,userId)는 주입된 파트너 통합 경계다. 자격·범위·동의/철회 확인 후 해당 회원 signer를 조회/생성하고, 반환 signer도 실제 서명/전송 직전 권한을 재확인해야 한다. userId만으로 권한을 승인하지 않는다. forPartner는 이 인터페이스의 Privy 기반 구현이며 다른 안전한 매핑 adapter도 같은 조건으로 주입할 수 있다.

고정 externalId는 공통 Contract 4절 공식을 정확히 사용한다. memberExternalId는 Java 내부 계산을 TS helper로 노출한 바인딩이다. 문자열 UTF-8 인코딩은 Java 기준이며 깨진 surrogate는 이 경로에서 `?` byte로 대체한다. JSON의 잘못된 Unicode 거부와 혼동하지 않는다. NUL을 포함한 ID를 임의 trim/정규화하지 않는다. namespace/partner 변경은 다른 지갑 집합을 선택한다.

<a id="signer"></a>
## 5. EVM signer

| 연산 | 입력/로직 → 출력 | 오류 / 재시도 |
| --- | --- | --- |
| PrivyEvmSigner(client,walletId,registration) / signerForWallet | authorization key 전체 목록 조회 → 정확한 walletId 선택 → ethereum 확인 → address 보존 → PKCS8 Base64/PEM authorization context 준비. 외부 지갑 public_key를 P-256 owner와 비교하지 않음 | 목록에서 없음/다른 체인 UNAUTHORIZED_SIGNER. 목록 일반 실패 RPC_UNAVAILABLE. key Base64 인자 오류는 catch 밖. R |
| address() / address property | 구성 시 확인한 주소 문자열, 자동 재조회 없음 | L |
| signMessage(message) | personal_sign, UTF-8 message → upstream signature string | 401/403 UNAUTHORIZED_SIGNER, interrupt INTERRUPTED, 나머지 RPC_UNAVAILABLE. W |
| signTypedData(data) | domain/types/primaryType/message를 공식 요청형식에 매핑 → upstream signature string | 위와 같음, W |
| sendTransaction(chainId,tx,key) | from=signer.address, chainId hex와 caip2=eip155:decimal, to/value/data/gasLimit/gasPrice/nonce 매핑 → upstream hash string | 위와 같음, W |

EvmSigner 인터페이스는 같은 연산을 주입하는 경계다. sendTransaction은 정확히 전달된 거래를 보내고 자동 재시도를 비활성화해야 한다. 직접 Privy signer는 회원 wrapper의 양수 chain/key nonblank/Quantity 문법 검사를 추가하지 않는다. 상위 Asset/DMRVN은 별도 검증한다. 서명/hash 문자열의 암호학적 유효성은 직접 signer 반환 시 새로 검증하지 않으며 DMRVN 등 상위 기능에서 확인한다. 기본 HTTP transport는 원래 idempotency key를 전송하며 승인 canonicalization도 같은 원문을 사용한다. Privy 숫자 wire는 Java 숫자 타입을 따라야 한다.

<a id="asset"></a>
## 6. AssetClient

두 생성자 URI/RPC는 같은 rpc 경계로 구성한다. 기본 자산 상수는 CHAIN_ID=421614, SYMBOL=ETH, DECIMALS=18이다. URI 생성은 HttpEvmRpc 규칙, rpc null은 인자 누락이다.

| 메서드 | 순서 → 출력 | 오류 / 재시도 |
| --- | --- | --- |
| getBalance(address) | 주소 hex 검사 → eth_chainId 확인 → eth_getBalance(address,latest) quantity parse → 정확한 wei | 인자, WRONG_CHAIN, RPC_UNAVAILABLE/주입 오류. R |
| transfer(signer,recipient,amountWei,key) | signer/주소 검사 → 양수 uint256 금액/nonblank key → chain 확인 → estimateGas({from,to,value,data:0x}) → gasPrice → pending nonce → gas/price 비영 검사 → 완성 tx 제출 → hash 형식 확인 | 사전 오류는 그대로; send 구간 runtime/잘못된 hash는 SUBMISSION_UNRESOLVED. W |

quantity는 `0x(0|[1-9a-fA-F][0-9a-fA-F]*)`, 256bit 이하를 사용한다. transfer의 gas margin 추가는 없다. 보낸 tx는 to,value,data=0x,gas,gasPrice,nonce의 hex quantity다. 반환 hash의 대소문자를 임의 변경하지 않는다(양쪽 형식 확인 후 원문 반환). 전송 key와 원래 요청 보존/nonce 직렬화는 호출자 책임이다. 반복 transfer는 gas/nonce 재조회 때문에 같은 body 재전송이 아니다.

<a id="transaction"></a>
## 7. EVM transaction 모델·조회·pagination

생성자 `(chainId,URI)`와 `(chainId,EvmRpc)`는 양수 signed int64 chain/RPC를 구성한다. query의 3인자 생성은 cursor=null, 4인자는 cursor 지정이다. query.withCursor는 from/to/limit을 보존한 새 값이다. limit/cursor 편의 overload는 fromBlock=0,toBlock=null로 같은 목록 API를 호출한다.

| 모델 | 전체 필드 |
| --- | --- |
| EvmTransactionQuery | fromBlock>=0; toBlock nullable 및 >=fromBlock; limit 1~100; cursor nullable, 있으면 nonblank/<=2048자 |
| EvmTransactionStatus | chainId,transactionHash,state,nullable blockNumber,confirmations |
| EvmTransaction | chainId,hash,from,nullable to,valueWei,nonce,input,gasLimit,nullable gasPriceWei/maxFeePerGasWei/maxPriorityFeePerGasWei,nullable blockNumber/blockHash/transactionIndex,status,transaction,nullable receipt |
| EvmTransactionPage | 불변 transactions, nullable nextCursor, 고정 범위 fromBlock/toBlock, scannedBlocks |

value/nonce/gas/fees는 unsigned 256bit quantity에서 정확한 정수로 변환한다. chainId/block/confirmations는 int64, transactionIndex는 int32다. raw transaction/receipt는 JSON snapshot으로 중첩까지 불변이며 로그/체인 추가 필드를 보존한다.

| 메서드 | 처리 순서 | 오류 / 재시도 |
| --- | --- | --- |
| getTransaction(hash) | hash 정규화 → chainId 확인 → eth_getTransactionByHash; null이면 부재. pending이면 블록/receipt 조회 없이 상세. mined이면 receipt/head/block 조회 → hash/height/index/from/to/receipt 결속 → 상세 | 인자; WRONG_CHAIN/INVALID_RESPONSE/CHAIN_CHANGED/RPC_UNAVAILABLE/INTERRUPTED. R |
| getTransactionStatus(hash) | getTransaction 결과 status, 부재면 NOT_FOUND/null block/0 confirmations | 같은 오류, R |
| listTransactions(address,query) | 주소/query/cursor 검증 → chain/head → 최초 upper/anchor 고정 또는 기존 anchor 확인 → 블록을 내림차순으로 최대100개 탐색 → 각 TX block/index/hash 검사 → from 일치 TX receipt/detail 수집 → limit 도달/100블록 종료 → anchor 재확인 → page | 인자/조회 오류, R. CHAIN_CHANGED이면 cursor 폐기 |

mined confirmations=head-block+1, pending/notfound=0. receipt 없거나 status 없으면 MINED, status 1/0은 SUCCEEDED/REVERTED, 다른 status는 INVALID_RESPONSE다. pending의 blockNumber/hash/index는 모두 null, mined는 모두 존재해야 한다. head<block 또는 block/receipt 재구성은 CHAIN_CHANGED, 단순 잘못된 필드 형식/내부 결속은 INVALID_RESPONSE로 구분한다. 주입 Dmrvn INVALID_INPUT→TX INVALID_RESPONSE, INTERRUPTED→TX INTERRUPTED, 다른 runtime→RPC_UNAVAILABLE이며 InterruptedException cause는 중단으로 처리한다.

cursor wire도 공통이다. 아래 ASCII 문자열을 padding 없는 base64url로 인코딩한다. chain/address/from/명시 to prefix가 같아야 하며 limit은 binding에 포함하지 않는다.

```text
1:<chainId>:<lowercaseAddress>:<fromBlock>:<toBlock-or-latest>:<snapshot>:<anchorHash>:<nextBlock>:<nextIndex>:<expectedHash>
```

필드는 정확히 10개다. snapshot>=from, from<=nextBlock<=snapshot, nextIndex>=-1, 명시 to는 snapshot과 같아야 한다. 해당 블록의 index 범위를 추가 확인한다. anchor는 최초 upper 블록 hash, expectedHash는 다음 탐색 블록 hash다. 블록 내 이어가기와 parentHash 연결을 보존한다. cursor는 서명/암호화된 권한 증명이 아니다. 정상 발급 bytes와 비정규 입력 수용도 Java parser를 기준으로 공통 runner에서 비교한다.

<a id="deployment"></a>
## 8. 배포·DMRVN 설정

| 연산 | 입력/로직 → 출력 | 오류 / 재시도 |
| --- | --- | --- |
| DmrvnDeployment.fromManifest(map) | 아래 규칙으로 raw/normalized manifest 복사·검증·정규화 → deployment | 모든 runtime 실패 DEPLOYMENT_NOT_READY. L |
| testnet / historicalDirectTestnet | 동봉 proxy/direct JSON을 fromManifest로 읽음. 최신 운영 상태 추정 없음 | DEPLOYMENT_NOT_READY, L |
| snapshot | 분리된 정규화 manifest 사본 | L |
| chainId/contractAddress/forwarderAddress/isProxy/runtimeCodeHash | 저장 메타데이터. runtime hash는 proxy면 codeHashes.proxy, direct면 contract | L |
| DmrvnConfig 전체 생성자 | 아래 전체 설정 검사·정규화 → 불변 config | INVALID_INPUT, 배포 연결 불일치 DEPLOYMENT_NOT_READY, L |
| deprecated 11인자 생성자 | deployment=historicalDirectTestnet 선택 후 같은 검증. 사용자 정의 배포 추측 금지 | 동일, TS 위치 인자 overload 제공 |
| fromDeployment(deployment,rpc,gfChain,bucket,prefix,partner,maxCost,confirmations) | chain/address/hash를 deployment에서 얻어 전체 생성자 호출 | 동일, L |
| petTestnet / historicalDirectTestnet(partner,prefix,maxCost) | 해당 deployment, Arbitrum Sepolia RPC, gf chain 5600, bucket dmrvn, confirmations=1 | 동일, L |
| deploymentId | decimal chainId + ':' + lowercase claimAddress. 구현 버전 미포함 | L |
| 전체 config accessor | 아래 필드를 반환; 불변 설정을 임의 변경하지 않음 | L |

Config 전체 필드: chainId(1~2^53-1), rpcUrl(HTTPS/loopback HTTP, host 필수·userinfo/fragment 없음), claimAddress/forwarderAddress(정규화 주소), claimRuntimeCodeHash(bytes32), greenfieldChainId(uint64 10진 문자열), bucketName(`[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]`), objectPrefix(nonblank·상대·끝 `/`·`..` 금지), partnerId(1~2^32-1), maxRelayCostWei(양수 임의 정수, uint256 상한 추가 없음), confirmations(1~2^31-1), deployment(nonnull, chain/주소/hash 일치).

objectName은 prefix로 시작하고 더 길어야 하며 Java UTF-8 1024 bytes 이하, `..`/ISO control 금지다. RPC URL은 Privy origin과 달리 경로/query를 허용하며 DMRVN scheme은 Java의 case-sensitive 검사다. 기본 transport는 원래 URI path를 전송하고 literal dot segment도 public reader에서 보존한다.

Manifest 정규화 필드: chainId,contractAddress,forwarderAddress,protocolVersion='7',domainVersion='7',forwarderDomainVersion='1',deploymentKind=proxy/direct,contractVersion(nullable),contractVersionSupported,codeHashes. proxy는 implementationAddress,proxyAdminAddress,owner,approvedImplementationHash,approvedReleases도 가진다. 선택 deployment map을 복사한다. raw proxy는 proxy/implementation/forwarder/proxyAdmin를 사용하고 raw direct는 contract/forwarder의 address/runtimeCodeHash/domainVersion을 사용한다.

배포 주소/hash는 zero 금지. proxy/forwarder/implementation/admin은 서로 달라야 한다. codeHashes는 proxy/implementation/forwarder/proxyAdmin 또는 direct의 contract/forwarder다. approvedImplementationHash는 implementation hash와 같다. approvedReleases에 현재 manifest 구현도 포함하고 같은 주소의 충돌 metadata를 거부한다. 지원 버전은 1.0.0/1.0.1/1.0.2이다. direct는 contractVersion/implementationAddress가 null이며 신규 쓰기 금지다.

<a id="methodology"></a>
## 9. 방법론

| 연산 | 입력/로직 → 출력 | 오류 / 재시도 |
| --- | --- | --- |
| DeclaredMethodology(manifestBytes,wasmBytes,expectedHash,registry) | 5인자와 동일하되 schema=3/explicit=false. 과거 호환 전용 | JSON/input/방법론 오류, L |
| 위 + evidenceSchemaVersion | manifest object parse → expected bytes32 → registry nonnull → schema 양수 int32 → manifest JCS hash/wasm Keccak 비교 → activity/id/version uint32 확인 | INVALID_INPUT/METHODOLOGY_UNAVAILABLE/registry null. L |
| hash/activityId/id/version | 검증된 manifest 메타데이터 반환 | malformed integer는 INVALID_INPUT, L |
| verifyActive | registry(activityId,id,version,hash) 호출. false면 거부; callback 일반 오류는 그대로 | METHODOLOGY_UNAVAILABLE 또는 callback 오류. R |
| evidenceBody(partner,beneficiary,event,inputs) | 공통 body 구성 → source ownerHash → 공통 key/metadata/event/inputs/object/1MiB 검증 → 복사된 body | INVALID_INPUT 및 JSON 오류, L |
| Registry.isActive | 같은 4개 인자로 현재 활성 여부 제공. 네트워크 원천은 adapter 책임 | R |

PET_HASH 상수는 Java 동봉 과거 패키지 hash다. Java 일반 생성자는 inputs의 profile/key/업무 수치 범위를 제한하지 않는다. TS 전용 petV3/validatePartner는 제거했다. schema4/방법론2003 version3은 일반 명시 생성자로 표현한다. 과거 Evidence bytes/hash는 보존한다.

<a id="json"></a>
## 10. JSON의 모든 연산

| Java / TS | 입력 → 출력 | 오류 / 재시도 |
| --- | --- | --- |
| Json.parse / DmrvnJson.parse | 유효 UTF-8 bytes → JSON 값. duplicate/trailing/literal -0/잘못된 Unicode 및 canonical 불가능한 값 거부 | INVALID_INPUT, L |
| object | parse와 같고 최상위 object만 허용 | INVALID_INPUT, L |
| canonical | 지원 JSON 값 → 공백 없는 정렬/숫자 규칙의 문자열 | INVALID_INPUT, L |
| bytes | canonical의 UTF-8 bytes | INVALID_INPUT, L |
| hash | bytes의 Keccak-256, lowercase 0x bytes32 | INVALID_INPUT, L |
| copy | object를 bytes→object 왕복해 분리된 사본 반환 | INVALID_INPUT, L. TS가 임의 값 copy를 추가 허용하는 것은 surface 차이 |

Java 정수 클래스(Byte/Short/Integer/Long/BigInteger)는 safe integer 절댓값 이하만 허용한다. Double/Float/BigDecimal은 유한 binary64로 JCS serialize한 값과 원래 decimal 값이 정확히 같아야 한다. 정수처럼 보이는 decimal도 원래 숫자 경로를 구분한다. key는 문자열이며 Java UTF-16 사전 순서다. 배열 순서를 보존하고 유효 surrogate pair만 허용한다. 문법상 Unicode escape/숫자 exponent/제어문자 escape도 기준 bytes와 같아야 한다. Json.parse는 Jackson의 1000단계 중첩 경계를 따른다. Float32/Float64 바인딩은 Java Float/Double 분류와 Java 17 숫자 문자열을 보존하고, DmrvnDecimal은 decimal 분류를 보존한다. 고정 벡터를 재작성하지 않는다.

TS DmrvnDecimal(source)/toJSON/toString 및 source는 BigDecimal 원문/숫자 경로를 보존하는 언어 바인딩이다. canonical bytes의 결과를 일반 JSON.stringify 결과로 대체하지 않는다. Java가 거부하는 소수를 number 반올림으로 수용하지 않는다.

<a id="protocol"></a>
## 11. DMRVN 암호·ABI 연산 전체

모두 로컬 계산(L)이며 네트워크/서명 요청/거래 제출을 하지 않는다. 입력 형식·폭·필수 필드 오류는 INVALID_INPUT, 서명 복구/검증 불일치는 SIGNATURE_INVALID다. 정확한 struct 필드/ABI는 [고정 리소스](../sdks/java/src/main/resources/dmrvn/)와 대응표를 함께 사용한다.

| 연산 | 입력 → 출력/알고리즘 |
| --- | --- |
| verifyProvenance(evidence,evidenceHash,storedApprover) | 전체 evidence hash 일치 → provenance 제거 body hash → EIP-191 'DMRVN v4 source:'+hash 복구 → provenance.signer 및 저장 approver 일치 → 복구 주소 |
| domain(chainId,contract,forwarder) | 양수 safe chain, 정규화 주소; false→DMRVNClaimContract/7, true→DMRVNForwarder/1 → name/version/chainId/verifyingContract |
| typedData(type,domain,message) | 지원 type 확인; EIP712Domain + 해당 type + ClaimRequest면 EvidenceLocation 포함 → domain/types/primaryType/message 복사 |
| structHash(type,message) | type description hash + 필드 순서 encode. string/bytes는 Keccak, struct는 재귀 structHash, 나머지는 ABI word → Keccak |
| digest(type,domain,message) | Keccak(0x1901 || domain structHash || message structHash) |
| recover(digest,signature) | secp256k1 서명 복구 → 정규화 주소. 65bytes, r/s 범위·low-s·허용 recovery v 검사 |
| ownerHash(beneficiary) | Keccak(UTF-8(lowercase 정규화 주소)) |
| evidenceLocationHash(location) | EvidenceLocation structHash |
| submitCalldata(approved) | approved.claimRequest/approvalSignature로 Claim submitClaim ABI encode |
| executeCalldata(request,signature) | ForwardRequest에서 nonce 제거, signature 추가 후 Forwarder execute tuple encode |

지원 type은 EvidenceLocation,ClaimRequest,TaskAssignment,MrvObservation,ForwardRequest,EIP712Domain이다. ClaimRequest/TaskAssignment/MrvObservation 필드·폭·순서는 아래 고정 리소스의 submitClaim/onReport와 동일해야 한다. 읽기 좋은 필드표는 이 문서 말미의 생성 ABI 부록에 있다. ForwardRequest는 from/address,to/address,value/uint256,gas/uint256,nonce/uint256,deadline/uint48,data/bytes 순서다. 같은 값의 digest/calldata/owner hash는 두 언어에서 byte 단위로 같아야 한다.

<a id="activity"></a>
## 12. ActivityRequest와 단일 호출

ActivityRequest의 3인자/전체 생성자와 모든 getter는 [공통 Contract의 전체 필드표](recanet-sdk-contract.md#73-단일-활동-제출)를 따른다. Java 전체 생성자는 gas/기간을 null로 받으면 기본값을 채우지 않고 실패한다. 3인자 생성자만 gas=900000,60s,1s를 채운다. TS options의 부분 생략은 해당 필드를 Java 기본값으로 명시한 전체 request에 대응한다. inputs는 구성 때와 getter마다 JSON copy다. objectName 경로 검사는 request가 아닌 제출 시 config와 함께 수행한다.

submitActivity(BeneficiaryWallets,request)는 호출마다 새 UUID를 만들고 claim/object 경로를 결정한다. null wallets/request는 envelope 밖 인자 누락이다. try 진입 후 config.object 검증 → 명시 schema 확인 → getOrCreateSigner → beneficiary 정규화 → evidenceBody → 아래 단계별 signer workflow → resolveSubmission 확인 대기다. timeout=0도 한 번 확인 조회를 수행한다. 자동 거래 재전송은 없고 대기 루프는 SUBMISSION_UNRESOLVED 조회만 반복한다.

반환/단계/조건부 필드는 공통 Contract 7.3절을 따른다. 내부 runtime→RPC_UNAVAILABLE, 인자 오류→INVALID_INPUT, 보안 오류→UNAUTHORIZED_SIGNER, DMRVN code는 유지한다. Privy API의 credentials/forbidden→UNAUTHORIZED_SIGNER, interrupt→INTERRUPTED, 나머지→RPC_UNAVAILABLE로 축약한다. stage=REQUEST_ACCEPTED의 RPC/interrupt 및 일부 Privy 불명 오류는 UNKNOWN이다. state가 있으면 submitFromBlock 존재 또는 createIntent 있고 upload 없음 여부로 불확실성을 판정한다. 확인된 SUBMISSION_CONFIRMED는 CONFIRMED가 우선한다. FAILED도 rollback이 아니다.

기본 60s는 receipt 확인 구간 한도다. confirmed의 식별자는 요청/생성한 값이고 위치·hash·봉인/receipt는 관찰한 경우만 넣는다. 선택 journal 실패가 관찰된 봉인 사실을 지우지 않게 메모리 observations를 보존한다. 별도 호출 간 sourceEventId 중복 방지/재개는 제공하지 않는다.

<a id="workflow"></a>
## 13. DmrvnClient의 전체 생성자·단계별 메서드

### 13.1 구성·사전 검사

`(config,rpc,operator,storage,methodology)`는 내부 memory journal을 사용한다. 마지막 journal을 받는 생성자는 소비자 adapter를 사용하며 null이면 memory다. 모든 핵심 인자는 nonnull, operator/storage 주소 형식과 storage.chainId=config.greenfieldChainId를 검사한다. deprecated `(config,rpc,approver,relay,storage,methodology,journal)`은 양쪽 주소가 같아야 하며 다르면 INVALID_INPUT이고 부수 효과 전에 거부한다.

preflight(): deployment/approverRole/methodology/evidenceContract/relayBalanceWei check를 순서대로 수행한다. DmrvnException은 해당 check={ok:false,code}, 성공은 {ok:true,value}; registry 일반 runtime 등은 이 catch 밖이다. ready는 map check들이 모두 ok인지로 판단하며 잔액이 0이어도 조회 성공이면 ok다. 반환 전체 필드는 deploymentId,ready,verifiedMetadata(nullable),approver,relay,storageSigner,checks다. checks에는 greenfieldWriteRead='NOT_TESTED',validatorReadAccess='OPERATOR_CONFIRMATION_REQUIRED'도 있다. R이며 쓰기·가스 충족 인수와 다르다.

### 13.2 단계별 입력·출력·오류·재개

공통 사전 조건: operationId는 [A-Za-z0-9:_-]{1,128}; claimId bytes32, beneficiary 정규화 주소, objectName/config·body/방법론 결속을 지킨다. 작업이 필요한 API는 journal 존재→deploymentId 일치→configurationFingerprint 일치→단계 존재 순으로 검사한다. 실패는 OPERATION_NOT_PREPARED/DEPLOYMENT_COLLISION/OPERATION_INPUT_CHANGED다. 원문 단계 snapshot의 최초 deployment와 서명은 덮어쓰지 않는다.

| 메서드 | 입력 → 출력 | 처리/부수 효과·오류 / 재시도 |
| --- | --- | --- |
| prepareEvidence(op,claim,beneficiary,object,body) | 입력 검증 → operation snapshot | operation lock→기존 deployment/fingerprint 검사→신규 배포 검증→전역 claim 예약→snapshot→source 예약→배포 재검증→이미 upload면 복사 반환. 아니면 role/ACTIVE→provenance 서명/복구 검증/전체 Evidence<=1MiB→location 저장→head→create intent 저장→한 번 create/hash 저장→upload→SEALED→실제 bytes 동일 확인→upload/phase 저장. 서명 SIGNATURE_INVALID, 충돌 NONCE_CONFLICT, 저장 오류 및 배포/방법론 오류. S |
| recoverCreateTransaction(op,hash) | void | createIntent/location 필요→matchesCreateTransaction→기존 hash 있으면 동일성→원래 hash 저장. 자동 upload/create 없음. STORAGE_MISMATCH/OPERATION_INPUT_CHANGED. Q |
| approveClaim(op) | Approved | upload 필수→배포 쓰기검증→기존 approved는 그대로 복사 반환. 신규면 role/provenance/ACTIVE/SEALED/bytes/body 확인→beneficiary lock·예약→claimRequest nonce/deadline 고정/저장→현재 nonce/deadline→서명·복구→approved 저장. 만료 REQUEST_EXPIRED, nonce NONCE_CONFLICT. S |
| prepare(op,claim,beneficiary,object,body) | Approved | prepareEvidence 후 approveClaim. Claim 거래 전송 없음. S |
| prepareSponsored(op,gas) | Sponsored | gas100000~2000000→approved/배포→SELF_PAID 충돌 거부. 기존 sponsored면 gas 정확히 같아야 함. 신규면 approver/provenance/Claim nonce/deadline→Forwarder nonce+Claim calldata+동일 deadline→sponsored/mode 저장. SUBMISSION_INPUT_CHANGED/만료/nonce/서명 오류. S |
| prepareSelfPaid(op) | SelfPaidTransaction | approved/배포→SPONSORED 충돌 거부→최초 현재 승인 검증→SELF_PAID+submitFromBlock+phase=BROADCAST_INTENT 저장→항상 같은 calldata. 직접 전송은 호출자 책임. S |
| recordSponsoredSignature(op,forward,signature) | RecordedSignature | approved/SPONSORED 필요→submit intent 있으면 SUBMISSION_UNRESOLVED→정확한 forward hash→배포/현재 승인→서명 복구/from/Forwarder nonce→정확한 요청+서명 fingerprint 저장. 같은 유효 서명의 다른 문자열도 교체 금지. S; 전송 없음 |
| submitSponsored(op,forward,signature) | Broadcast 또는 ConfirmedSubmission | mode/forward/fingerprint 검사→intent 이미 있으면 resolve만(Q), 못 찾으면 SUBMISSION_UNRESOLVED. 신규면 배포/현재 승인/복구/Forwarder nonce/verify→아래 relay 절차→정확히 한 번 send. S |
| resolveSubmission(op,nullable txHash) | ConfirmedSubmission | approved/submit intent 필요→배포 읽기검증→저장 hash/명시 hash 일치→confirmed head의 Claim/receipt/transaction/event를 아래 규칙으로 검증→상태/receipt 저장→beneficiary/Relay 예약 해제. 미확인 SUBMISSION_UNRESOLVED, 불일치 SUBMISSION_INPUT_CHANGED. Q |
| operation(op) | 분리된 전체 operation snapshot | 존재/config/deployment 기본 연결 확인 후 복사. 원문 서명 포함 가능. 배포 실측 재검증은 이 메서드가 수행하지 않음. L(영속 load는 읽기) |
| readResult(op,reader,fromBlock,reportTxHash,waitTimedOut) | Result | 배포 읽기검증→명시 또는 저장 reportTxHash로 독립 reader→deployment 일치→nonzero Claim이면 journal Evidence provenance 확인→result/metadata/있으면 reportTxHash 저장. provenanceVerified=true 및 최초 deployment 추가. reader 배포 오류면 ready=false/metadata 제거 기록. S/R |
| submitActivity(UserWalletClient,userId,op,claim,object,body,gas) | Broadcast 또는 ConfirmedSubmission | 기존 signerFor만 조회(생성 없음)→아래 명시 signer overload. 인자/회원 조회 오류 전파. S |
| submitActivity(EvmSigner,op,claim,object,body,gas) | Broadcast 또는 ConfirmedSubmission | signer/ID/gas/body 검사→activity workflow lock→prepareEvidence. submit intent 있으면 기존 mode/gas/sponsored만 사용, 없으면 approve/prepareSponsored. 기존 signature 있으면 재사용, 없으면 한 번 sign+record. 마지막 submitSponsored. S |

relay 신규 제출 순서: 현재 승인·사용자 서명·Forwarder.verify → 서명 저장 → relay lock/예약 충돌 → execute calldata → estimateGas×130/100 정수 내림 → gasPrice → cost<=maxRelayCostWei → pending 잔액>=cost → pending nonce=latest nonce → 완성 transaction → pending eth_call → Relay 예약 → submitFromBlock/relayTransaction/idempotency key/intent 저장 → sendTransaction → 유효 bytes32 hash 저장/BROADCAST. maxCost 초과도 INSUFFICIENT_FUNDS다. 별도 양수 gas/price 강화를 추가하지 않는다. send 또는 그 후 hash/저장 runtime 실패는 SUBMISSION_UNRESOLVED다.

relayIdempotencyKey=Keccak(UTF-8(deploymentId+':'+operationId+':'+submissionFingerprint)). submissionFingerprint=Json.hash({forwardRequest,userSignature}). 같은 operation에서 입력/서명/nonce/gas를 바꿔 재전송하지 않는다. 자동 replacement/fee bump/승인 갱신/예약 해제 기능은 없다.

확인 검증: 저장 Claim의 partner/activity/methodology/version/evidence/methodology hash, beneficiary, 승인 복구 주소=저장 approver, 전체 location/hash 및 provenance를 대조한다. hash 없으면 submitFromBlock~confirmed head의 MrvClaimRequested에서 nonce로 찾는다. 성공 receipt/tx hash·blockHash, Claim event의 claim/nonce/metadata, receipt/tx의 sender·target, 정확한 calldata, value=0을 확인한다. sponsored는 Forwarder ExecutedForwardRequest의 signer/nonce/success=true도 확인한다. Claim 상태 1~4만 확인 완료다. 현재 approver role을 과거 완료 Claim에 소급 검사하지 않는다.

### 13.3 반환 모델 전체

| 모델 | 필드 |
| --- | --- |
| Approved | claimRequest,approvalSignature,approvalDigest,deployment |
| ClaimRequest | claimId,beneficiary,partnerId,activityId,methodologyId,methodologyVersion,evidenceHash,methodologyHash,evidenceLocation,nonce(10진 문자열),deadline(체인 timestamp+900초 문자열) |
| Sponsored | forwardRequest,domain,types,primaryType='ForwardRequest',forwardDigest |
| SelfPaidTransaction | chainId,to=Claim,value='0'(10진),data. signer용 hex transaction과 표현을 혼동하지 않음 |
| RecordedSignature | forwardRequest,userSignature,forwardDigest,deployment |
| Broadcast | operationId,deploymentId,claimId,txHash,status='BROADCAST',recovered=false |
| ConfirmedSubmission | operationId,deploymentId,deployment,verifiedMetadata,claimId,txHash,receipt,claim,status='CONFIRMED',recovered=true |
| upload snapshot | evidenceHash,evidenceLocation,nullable createTxHash,status='SEALED' |

operation snapshot은 동적 진단/복구 자료다. 최초 필드는 operationId,deploymentId,deployment,fingerprint,configurationFingerprint,body,claimId,beneficiary,phase='PREPARING'이다. 진행에 따라 evidence,evidenceLocation,createIntent,createTxHash,objectExists,upload,claimRequest,approved,sponsored,submissionMode,forwardRequest,userSignature,forwardDigest,submissionFingerprint,relay,relayTransaction,relayIdempotencyKey,submitFromBlock,txHash,receipt,submissionStatus,chainStatus,result,reportTxHash,ready,verifiedMetadata,deploymentError,lastStorageError를 저장한다. 없던 사실을 null/default로 꾸며 넣지 않는다. 전체 키를 바꾸는 영속 포맷 이관은 별도 호환성 변경이다.

phase는 PREPARING→EVIDENCE_SIGNED→EVIDENCE_CREATE_BROADCAST→EVIDENCE_SEALED→APPROVED→BROADCAST_INTENT→SUBMITTED이며 제출 확인은 별도 submissionStatus=CONFIRMED다. 반환 lastConfirmedStage와 phase 문자열을 혼동하지 않는다. 배포 검증 실패 시 ready=false/verifiedMetadata 제거/deploymentError 저장, Evidence·승인·사용자 서명은 유지한다. 승인 upgrade는 최초 snapshot 구현도 approvedReleases에 남아 있어야 한다.

<a id="reader"></a>
## 14. 독립 결과 조회와 보고서 검증

| 연산 | 입력 → 출력/처리 | 오류 / 재시도 |
| --- | --- | --- |
| DmrvnReader(config,rpc,reportReader,resolver) | 설정/체인 reader 구성, reader/resolver nonnull | null/설정, L |
| defaultReportResolver(chainId,bucket) | resolve(hash)→{storageType:1,chainId,bucketName:bucket,objectName:'dmrvn/v4/reports/'+bytes32(hash)의 0x 제외+'.json'} | hash INVALID_INPUT, L |
| readResult(claimId,nullable fromBlock,nullable reportTxHash,waitTimedOut,nullable expectedFileHash) | confirmed head→배포→Claim→아래 Result. VALID/INVALID만 보고서 추가 검증 | chain/배포/입력 오류는 throw. 보고서 구간 오류는 reportError로 반환, R |
| verifyEvidenceProvenance(claimId,bytes) | confirmed head/배포/Claim 존재→bytes nonnull 및 <=1MiB→JSON object→저장 Evidence hash/approver 검증 → 복구 주소 | OPERATION_NOT_PREPARED/INVALID_INPUT/SIGNATURE_INVALID/배포·RPC, R |
| ReportReader.read(location) | 실제 object bytes | 어댑터 오류, R |
| ReportResolver.resolve(reportHash) | 실제 다운로드할 EvidenceLocation | 어댑터 오류, L/R |

Result 기본 필드: claimId,chainId,claimAddress,deploymentId,verifiedMetadata,observedBlock,chainStatus,taskStatus='UNKNOWN',claim,reportVerified=false,observationStatus. chainStatus NONE/PENDING/VALID/INVALID/REVOKED; PENDING의 observationStatus=WAITING 또는 waitTimedOut이면 LOCAL_WAIT_TIMEOUT, 나머지는 NOT_FINALIZED. VALID/INVALID는 FINALIZED로 바꾸고 보고서 검증을 시도한다. REVOKED를 임의 INVALID로 바꾸지 않는다.

reportTxHash 없으면 fromBlock 필수(REPORT_LOOKUP_RANGE); MrvClaimReported의 reportHash 결속으로 거래 검색; 미발견 REPORT_TX_NOT_FOUND. 성공 receipt/TX/event/onReport의 결속 및 실제 reader bytes<=4MiB를 확인한다. 다운로드 실패는 REPORT_READ_FAILED다. 검증 구간 DMRVN 오류는 reportError={code,retryable,action:'READ_ONLY'}, 다른 runtime은 REPORT_MISMATCH/retryable=false로 정리한다. 체인 관찰 자체는 유지한다.

보고서 검증은 assignment/observation claim/task 일치, committee 정렬·중복 없음, committeeSize/threshold, committeeHash, quorum/deadline, 저장 Claim의 method/evidence/location/output/result 일치, coordinator 서명 복구, threshold 이상 committee 소속 서로 다른 observation 서명, reportHash, report schemaVersion=1/claim/task/metadata/observations/source 결속을 확인한다. 현재 역할을 다시 조회해 과거 보고서를 거부하지 않는다. VALID의 outputs JCS hash는 nonzero outputHash와 같고 INVALID는 빈 outputs/zero outputHash다. 각 output은 정확히 value/unit/scale: value는 `-?(0|[1-9][0-9]*)` 문자열, unit nonblank, scale uint32다.

성공 추가 필드: reportVerified=true,reportHash,outputHash,fileHash,fileHashVerification,metadataIndependentlyVerified=false,authorizationEvidence='SUCCESSFUL_V7_RECEIPT',coordinator,signers,outputs,report,reportTxHash,reportPointer,receipt. expectedFileHash 없으면 DOWNLOAD_CHECKSUM_ONLY, 있으면 MATCHED_EXTERNAL_COMMITMENT이며 다운로드 checksum을 외부 원본 진위 보장으로 격상하지 않는다.

<a id="transport"></a>
## 15. JSON-RPC 전송

HttpEvmRpc(uri)는 기본 connect 10s/request 30s이며 `(uri,httpClient,timeout)`은 주입한다. DMRVN URI 규칙·양수 Duration·nonnull client가 필요하다. Java는 1ms 미만 양수 Duration도 생성 시 허용한다(toMillis 절삭 후 실행 deadline 적용).

EvmRpc.call(method,params)는 JSON-RPC result 값을 제공하는 공통 adapter다. HttpEvmRpc.call은 증가 id로 jsonrpc=2.0/id/method/params를 JSON bytes로 POST, Content-Type application/json, 응답<=4MiB와 deadline을 지킨다. HTTP200, object body, jsonrpc=2.0, 요청 id 문자열 표현 일치, result key 존재를 요구한다. result=null은 허용한다. error key가 있으면 method가 eth_estimateGas/eth_call일 때 GAS_ESTIMATION_FAILED, 아니면 RPC_UNAVAILABLE다. 구조/id/status 실패 RPC_UNAVAILABLE, 잘못된 JSON은 Json의 INVALID_INPUT, 중단 INTERRUPTED다. 자동 retry 없음(R/W는 실제 RPC method에 따름). 기본 전송의 connect는 TCP/TLS 연결 deadline이며 요청 deadline은 단조 시계로 처리한다. 큰 Duration은 Node int32 timer로 축소하지 않고 나누어 대기한다.

<a id="storage"></a>
## 16. Greenfield 저장소·공개 reader

| 연산 | 입력/출력·로직 | 오류 / 재시도 |
| --- | --- | --- |
| GreenfieldStorage.address/chainId | 구성된 signer 주소/uint64 network 문자열 | L |
| head(location) | 실제 객체 존재/봉인 여부 → Head | storage 오류, R |
| create(location,bytes) | private object 생성 1회 → 원래 CreateObject txHash | storage/funding/서명 오류. W; 모호한 유실에 자동 재생성 금지 |
| upload(location,bytes,createTxHash) | 기존 create hash 재사용 → void, 생성 금지 | storage 오류, S |
| read(location) | 실제 private object bytes; journal 사본 사용 금지 | storage 오류, R |
| matchesCreateTransaction(location,hash) | 해당 creator/object/성공 생성거래의 읽기 증거 → boolean | storage 오류, Q |
| NodeGreenfieldStorage(node,worker,rpc,chain,address,keyEnv,feeGranter,timeout) | node/worker absolute path, DMRVN URI, uint64 chain 정규화, 주소 정규화, nonnull keyEnv, 빈 granter는 없음, timeout.toMillis>0 | INVALID_INPUT/인자 오류, L |
| 위 adapter 각 메서드 | op=head/create/upload/read/verifyCreate로 별도 worker 실행. location chain 확인→env secret nonblank→JSON stdin/bytes base64→timeout·stdout6MiB 제한→protocol 응답 | chain WRONG_CHAIN, key 누락 STORAGE_ACCESS_DENIED, 중단 INTERRUPTED, 나머지 STORAGE_UNAVAILABLE 또는 worker code. 자동 retry 없음 |
| GreenfieldPublicReader(endpoint,chainId) | DMRVN URI+query 금지, 기본 connect10s/request30s. 구성 자체 read 없음 | INVALID_INPUT, L |
| public read(location) | chain 일치/storageType 문자열값1 확인→bucket/각 object segment를 Java URLEncoder 규칙으로 인코딩→GET→<=4MiB bytes | WRONG_CHAIN, HTTP401/403 STORAGE_ACCESS_DENIED, 기타 non200/통신 STORAGE_UNAVAILABLE, 중단 INTERRUPTED. R |

worker 환경은 GREENFIELD_STORAGE_PRIVATE_KEY만 전달하며 Privy 자격 증명은 제외한다. stderr는 원문 노출하지 않는다. worker 실패 code가 알려진 DMRVN code면 보존, 아니면 STORAGE_UNAVAILABLE다. definitelyNotBroadcast/definitelyRejected는 create 결과에서만 받아들인다. head는 exists/sealed의 true 여부, create는 createTxHash, read는 base64 bytes, verifyCreate는 matches의 true 여부를 반환한다. worker가 creator/payer/granter checksum 주소를 사용하고 chain/키의 주소 일치를 확인해야 한다. upload는 봉인 완료를 확인해야 한다. 실제 private 쓰기/validator 접근은 별도 인수 대상이다.

<a id="journal"></a>
## 17. journal의 모든 호출·예약

| 연산 | 공통 계약 | 오류 / 재시도 |
| --- | --- | --- |
| withLock(key,action) | 해당 작업의 병행 실행을 직렬화하고 완료 결과 반환. durable/shared adapter는 소유권 상실 후 write/side effect fencing 필요 | adapter/취소 오류, S |
| load(key) | 없으면 null, 있으면 분리된 JSON snapshot. 읽기 자체가 저장 값 변경 금지 | JOURNAL_UNAVAILABLE 등, R |
| store(key,snapshot) | 전체 snapshot 교체, 반환 전 영속화(durable). 키/secret/token 저장 금지 | JOURNAL_UNAVAILABLE 등, S |
| findOperationsByClaimId(claimId) | 전역 claim-id lock 아래 전체 배포·구버전 operation 검색. 미구현 default는 fail closed | JOURNAL_UNAVAILABLE, R |
| FileOperationJournal(directory) | 디렉터리 생성/real path/0700. 단일 호스트 POSIX 로컬 디스크 | JOURNAL_UNAVAILABLE, W(로컬 파일) |
| File.withLock | key Keccak 파일명, 프로세스 내 mutex+OS file lock, lock file0600. 같은 key 재진입 거부. callback 실패도 경계에 맞게 정리 | DMRVN 오류 유지, 나머지 JOURNAL_UNAVAILABLE, S |
| File.load/store/find | load JSON, store는 해당 lock 소유 필수·0600 temp→fsync→atomic replace→dir fsync; find는 claim lock 필수·index 없는 과거 operation 파일도 스캔 | JOURNAL_UNAVAILABLE; 잘못된 claim bytes32 INVALID_INPUT, R/S |

예약 key는 operation:<op>, activity:operation:<op>, claim-id:<claim>, source:<deploymentId>:<partner>:<activity>:<event>, claim-nonce:<deploymentId>:<beneficiary>, relay-nonce:<chain>:<operator>다. source/claim/nonce 예약을 원래 operation 외의 작업으로 덮어쓰지 않는다. 다른 배포의 claim은 DEPLOYMENT_COLLISION, 같은 배포의 다른 operation은 NONCE_CONFLICT다. claim/source 예약은 자동 해제하지 않고 beneficiary/relay 예약은 확인 성공 후 해당 operation 소유일 때 빈 snapshot으로 해제한다.

memory 구현은 프로세스 내 상태이며 재시작 복구/다중 호스트 보장을 하지 않는다. MemoryOperationJournal은 양쪽 SDK 내부 구현이다. File journal의 교차 snapshot 읽기/쓰기와 실제 Java·Node 6개 프로세스의 120회 병행 갱신 및 0700/0600 권한을 공통 runner에서 검증한다. NFS/분산 DB는 지원 대체물이 아니다.

<a id="extensions"></a>
## 18. TypeScript 추가 공개 API의 처리

정확한 전체 추가 멤버/시그니처는 [대응표](api-map.md) 및 api-map.json의 typescriptCoverage에 누락 없이 분류했다. 공통 업무 API는 Java 기준이며 추가 export를 자동으로 공통 기능으로 승인하지 않는다.

| 종류 | 대상과 규칙 |
| --- | --- |
| 언어 바인딩 | options/interface/union, Promise/AbortSignal, bigint/Decimal, Duration, Float32/Float64, client factory. 같은 값·검증·부수 효과를 제공한다. |
| 내부 경계 | DmrvnCrypto/Abi/Chain/Preflight/MemoryOperationJournal 및 internal helper는 root export/공개 선언에서 제외한다. |
| 업무 메서드 | Java 이름에 맞춘다. listWalletsByAuthorizationKey 및 bootstrap/config API를 제공하고 TS 전용 petV3/validatePartner는 제거한다. |
| 형식/진단 바인딩 | Error code/facts 및 toJSON/inspect는 공통 값과 비밀 마스킹을 보존한다. Json.copy는 Java처럼 object만 받는다. |

현재 공개 API는 전체 대응표와 `public-api-baseline.json`으로 검사한다. 기존 이관 API baseline은 역사 기록으로 유지한다.

### 18.1 내부 연산 참고

아래는 root export에서 제외한 내부 연산의 입력/출력·로직 참고다. 공통 public API로 노출하지 않는다. 순수 연산은 L, 체인/객체 조회는 R, journal은 해당 S/R 규칙을 따른다.

| TypeScript 연산 | 입력/출력·현재 로직·오류 |
| --- | --- |
| DmrvnCrypto.ZERO_BYTES32 | zero bytes32 상수 |
| hexBytes / hexString | even-length 0x hex↔bytes. hexBytes는 잘못된 형식 INVALID_INPUT |
| javaUtf8 / textHash / keccak | 문자열을 Java UTF-8 대체 규칙으로 bytes, textHash는 그 Keccak, keccak은 전달 bytes의 Keccak |
| normalizeAddress / bytes32 / uint / word | 공통 주소 정규화/bytes32 소문자/bit 폭의 unsigned decimal/uint256 32byte word. uint는 TS bigint 또는 safe 정수 또는 10진 문자열; 잘못된 값 INVALID_INPUT |
| recover / messageDigest | 위 protocol recover와 동일; messageDigest는 EIP-191 길이 prefix+UTF-8 메시지 hash. 서명 오류 SIGNATURE_INVALID |
| DmrvnAbi(definitions), CLAIM/FORWARDER/PROXY_ADMIN | AbiDefinition 배열 snapshot을 동결. 3개 상수는 고정 동봉 ABI. 필드는 name/type/inputs/outputs, AbiField는 name/type/components/indexed |
| definition/inputs/outputs(name) | 이름의 첫 정의/입력/출력 배열. 없으면 INVALID_INPUT |
| signature/topic(name) | 입력 필드의 ABI signature 문자열 / 그 Keccak topic. 기존 Java tuple[] signature 처리까지 기준 벡터 보존 |
| encode(name,values) | selector 앞4bytes+ABI tuple encode → hex calldata |
| decodeCall(name,data) | selector 일치→input decode→재인코딩 전체 일치 검사 → object. 불일치 INVALID_INPUT |
| decodeOutput(name,data) | 출력 정의로 decode → object. 전체 재인코딩 검사는 추가하지 않음 |
| decodeEvent(name,log) | topic0 및 indexed/nonindexed 필드를 ABI로 decode → object. 잘못된 topic/필드 INVALID_INPUT |
| encodeTuple(definitions,values) / decodeTuple(definitions,data) | 정의 순서대로 tuple hex encode/decode. uintN/address/bool/bytes1/bytes32/bytes/string/tuple/동적 배열 지원, 배열<=1024. offset은 int32 범위. 미지원 타입/범위/필드/bytes 오류 INVALID_INPUT |
| DmrvnChain(config,rpc), config | 설정/RPC 검증 후 불변 체인 helper. 잘못된 구성 TypeError |
| Chain.call(method,params,signal) | 이미 중단이면 INTERRUPTED, 아니면 rpc.call 결과. 새 재시도 없음 |
| Chain.quantity/number | bigint→0x quantity, 0x nonempty hex 문자열→bigint. DMRVN Chain.number는 TX strict quantity와 달리 선행0도 허용; 잘못된 응답 RPC_UNAVAILABLE |
| head/confirmedHead/block/timestamp | eth_blockNumber→int64 head, max(0,head-confirmations+1), 지정 블록 object, latest block timestamp → bigint. 조회/응답 오류 전파 |
| contract(abi,address,fn,args,tag)/view(fn,args) | ABI calldata로 eth_call 후 output decode; view는 Claim/latest에 대한 단일 값 |
| nonce(address,forwarder) / claim(id,block) | Claim 또는 Forwarder nonce, 지정 블록의 Claim struct. nonce bigint/claim object |
| verifyApprover(address) | hasRole 승인자 역할 확인 → void, 실패 UNAUTHORIZED_SIGNER. 실제 role 이름/상수 계산은 동봉 ABI/기준 소스 사용 |
| receipt(hash,head) | receipt 없거나 아직 head 초과면 null; chain block hash 일치 확인 후 receipt. 불일치 SUBMISSION_UNRESOLVED |
| event(name,receipt,claimId) | Claim 주소/topic/claimId 첫 일치 로그 decode, 없으면 null |
| findTransaction(event,id,from,to,field,expected) | 0<=from<=to, to-from<=100000; 1000블록 창의 eth_getLogs를 순서대로 탐색, removed 거부, event 필드 결속 → hash 또는 null. 범위 REPORT_LOOKUP_RANGE/잘못된 응답 RPC_UNAVAILABLE |
| verifyDeployment(height?) | height 또는 head에 block 고정→chain→code hashes→ERC1967 slots→approved release→version/owner→두 domain/trustedForwarder→block hash 재확인 → manifest+verified=true/observedBlock/observedBlockHash/실측 codeHashes. UNAPPROVED_IMPLEMENTATION은 유지, 나머지 오류 DEPLOYMENT_NOT_READY |
| IMPLEMENTATION_SLOT / ADMIN_SLOT | ERC1967 구현/admin storage slot 고정 bytes32 |
| DmrvnPreflight(config,rpc,operator,storageIdentity,methodology).run | Client.preflight와 동일 읽기 checks/ready/result. GreenfieldIdentity는 address/chainId만 필요한 바인딩 |
| MemoryOperationJournal.new/withLock/load/store/findOperationsByClaimId | 프로세스 내 단일 monitor, nested scope queue, 분리 snapshot. store는 대기 전 snapshot을 잡고 claim 검색은 operation: key와 claimId 일치 항목. 디스크 쓰기/재시작 복구 없음 |
| Deployment.requireWritable/release/assertCompatible | proxy만 쓰기 허용; 승인 주소의 release 사본 또는 null; 저장 deployment의 chain/address/forwarder/protocol/kind 일치와 저장 구현 승인 여부 검사. DEPLOYMENT_NOT_READY/DEPLOYMENT_COLLISION/UNAPPROVED_IMPLEMENTATION |
| Config.checkObject(name) | 위 설정 절의 전체 objectName 검증 → void 또는 INVALID_INPUT |
| Methodology.requireExplicitEvidenceVersion/validate(body,partner,beneficiary) | explicit 여부/위 공통 body 규칙 검사. EVIDENCE_CONTRACT_UNCONFIGURED/INVALID_INPUT |
| 과거 Methodology.petV3 / validatePartner | 제거됨. 일반 명시 schema 생성자로 같은 Evidence를 표현하고 추가 partner/input 제약을 적용하지 않는다. |
| Protocol.encodeType/typeHash | 지원 struct의 description(ClaimRequest는 EvidenceLocation 부속 description 포함)/Keccak 반환 |
| Protocol.sortedAddresses | 정규화·정렬, nonempty/중복 없음. REPORT_MISMATCH |
| Protocol.committeeHash(assignment,committee) | taskId/claimId/quorumPolicyVersion/committeeSize/threshold/deadline/committee를 ABI encode한 Keccak |
| Protocol.reportHash(assignment,observation,signers,domain) | taskId/claimId/committeeHash/observation digest/정렬 signer 배열을 ABI encode한 Keccak |
| Error public 생성자(code[,status/retryAfter/facts]) 및 code/statusCode/retryAfterMs/facts | 해당 오류 데이터를 저장. facts는 true인 명시 값만 반영. Java에서 외부 생성자가 비공개인 오류도 있으므로 public surface 차이 |
| Registration.toJSON | publicKey와 privateKey='[REDACTED]' 반환. 원래 privateKey getter와 구분 |
| DmrvnJson/Protocol의 TS implicit new | TS 정적 유틸리티 class는 기본 생성자를 공개하지만 Java 유틸리티 생성자는 private. 업무 연산은 없으며 surface 차이로 추적 |

## 19. 생성 ABI 필드 부록

아래 표는 Java 동봉 ABI에서 추출한 필드 순서다. 같은 이름이라도 폭/순서를 바꾸지 않는다. `EvidenceLocation`은 submitClaim의 nested tuple이다.

### EvidenceLocation

| 순서 | 이름 | ABI type |
| --- | --- | --- |
| 1 | storageType | uint8 |
| 2 | chainId | uint64 |
| 3 | bucketName | string |
| 4 | objectName | string |

### ClaimRequest

| 순서 | 이름 | ABI type |
| --- | --- | --- |
| 1 | claimId | bytes32 |
| 2 | beneficiary | address |
| 3 | partnerId | uint32 |
| 4 | activityId | uint32 |
| 5 | methodologyId | uint32 |
| 6 | methodologyVersion | uint32 |
| 7 | evidenceHash | bytes32 |
| 8 | methodologyHash | bytes32 |
| 9 | evidenceLocation | EvidenceLocation |
| 10 | nonce | uint256 |
| 11 | deadline | uint64 |

### TaskAssignment

| 순서 | 이름 | ABI type |
| --- | --- | --- |
| 1 | taskId | bytes32 |
| 2 | claimId | bytes32 |
| 3 | committeeHash | bytes32 |
| 4 | quorumPolicyVersion | uint32 |
| 5 | committeeSize | uint8 |
| 6 | threshold | uint8 |
| 7 | deadline | uint64 |

### MrvObservation

| 순서 | 이름 | ABI type |
| --- | --- | --- |
| 1 | taskId | bytes32 |
| 2 | claimId | bytes32 |
| 3 | evidenceHash | bytes32 |
| 4 | partnerId | uint32 |
| 5 | activityId | uint32 |
| 6 | methodologyId | uint32 |
| 7 | methodologyVersion | uint32 |
| 8 | methodologyHash | bytes32 |
| 9 | evidenceLocationHash | bytes32 |
| 10 | result | uint8 |
| 11 | outputHash | bytes32 |
| 12 | committeeHash | bytes32 |
| 13 | quorumPolicyVersion | uint32 |
| 14 | deadline | uint64 |

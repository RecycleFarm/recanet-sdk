# Recanet SDK 공통 Contract

## 1. 기준과 적용 범위

| 항목 | 값 |
| --- | --- |
| 문서 버전 | 3, Java 기준 언어 중립 공통 계약 |
| 작성일 | 2026-11-17 KST |
| 기준 revision | `06a9a560054b1154ce096839da3bfe9c6d7a67ff` |
| 기준 구현 | [`sdks/java`](../sdks/java), 이관된 recanet-java 및 rc.1 변경 |
| Java 좌표 | `com.youngminkim.recanet:recanet-java:0.1.0-rc.1` |
| 공개 경계 | `com.youngminkim.recanet`, `com.youngminkim.recanet.dmrvn`의 public 타입·메서드 |
| 실행 환경 | JDK 17; rc.1 배포 후보 검증 범위는 Linux x64·Node 22 |

이 계약은 Java를 기준 동작으로 삼아 Java·TypeScript가 동일하게 제공해야 하는 기능·입력·출력·처리 순서·오류·부수 효과·재시도 규칙을 정의한다. 모든 규칙은 양쪽 구현에 적용한다. 현재 구현이 다르다는 이유로 언어별 예외를 허용하지 않는다. 문서 버전은 패키지/Claim/Evidence 버전과 별개다.

문서 구성과 적용 순서는 다음과 같다.

1. **이 문서**: 전체 기능과 공통 불변 조건.
2. **[상세 API 계약](api-reference.md)**: 생성자·기본값·모델·모든 업무 메서드의 입력/출력/검증/오류/재시도. 같은 항목의 세부 규칙은 이 파일을 우선한다.
3. **[전체 메서드 대응표](api-map.md)** 및 **[기계 판독 대응표](api-map.json)**: Java의 모든 공개 선언/overload/상수/accessor와 TypeScript 공개 진입점의 모든 타입/멤버/시그니처를 연결한다.
4. **[불일치 해소와 준수 조건](gaps.md)**: GAP-01~12의 수정 및 공통 검증 근거. 구현 차이를 공통 계약의 예외로 해석하지 않는다.

`mapped`는 API 연결을 뜻하며 동작 준수 판정이 아니다. SDK 변경 없이 이 문서를 작성하는 것만으로 두 구현의 동등성이 달성되지는 않는다. 표준 오류 코드가 없는 Java 인자/설정/상태 오류도 상세 API 계약에서 언어 중립 분류로 대응한다. 이를 새로운 SDK 오류 코드가 이미 구현됐다는 뜻으로 해석하지 않는다.

Java 동기 반환/예외와 TypeScript Promise resolve/reject는 같은 논리 결과로 취급한다. getter/readonly property, 생성자/options/factory는 동일한 값을 표현할 수 있다. 시간·정수는 손실 없이 대응해야 하며 표현 범위·검증 시점의 차이는 불일치다. 내부 알고리즘/스레드 방식과 Object/record의 equals/hashCode/일반 문자열 포맷은 언어별 표현이지만, secret 마스킹·값·오류 분류·외부 요청·저장 bytes·서명 digest·부수 효과와 그 순서는 공통이다.

동등성은 같은 입력, 설정, 시간, 난수/식별자 공급, 외부 응답 및 권한/취소 조건에서 비교한다. 난수 키나 UUID를 독립 생성한 두 실행의 문자열까지 같아야 한다는 뜻은 아니다. 고정된 원본·키·서명 방식·도메인은 같은 bytes/digest를 만들어야 하며, 확률적 서명은 같은 digest와 복구 주소 및 인코딩 규칙을 충족해야 한다.

정확한 시그니처는 [전체 대응표](api-map.md)에 동결한다. [기존 API baseline](../docs/migration/phase2-public-api-baseline.json)은 이전 이관 보존 검사이며 이 공통 계약의 conformance 판정과 별개다. [현재 API baseline](public-api-baseline.json)은 이번 업무 메서드 정렬을 반영하며, 과거 이관 baseline은 수정하지 않는다. `make contract-test`가 같은 입력·외부 응답으로 양쪽 구현의 결과/오류/호출 기록을 비교한다. 업무 메서드는 Java 이름을 사용하고 getter/property·생성자/options·동기/Promise만 언어 바인딩으로 허용한다. HTTP endpoint/OpenAPI 및 로그인/OTP/refresh flow는 양쪽 공통 SDK 범위에 없다.

## 2. 공통 데이터·권한

| ID | 계약 |
| --- | --- |
| CORE-01 | Privy walletId, 서비스 userId, 블록체인 address/txHash, DMRVN claimId는 서로 다른 식별자다. 주소/해시에 Privy ID를 넣지 않는다. |
| CORE-02 | EVM 주소는 `0x` + 40 hex 문자, bytes32/거래 hash는 `0x` + 64 hex 문자다. 반환 정규화는 API별 구현을 따르며 모든 API가 EIP-55를 검사한다고 가정하지 않는다. |
| CORE-03 | 금액은 정수 wei이며 BigInteger를 부동소수점으로 바꾸지 않는다. signer transaction의 value/gas/gasPrice/nonce는 hex quantity 문자열이다. DMRVN typed data는 생성 API의 문자열 표현을 유지한다. |
| CORE-04 | app ID/secret은 서버 API 인증, access JWT는 요청자 인증, P-256 authorization key는 wallet 작업 승인에 사용한다. authorization private key와 EVM wallet private key는 별개다. |
| CORE-05 | 회원 ID/external ID는 자격 증명이 아니다. 서비스가 partner/tenant/회원의 접근·동의/철회를 확인해야 한다. 지갑 키 소유 확인은 서비스 접근 제어를 대신하지 않는다. |
| CORE-06 | 거래 hash는 제출 결과다. receipt 성공·DMRVN 최종 결과·합의 최종성/L1 확정을 구분한다. 결과 미확인을 미전송 증거로 사용하지 않는다. |

DMRVN 주소 정규화는 혼합 대소문자 입력의 EIP-55 checksum을 확인하고 소문자 주소를 반환한다. 전체 소문자/대문자 hex 주소도 허용한다. bytes32는 소문자로 정규화한다. AssetClient의 주소 검사는 hex 형식만 확인한다. DMRVN uint 문자열은 부호·선행 0 없는 10진수(`0` 포함)이며 각 필드의 bit 폭을 지켜야 한다.

## 3. 인증

근거: [PrivyClient](../sdks/java/src/main/java/com/youngminkim/recanet/PrivyClient.java), [PrivyTokenVerifier](../sdks/java/src/main/java/com/youngminkim/recanet/PrivyTokenVerifier.java), [검증키 설정](../sdks/java/src/main/java/com/youngminkim/recanet/PrivyTokenVerificationConfig.java).

| ID / API | 입력·반환·부수 효과 |
| --- | --- |
| AUTH-01 `PrivyClient(config)` | app ID/secret 필수. 기본 API origin은 `https://api.privy.io`, timeout은 30초. origin에는 경로/query/fragment/userinfo를 허용하지 않고 HTTP는 loopback만 허용한다. 생성 시 API 호출은 없다. |
| AUTH-02 `verifyAppCredentials()` | 읽기 전용 사용자 목록 요청을 한 번 수행한다. 사용자 조회 권한이 필요하다. 사용자/지갑을 생성하지 않고 매 요청 자동 실행하지 않는다. |
| AUTH-03 `verifyAccessToken(token)` | raw access JWT를 검증하고 app/user/session ID, issuedAt/expiresAt을 가진 AuthenticatedUser를 반환한다. client에 token verification 설정이 없으면 IllegalStateException이다. |
| AUTH-04 `authenticateAuthorizationHeader(header)` | Bearer 헤더의 access JWT를 검증한다. 누락/잘못된 형식을 인증 오류로 구분한다. |
| AUTH-05 `PrivyTokenVerifier` | app ID와 검증키 설정만으로 검증 가능하며 app secret이 필요하지 않다. |

검증은 ES256/P-256, typ=JWT, iss=privy.io, 앱과 일치하는 aud, sub=did:privy:..., nonblank sid, 필수 iat/exp 및 존재하는 nbf를 확인한다. 만료·미래 발급·잘못된 날짜·identity token·unsigned/HMAC token은 거부한다. clock skew는 기본 0, 설정 상한 1분이다.

키는 설정한 JWKS URL 또는 P-256 공개키 PEM에서 가져온다. JWT가 지정한 임의 URL을 신뢰하지 않는다. JWKS 기본값은 TTL 5분, 30초 구간 최대 2회 조회, connect/read timeout 각각 5초, 응답 128 KiB다. 동시 최초/갱신 조회를 공유하고 unknown kid 재조회를 제한한다. 만료 키를 장애 fallback으로 사용하지 않는다. 공개키 직접 설정은 네트워크 조회가 없으며 교체 시 설정 갱신이 필요하다.

인증 성공 결과/token을 캐시하지 않고 매 요청 만료를 확인한다. 로컬 JWT 검증은 실시간 logout/revocation·사용자 삭제를 조회하지 않는다.

## 4. 지갑·서명

근거: [PrivyClient](../sdks/java/src/main/java/com/youngminkim/recanet/PrivyClient.java), [UserWalletClient](../sdks/java/src/main/java/com/youngminkim/recanet/UserWalletClient.java), [PrivyEvmSigner](../sdks/java/src/main/java/com/youngminkim/recanet/PrivyEvmSigner.java).

| ID / API | 계약 |
| --- | --- |
| WALLET-01 `BackendWalletKeyPair.generate()` | P-256 키쌍 생성. registration()으로 등록 설정을 만든다. private key는 호출자가 안전하게 영속 보관해야 한다. |
| WALLET-02 `registerBackendWallet(registration,request)` | public key를 owner로 등록하고 BackendWallet(id,address,publicKey,chainType)을 반환한다. private key는 등록 요청에 보내지 않는다. request는 chainType과 선택적 displayName/externalId를 받는다. |
| WALLET-03 `listWalletsByAuthorizationKey(key)` | authorization key 필터로 전체 페이지를 조회한다. signer는 이 목록에서 정확한 wallet ID와 ethereum chain type을 확인한다. |
| WALLET-04 `isBackendWallet(id,registration)` | 현재 구현은 retrieve 응답의 wallet.publicKey와 registration public key의 문자열 일치를 반환한다. authorization owner 검증과 같은 보장으로 해석하지 않는다. signer는 WALLET-03을 사용한다. |
| WALLET-05 `ensureBackendWallet(request)` | 서버 자격 증명을 먼저 확인한다. 환경의 두 backend 키가 모두 있으면 조회한 첫 지갑을 재사용하거나 생성한다. 두 키가 모두 준비되지 않으면 generateAndLog()로 새 키를 생성·로그 출력하고 등록한다. secret 자동 영속 보관은 없다. |
| WALLET-06 `exportWalletPrivateKey` | authorization 서명으로 실제 blockchain wallet private key를 반환한다. 일반 메서드는 로그 출력하지 않는다. exportWalletPrivateKeyAndLog()는 실제 키를 로그 출력한다. |
| WALLET-07 `getOrCreateWallet(userId)` | 기존 ethereum 회원 지갑을 조회/생성한다. external ID 충돌 HTTP 409는 재조회한다. 모호한 네트워크 실패에 생성 요청을 자동 재전송하지 않는다. |
| WALLET-08 `findWallet(userId)` | external ID와 authorization key로 조회하고 archived 지갑은 제외한다. 미발견은 Optional.empty(). 비정상 중복/응답을 빈 결과로 숨기지 않는다. |
| WALLET-09 `signMessage`, `signTypedData`, `signerFor` | 기존 지갑만 사용한다. 없으면 IllegalStateException이며 자동 생성하지 않는다. signer는 EIP-191/EIP-712 서명과 거래 제출을 제공한다. |
| WALLET-10 `sendTransaction(userId,chainId,tx,key)` | 양수 chainId, 완성된 transaction, nonblank key가 필요하다. 자동 재시도하지 않는다. 본문/key를 함께 보존하고 같은 지갑의 nonce 사용을 직렬화해야 한다. |

namespace는 `[a-zA-Z0-9_-]{1,64}`, userId는 nonblank다. 아래 해시 입력은 UTF-8이며 `\0`는 NUL 한 문자다. base64url은 padding 없는 URL-safe 인코딩이다.

```text
일반 externalId = "user_" + base64url(SHA-256(namespace + "\0" + userId))
파트너 externalId = "partner_" + base64url(SHA-256(namespace + "\0" + decimal(partnerId) + "\0" + userId))
```

WALLET-11: forPartner(partnerId,authorization)의 partnerId는 양수 uint32다. 요청 partner가 다르거나 정책이 거부하면 조회 전에 중단한다. 지갑 준비 시와 각 서명/전송 직전에 정책을 재확인한다. 일반 매핑 지갑을 파트너 지갑으로 자동 채택하지 않는다. 이 매핑은 Java 어댑터의 선택이며 외부 공유 명세의 확정 표준이 아니다.

generateAndLog(), exportWalletPrivateKeyAndLog(), 키가 미설정된 ensureBackendWallet()은 비밀을 로그에 내보내는 bootstrap 경로다. SDK가 모든 경로에서 키 로그를 금지한다는 보장은 없다.

## 5. 네이티브 자산

근거: [AssetClient](../sdks/java/src/main/java/com/youngminkim/recanet/AssetClient.java).

| ID / API | 계약 |
| --- | --- |
| ASSET-01 `getBalance(address)` | chainId=421614 확인 후 latest 잔액을 BigInteger wei로 반환한다. 지원 자산은 Arbitrum Sepolia 네이티브 ETH, decimals=18이다. |
| ASSET-02 `transfer(signer,recipient,amountWei,key)` | 주소, `0 < amountWei <= 2^256-1`, nonblank key를 검사한다. estimateGas/gasPrice/pending nonce를 조회해 제출한다. 가스비는 송신 지갑에서 차감된다. |
| ASSET-03 제출 불명 | signer 제출의 RuntimeException 또는 잘못된 반환 hash는 SUBMISSION_UNRESOLVED다. 재호출하면 gas/nonce가 재조회되므로 같은 key로 동일 요청 재시도를 보장하지 않는다. |

잘못된 주소/금액/key는 IllegalArgumentException, signer null은 NullPointerException이다. chain 불일치는 DmrvnException(WRONG_CHAIN), 비정상 RPC quantity/0 gas 또는 gasPrice는 RPC_UNAVAILABLE이다. ERC-20, 다른 체인 자산, 자동 nonce 조정·확정 대기·서비스별 비용 한도는 제공하지 않는다.

## 6. EVM 거래 조회

근거: [EvmTransactionClient](../sdks/java/src/main/java/com/youngminkim/recanet/EvmTransactionClient.java).

| ID / API | 계약 |
| --- | --- |
| TX-01 `getTransaction(txHash)` | 지정 chain/RPC에서 상세 조회. 미발견은 Optional.empty(), 조회 장애는 예외다. Privy 자격 증명은 필요하지 않다. |
| TX-02 `getTransactionStatus(txHash)` | chainId,transactionHash,state,blockNumber,confirmations 반환. 아래 상태 의미를 따른다. |
| TX-03 `listTransactions(address,query)` | 최상위 TX의 from이 주소와 같은 블록 포함 거래를 블록 번호·TX index 내림차순으로 반환한다. 입금·내부 호출·pending 목록·다른 지갑의 UserOperation은 제외한다. |
| TX-04 페이지 | inclusive fromBlock>=0, nullable toBlock>=fromBlock, limit=1~100. cursor는 nonblank, 최대 2048자. 첫 toBlock=null은 최신 블록을 고정한다. 한 호출은 최대 100블록을 탐색한다. |
| TX-05 커서 | 같은 chain/주소/블록 범위에만 사용한다. 빈 페이지에도 nextCursor가 있으면 계속 조회한다. nextCursor=null이 종료다. 새 블록은 cursor 없는 새 조회로 포함한다. 커서는 불투명 값이다. |

| state | 의미 |
| --- | --- |
| NOT_FOUND | 해당 RPC에서 미발견. 실패·취소·대체의 증거가 아님 |
| PENDING | TX는 있으나 블록 미포함 |
| MINED | 블록 포함, 실행 결과 미확인 |
| SUCCEEDED | receipt status=1 |
| REVERTED | receipt status=0 |

상세에는 chainId/hash/from/to, valueWei/nonce/input, gasLimit/gasPriceWei/maxFeePerGasWei/maxPriorityFeePerGasWei, blockNumber/blockHash/transactionIndex, status, 원본 transaction/receipt가 있다. to=null은 컨트랙트 생성, pending의 블록 필드/receipt는 null이다. 수수료 필드는 TX 종류에 따라 없을 수 있다. raw map은 중첩까지 불변이고 페이지 목록도 불변이다.

confirmations는 RPC head 기준 관찰값이며 최종성이 아니다. chain 재구성이나 TX/receipt/block 불일치는 CHAIN_CHANGED로 중단하고 첫 페이지부터 재조회한다. 과거 블록 제공 실패를 빈 내역으로 처리하지 않는다. 인덱서 없는 블록 탐색이므로 장기간 내역의 고속 검색은 보장하지 않는다.

## 7. DMRVN

근거: [DmrvnClient](../sdks/java/src/main/java/com/youngminkim/recanet/dmrvn/DmrvnClient.java), [DeclaredMethodology](../sdks/java/src/main/java/com/youngminkim/recanet/dmrvn/DeclaredMethodology.java), [기존 연동 문서](../sdks/java/docs/DMRVN.md).

### 7.1 설정·배포·방법론

DMRVN-01: DmrvnConfig는 chain/RPC, Claim/Forwarder 주소와 runtime hash, deployment manifest, Greenfield chain/bucket/prefix, partnerId, 양수 maxRelayCostWei, confirmations>=1을 지정한다. chainId는 양수이며 2^53-1 이하, partnerId는 양수 uint32다. prefix는 nonblank 상대 경로, 끝은 `/`, `..`를 포함하지 않아야 한다. objectName은 prefix 안의 더 긴 경로이며 UTF-8 1024 bytes 이하, `..`/제어문자를 포함하지 않아야 한다. 경로 설정은 저장소 권한을 부여하지 않는다.

DMRVN-02: preflight()는 배포 검증에서 같은 블록의 code hash, proxy 구현/admin slot, 승인 release/버전, domain/trusted Forwarder와 chain을 확인한다. 별도로 approver 역할·방법론·Evidence 설정·Relay 잔액을 조회하고 ready/verifiedMetadata를 제공한다. private 쓰기나 검증자 원본 읽기 성공을 증명하지 않는다. 과거 direct 배포는 신규 쓰기 대상이 아니며 조회·기존 제출 복구용이다. 승인되지 않은 구현에 자동 fallback하지 않는다.

DMRVN-03: 방법론 생성은 manifest JCS hash/expectedHash와 WASM hash/manifest.wasmHash를 확인한다. Registry.isActive는 주입된 ACTIVE 판단이며 SDK는 Firebase 조회나 방법론 계산을 대신하지 않는다. 신규 고수준 API/preflight에는 5인자 생성자로 명시한 양수 evidenceSchemaVersion이 필요하다. 4인자 호환 생성자의 값 3은 신규 wire 버전 승인이 아니다. 미설정은 EVIDENCE_CONTRACT_UNCONFIGURED다.

### 7.2 JSON·Evidence·서명

DMRVN-04: Json은 JCS UTF-8 직렬화와 Keccak-256 hash를 사용한다. 객체 key를 정렬하고 배열 순서·문자열·boolean·null을 보존한다. 정수는 [-9007199254740991,9007199254740991], 소수는 유한 IEEE-754 JCS로 값 손실 없이 왕복 가능한 수다. 잘못된 UTF-8/Unicode, 중복 key, trailing JSON, literal -0, NaN/Infinity, 지원하지 않는 객체 타입은 거부한다. 고정밀 값을 문자열로 표현할지는 호출자가 정하고 SDK는 수치/문자열을 변환하지 않는다.

DMRVN-05: provenance 이전 Evidence body의 공통 key 집합은 다음과 같다. source에는 ownerHash만 들어간다. inputs의 업무 프로필이나 PET 개수 범위를 SDK가 추론·계산하지 않는다. 공통 body의 JCS bytes 상한은 1 MiB다.

```text
schemaVersion: 명시한 양수 정수
sourceEventId: [A-Za-z0-9:_-]{1,128}
partnerId: config.partnerId
activityId: manifest.activityId
methodology: {id: manifest.methodology.id, version: manifest.methodology.version}
inputs: 파트너 JSON 객체
source: {ownerHash: Keccak-256(UTF-8(정규화한 beneficiary 주소))}
```

DMRVN-06: `DMRVN v4 source:<bodyHash>`를 서명하고 provenance를 추가한 전체 Evidence hash를 Claim에 결속한다. 제출 전 provenance signer/approver 일치와 현재 역할을 검사한다. 생성 후 검증은 저장된 Claim.approver를 사용하며 이후 역할 회수를 소급 적용하지 않는다. 전체 evidenceLocation과 location struct hash도 Claim에 결속한다.

DMRVN-07: Claim/Task/Observation EIP-712 domain은 DMRVNClaimContract version 7, ForwardRequest는 DMRVNForwarder version 1이다. verifyingContract는 각각 Claim 호출 주소(proxy), Forwarder다. 구현 버전과 혼동하지 않는다. ForwardRequest 서명에는 nonce가 있으나 execute tuple에는 없다. 정확한 필드 순서·폭·ABI는 [동봉 리소스](../sdks/java/src/main/resources/dmrvn/)와 고정 벡터를 따른다.

### 7.3 단일 활동 제출

DMRVN-08: 권장 진입점은 submitActivity(BeneficiaryWallets,ActivityRequest)다. 권한 확인·지갑 조회/생성 → Evidence/provenance → private 객체 생성·봉인·실제 bytes 재조회 → 승인 → beneficiary 서명 → 운영 지갑 Relay 제출 → receipt/Claim 확인 순서다. approver/Relay는 같은 EOA다. 일반 흐름은 wallet private key export로 서명을 우회하지 않는다.

| ActivityRequest 필드 | 제약 / 3인자 생성자의 기본값 |
| --- | --- |
| userId | nonblank; 서비스가 인증·인가한 회원 |
| sourceEventId | `[A-Za-z0-9:_-]{1,128}` |
| inputs | nonnull JSON 객체, 복사 보존; accessor도 복사 반환 |
| claimId | nullable bytes32; null이면 호출별 생성 |
| objectName | nullable 전체 경로; null이면 prefix 아래 호출별 생성 |
| gas | uint256 문자열, 100000~2000000; 기본 `900000` |
| confirmationTimeout | 0~10분; 기본 60초 |
| pollInterval | 1ms~10초; 기본 1초 |

각 호출은 새 UUID operationId를 만든다. claimId가 null이면 Keccak-256(UTF-8(deploymentId + ":" + operationId)), objectName이 null이면 `<prefix>activities/<activityId>/<operationId>/evidence.json`이다. confirmationTimeout은 제출 후 확인 대기 한도이며 전체 호출의 처리 시간 한도가 아니다.

DMRVN-09: 반환 map은 outcome,lastConfirmedStage,confirmed,requested 및 오류 시 errorCode를 포함한다. request 생성/메서드 진입 전 null 등 인자 오류까지 모두 이 envelope로 반환하지는 않는다.

| outcome | 의미 / 처리 |
| --- | --- |
| CONFIRMED | 성공 receipt와 제출 결속 확인. 최종 VALID가 아님 |
| FAILED | 확인 단계에서 처리 중단. 이미 생성한 지갑/객체 등의 부수 효과는 남을 수 있음 |
| UNKNOWN | 생성/제출/확인이 불확실. 자동 재제출하지 않고 기존 작업 조사 |

lastConfirmedStage는 REQUEST_ACCEPTED, BENEFICIARY_READY, EVIDENCE_SIGNED, EVIDENCE_CREATE_BROADCAST, EVIDENCE_SEALED, CLAIM_APPROVED, BENEFICIARY_SIGNED, SUBMISSION_BROADCAST, SUBMISSION_CONFIRMED 중 확인한 단계다.

confirmed는 deploymentId/chainId/claimAddress/claimId/operationId/sourceEventId를 보존하고 확인한 경우 beneficiary/evidenceHash/createTxHash/evidenceLocation/storageStatus/submissionFromBlock/txHash/receipt/chainStatus를 추가한다. requested.evidenceLocation은 의도한 경로이며 저장 성공 증거가 아니다. 재사용 가능한 승인·사용자 서명이나 임의 어댑터의 원문 오류를 단일 호출 응답에 노출하지 않는다.

DMRVN-10: 단일 호출에는 자동 재시도·재시작 복구·sourceEventId 중복 방지 보장이 없다. 같은 request/claimId/sourceEventId 재호출도 이전 작업 재개를 보장하지 않는다. 선택적 journal은 기록용이며 exactly-once 보장을 만들지 않는다. 호출자가 응답/조사 식별자를 보존하고 다중 프로세스의 운영 지갑 nonce를 직렬화해야 한다.

### 7.4 단계별 API·복구

| ID / API | 계약 |
| --- | --- |
| DMRVN-11 prepareEvidence | operationId/claimId/beneficiary/objectName/body의 snapshot·provenance·생성 의도·CreateObject hash를 보존하고 upload/SEALED/실제 bytes를 확인한다. 같은 작업 입력/config 변경은 OPERATION_INPUT_CHANGED다. |
| DMRVN-12 approveClaim / prepare | 저장 bytes/ownerHash/방법론/역할/Claim nonce를 검사해 승인한다. prepare는 Evidence 준비+승인 조합이다. |
| DMRVN-13 prepareSponsored / recordSponsoredSignature | 대납 요청을 준비하고 정확한 요청/서명을 보존한다. record는 전송하지 않는다. gas/nonce/deadline/서명을 조용히 재발급하지 않는다. |
| DMRVN-14 prepareSelfPaid | 사용자 직접 가스 납부 거래 준비. 실제 사용자 전송은 별도다. |
| DMRVN-15 submitSponsored / resolveSubmission | 저장 요청 제출 또는 기존 거래 조사. 역할/nonce/deadline/비용 한도를 확인한다. SUBMISSION_UNRESOLVED를 재전송으로 해결하지 않는다. |
| DMRVN-16 recoverCreateTransaction | 원래 hash가 해당 업로더/객체의 성공 CreateObject인지 확인하고 upload를 이어간다. timeout/객체 미발견만으로 생성 의도를 해제하지 않는다. |
| DMRVN-17 operation | 단계별 snapshot을 복사 반환한다. 승인/사용자 서명이 포함될 수 있으므로 단일 호출 공개 응답과 동일하게 노출하지 않는다. |

submitActivity(UserWalletClient,...) 및 submitActivity(EvmSigner,...)는 준비된 지갑/body를 조합하는 호환 overload다. 단일 요청의 자동 지갑 준비/envelope 계약을 모든 overload에 적용하지 않는다.

### 7.5 결과 조회

DMRVN-18: DmrvnReader.readResult는 journal 없이 claimId와 fromBlock 또는 reportTxHash 등으로 조회한다. DmrvnClient.readResult는 operation 기록도 사용한다. chainStatus는 NONE/PENDING/VALID/INVALID/REVOKED다. LOCAL_WAIT_TIMEOUT은 로컬 대기 종료이며 네트워크 검증 실패가 아니다.

최종 보고서는 성공 receipt·보고 event·실제 onReport transaction·다운로드 bytes의 hash/서명/source 결속을 검증한다. 보고서 검증 실패는 관찰한 chainStatus를 보존하고 reportVerified=false/reportError로 분리한다. 체인/배포 자체 조회 실패까지 reportError로 감싼다는 보장은 없다. SDK가 CO2e 계산이나 노드 합의를 대신하지 않는다. verifyEvidenceProvenance는 확보한 private Evidence bytes를 Claim evidenceHash/저장 approver와 독립 검증한다.

## 8. 어댑터·영속성

| ID / 경계 | 구현자 조건 |
| --- | --- |
| ADAPTER-01 EvmRpc | 실제 JSON-RPC 결과를 제공한다. 불일치/장애를 성공이나 빈 내역으로 조작하지 않는다. |
| ADAPTER-02 EvmSigner | address, 메시지/typed data 서명, 정확한 transaction 제출. 제출 자동 재시도를 비활성화해야 한다. |
| ADAPTER-03 BeneficiaryWallets | partner 자격·범위·회원 동의/철회 확인 후 signer 조회/생성. 반환 signer도 서명 직전에 권한을 재확인해야 한다. |
| ADAPTER-04 GreenfieldStorage | private 객체를 한 번 create하고 원래 CreateObject hash로 upload. head/read는 실제 객체를 조회하고 DB 사본으로 대체하지 않는다. matchesCreateTransaction은 creator/객체 결속을 입증한다. |
| ADAPTER-05 OperationJournal | load는 분리된 snapshot, store는 전체 교체다. durable 구현은 반환 전 영속화하며 withLock은 worker 간 직렬화와 소유권 상실 시 fencing을 제공해야 한다. key/token을 저장하지 않는다. |
| ADAPTER-06 claim 예약 | 전역 claim-id 잠금과 모든 배포·구버전 기록의 findOperationsByClaimId가 필요하다. 미구현 default는 JOURNAL_UNAVAILABLE. 다른 배포 충돌은 DEPLOYMENT_COLLISION, 같은 배포의 다른 operation은 NONCE_CONFLICT다. |

MemoryOperationJournal은 메모리 상태다. FileOperationJournal은 단일 호스트 로컬 디스크용이며 NFS/다중 호스트 DB를 대체하지 않는다. 분산 트랜잭션/잠금/fencing은 소비자가 구현한다. 영속 journal도 exactly-once를 보장하지 않는다.

NodeGreenfieldStorage에는 별도 Node worker/npm 의존성이 필요하다. JAR만으로 쓰기가 동작하지 않는다. 저장소 키만 worker에 전달하고 Privy secret/authorization key는 전달하지 않는다. Feegrant·잔액·권한을 자동 생성하거나 다른 지갑으로 우회하지 않는다.

## 9. 오류·재시도

| 예외 | code 집합 |
| --- | --- |
| PrivyAuthenticationException | MISSING_TOKEN, INVALID_TOKEN, EXPIRED_TOKEN, KEY_SOURCE_UNAVAILABLE |
| PrivyApiException | INVALID_CREDENTIALS, FORBIDDEN, RATE_LIMITED, UNAVAILABLE, INVALID_RESPONSE, INTERRUPTED |
| TransactionQueryException | RPC_UNAVAILABLE, INVALID_RESPONSE, WRONG_CHAIN, CHAIN_CHANGED, INTERRUPTED |

PrivyApiException은 upstream statusCode(응답 없으면 0), 선택적 retryAfter를 제공한다. 401/403/429는 각각 INVALID_CREDENTIALS/FORBIDDEN/RATE_LIMITED다. 403을 잘못된 secret으로 단정하지 않는다. 오류 메시지는 token/secret/upstream body를 노출하지 않는다. 서비스 HTTP 응답 매핑은 호출자가 결정한다.

DmrvnException.Code 전체 집합:

```text
INVALID_INPUT, EVIDENCE_CONTRACT_UNCONFIGURED, WRONG_CHAIN,
DEPLOYMENT_MISMATCH, DEPLOYMENT_NOT_READY, UNAPPROVED_IMPLEMENTATION,
DEPLOYMENT_COLLISION, UNAUTHORIZED_SIGNER, OPERATION_INPUT_CHANGED,
OPERATION_NOT_PREPARED, SUBMISSION_INPUT_CHANGED, SUBMISSION_UNRESOLVED,
STORAGE_ACCESS_DENIED, OBJECT_UNSEALED, STORAGE_UNAVAILABLE,
STORAGE_CREATE_UNRESOLVED, STORAGE_ACCOUNT_UNFUNDED, STORAGE_MISMATCH,
SIGNATURE_INVALID, REQUEST_EXPIRED, NONCE_CONFLICT, INSUFFICIENT_FUNDS,
GAS_ESTIMATION_FAILED, RPC_UNAVAILABLE, REPORT_LOOKUP_RANGE,
REPORT_TX_NOT_FOUND, REPORT_READ_FAILED, REPORT_MISMATCH,
JOURNAL_UNAVAILABLE, INTERRUPTED, METHODOLOGY_UNAVAILABLE
```

| code | retryable() | action() |
| --- | --- | --- |
| SUBMISSION_UNRESOLVED, STORAGE_CREATE_UNRESOLVED | true | RECONCILE_ONLY |
| OBJECT_UNSEALED, STORAGE_UNAVAILABLE, RPC_UNAVAILABLE, REPORT_TX_NOT_FOUND, REPORT_READ_FAILED, JOURNAL_UNAVAILABLE, METHODOLOGY_UNAVAILABLE | true | RETRY_SAME_OPERATION |
| STORAGE_ACCOUNT_UNFUNDED, INSUFFICIENT_FUNDS | false | FUND_CONFIGURED_ROLE |
| 나머지 | false | FIX_INPUT_OR_CONFIGURATION |

retryable=true만 보고 거래를 재전송하지 않는다. RETRY_SAME_OPERATION은 원래 단계별 작업/입력 유지 조건이며 새 단일 호출 생성 허가가 아니다. definitelyNotBroadcast는 broadcast 이전 실패를 입증한 storage adapter, definitelyRejected는 CheckTx 명시적 거절에만 해당한다. timeout/연결 단절은 해당 증거가 아니다. 만료·실패·미확인 거래의 예약 해제와 nonce/deadline 재발급은 자동 수행하지 않는다.

## 10. 검증 매핑

기존 Java 검증에 대한 추적표다. 공통 conformance suite나 실서비스 인수 완료를 뜻하지 않는다.

| 계약 | 기존 테스트 |
| --- | --- |
| AUTH-01~05 | [PrivyClientTest](../sdks/java/src/test/java/com/youngminkim/recanet/PrivyClientTest.java), [PrivyTokenVerifierTest](../sdks/java/src/test/java/com/youngminkim/recanet/PrivyTokenVerifierTest.java), [PrivyHttpTransportTest](../sdks/java/src/test/java/com/youngminkim/recanet/PrivyHttpTransportTest.java) |
| WALLET-01~06 | [PrivyBackendAuthenticationTest](../sdks/java/src/test/java/com/youngminkim/recanet/PrivyBackendAuthenticationTest.java), [PrivyEvmSignerTest](../sdks/java/src/test/java/com/youngminkim/recanet/PrivyEvmSignerTest.java) |
| WALLET-07~11 | [UserWalletClientTest](../sdks/java/src/test/java/com/youngminkim/recanet/UserWalletClientTest.java) |
| ASSET-01~03 | [AssetClientTest](../sdks/java/src/test/java/com/youngminkim/recanet/AssetClientTest.java) |
| TX-01~05 | [EvmTransactionClientTest](../sdks/java/src/test/java/com/youngminkim/recanet/EvmTransactionClientTest.java) |
| DMRVN-01~03 | [DmrvnDeploymentTest](../sdks/java/src/test/java/com/youngminkim/recanet/dmrvn/DmrvnDeploymentTest.java) |
| DMRVN-04~07 | [DmrvnProtocolTest](../sdks/java/src/test/java/com/youngminkim/recanet/dmrvn/DmrvnProtocolTest.java), [protocol 벡터](../sdks/java/src/test/resources/dmrvn/protocol-vectors.expected.json) |
| DMRVN-08~10 | [DmrvnActivityTest](../sdks/java/src/test/java/com/youngminkim/recanet/dmrvn/DmrvnActivityTest.java) |
| DMRVN-11~17, 어댑터·journal | [DmrvnClientTest](../sdks/java/src/test/java/com/youngminkim/recanet/dmrvn/DmrvnClientTest.java) |
| DMRVN-18 | [DmrvnReaderTest](../sdks/java/src/test/java/com/youngminkim/recanet/dmrvn/DmrvnReaderTest.java), [ReportVerifierTest](../sdks/java/src/test/java/com/youngminkim/recanet/dmrvn/ReportVerifierTest.java) |

```sh
# 저장소 루트; 실제 네트워크 쓰기/지갑 생성/거래 제출 없음
make java-check
# 양쪽 빌드 산출물이 준비된 경우 공개 선언 비교
make verify-api
# 공개 메서드/overload/TS export 누락·문서 연결·공유 ABI 검사
python3 scripts/check-sdk-contract.py
```

두 언어 구현/변경은 계약 ID별 성공값·거부 입력·nullable 필드·오류 code·부수 효과 횟수·미확인 제출의 재전송 금지를 비교해야 한다. 기존 58개 JSON 교차 실행이나 공개 선언 일치만으로 준수를 판정하지 않는다.

## 11. 미확정 사항·변경 원칙

이 계약의 일반 방법론 경로는 Java 기준이다. TS의 별도 Evidence4/PET3 프로필을 공통 경로에 자동 적용하지 않는다. 해당 프로필과 Java의 통합 범위, 실제 검증자 지원, 파트너 자격·동의 정책, 미확인 결과의 업무 복구 정책, 분산 fencing, private 원본 접근/공동 검증은 별도 통합·검증 대상이며 [차이 목록](gaps.md)에 추적한다. 동봉 testnet 주소/과거 fixture를 운영 승인값으로 사용하지 않는다. 발행·외부 설치·실환경 인수 상태는 [배포 준비 기록](../docs/phase4-readiness.md)과 [Java 검증 기록](../sdks/java/docs/DMRVN_VALIDATION.md)을 따른다.

변경 시 영향받는 계약 ID, Java 선언/동작, 타 언어 차이, 검증 근거를 함께 갱신한다. 기존 이력·API baseline·서명/bytes 벡터를 새 계약에 맞춰 덮어쓰지 않는다. 이 문서의 작성 자체는 SDK 공개 API나 외부 wire 규격을 변경하지 않는다.

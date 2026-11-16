# RecanetJava

## SDK 추적 로그

주요 SDK 작업은 기본적으로 완료 요약·중요 상태·오류를 로컬 구조화 로그로 남깁니다. OpenTelemetry 인스턴스를
주입하면 단계별 로그를 Grafana Cloud 등으로 전송할 수 있습니다. SDK 트레이스는 생성하지 않습니다.
오류 로그에는 작업 ID, 실패 단계, 오류 코드와 마스킹한 메시지, 마지막 확인 상태가 기록됩니다.
정상 하위 호출은 기본적으로 전송하지 않으며, 필요할 때 `detailedLogging(true)`로 상세 진단을 켤 수 있습니다.
설정, 수집 범위, 전송 예제와 파트너 권한 구성은 [추적 로그 안내](docs/TELEMETRY.md)를 참고하세요.

Privy 공식 Java server SDK를 감싸는 Java backend 라이브러리입니다. 서버 API 자격 증명 확인과 사용자 access token 인증을 제공합니다.

## 환경

- Java 17
- Gradle 8.10.2
- Gradle `java-library` plugin
- Privy Java server SDK `io.privy.api:privy-java:0.59.0`
- Nimbus JOSE + JWT `10.10`
- JUnit 5

공식 SDK는 `implementation` 의존성으로 사용합니다. 서버 요청 생성, Basic Auth, JSON 처리는 공식 SDK에 위임합니다. Java SDK `0.59.0`의 실제 API에는 access token 검증 메서드가 없어 해당 기능은 Nimbus로 구현했습니다. 공개 API에는 Privy/Nimbus 타입을 노출하지 않습니다.

이 라이브러리는 서버 요청을 인증하고 전달된 Privy access token을 검증합니다. 사용자의 로그인 시작, OTP 전송, refresh token 처리는 구현하지 않았습니다. 공개키를 Privy wallet owner로 등록하는 백엔드 지갑 생성과, wallet의 공개키가 등록된 백엔드 키와 일치하는지 확인하는 기능을 제공합니다. 개인키는 Privy 등록 요청에 포함하지 않으며 호출자 측에서 안전하게 보관해야 합니다.

```java
var key = new BackendWalletRegistration(
    System.getenv("BACKEND_WALLET_PUBLIC_KEY"),
    System.getenv("BACKEND_WALLET_PRIVATE_KEY"));
var wallet = client.registerBackendWallet(key, new BackendWalletCreateRequest("ethereum"));
boolean backendOwned = client.isBackendWallet(wallet.id(), key);
var wallets = client.listWalletsByAuthorizationKey(key.publicKey());
```

운영 환경에서는 키를 로그로 출력하지 말고 secret manager 또는 환경변수로 주입합니다.

```java
var key = BackendWalletRegistration.fromEnvironment();
```

SDK에서 Privy authorization용 P-256 키쌍을 생성할 수도 있습니다. 생성 결과의 private key는 즉시 secret manager에 저장하고 로그에 출력하지 않습니다.

```java
var generated = BackendWalletKeyPair.generate();
var registration = generated.registration();
// generated.privateKey()를 안전한 secret manager에 저장한 뒤 Privy에 public key를 등록합니다.
```

초기 파트너 설정 단계에서 로그 출력을 명시적으로 허용하려면 `BackendWalletKeyPair.generateAndLog()`를 사용합니다. 이 메서드는 private key도 로그에 출력하므로 운영 환경의 일반 시작 코드에서 호출하면 안 됩니다.

환경설정이 비어 있을 때 자동 초기화하려면 다음 메서드를 사용합니다. 설정값이 있으면 authorization key로 기존 wallet을 조회하고, 없으면 키쌍 생성 및 wallet 생성을 수행합니다.

```java
var wallet = client.ensureBackendWallet(new BackendWalletCreateRequest("ethereum"));
```

wallet private key export도 authorization private key로 서명해 요청할 수 있습니다. 반환값은 실제 blockchain wallet private key이므로 로그에 남기지 말고 즉시 안전한 저장소로 전달해야 합니다.

```java
String walletPrivateKey = client.exportWalletPrivateKey(wallet.id(), registration);
```

초기 파트너 설정 단계에서만 다음 메서드로 실제 wallet private key를 로그에 출력할 수 있습니다.

```java
client.exportWalletPrivateKeyAndLog(wallet.id(), registration);
```

Privy app secret은 실행 환경의 환경변수 또는 secret manager에서 주입합니다.

## 서비스 회원별 지갑과 자동 서명

`UserWalletClient`는 서비스 회원마다 EVM 지갑을 만들고 서버 authorization key로 자동 서명합니다. 사용자 Privy 계정 생성, Privy 로그인, 사용자 JWT는 필요하지 않습니다. Privy상의 제어 권한은 서버 키가 가집니다. `APP_ID / APP_SECRET`은 API 인증, `BACKEND_WALLET_PRIVATE_KEY`는 지갑 작업 승인에 사용합니다.

```java
var memberWallets = new UserWalletClient(
    client, BackendWalletRegistration.fromEnvironment(), "recanet-prod");

// 반드시 서비스가 인증·권한 확인한 회원 ID 또는 승인된 백엔드 작업의 회원 ID 사용
String memberId = authenticatedServiceMemberId;
UserWallet memberWallet = memberWallets.getOrCreateWallet(memberId);
String signature = memberWallets.signMessage(memberId, "서비스가 승인한 메시지");
String typedSignature = memberWallets.signTypedData(memberId, typedData);
```

- 서비스 구분값(namespace)과 회원 ID를 SHA-256으로 해시한 고정 `external_id`를 Privy에 저장합니다. 별도 매핑 DB 없이 회원 지갑을 찾고 재사용할 수 있으며, 필요하면 DB에 지갑 ID와 주소를 저장해도 됩니다. namespace와 회원 ID는 변경되지 않는 값을 사용하고, 여러 서비스/tenant는 서로 다른 namespace를 사용하세요. 해시는 암호화가 아닙니다.
- `external_id`는 회원 연결 정보이며 인증 수단이 아닙니다. 조회 시 `external_id`와 서버 `authorization_key`를 함께 필터링하고, 서명 전 서버 키 권한도 확인합니다. 호출자가 임의의 지갑 ID를 지정하는 API는 제공하지 않습니다. 동일 키로 관리하는 다른 namespace의 지갑에도 키 자체의 권한은 있으므로, 서비스의 회원/tenant 접근 제어가 필요합니다.
- 회원 지갑은 먼저 조회하고 없을 때 생성합니다. Privy의 앱 내 `external_id` 유일성으로 중복 생성을 방지합니다. 조회·생성 오류는 HTTP 409를 포함해 그대로 전달하며, 오류 이후 자동 재조회·재생성하지 않습니다. 호출자가 같은 namespace와 회원 ID로 명시적으로 다시 호출하면 조회부터 수행합니다. 기존에 `external_id` 없이 생성한 지갑을 자동 연결하지 않습니다.
- `findWallet(memberId)`는 없으면 빈 `Optional`을 반환합니다. 서명 메서드는 지갑이 없으면 실패하고 자동 생성하지 않습니다. authorization key는 생성 전에 안전하게 영속 보관해야 하며, 기존 키 교체/지갑 권한 이전은 별도로 처리해야 합니다.
- `sendTransaction(memberId, chainId, transaction, operationId)`도 제공합니다. `transaction`에는 `to`, `data`와 hex 문자열 `value`, `gas`, `gasPrice`, `nonce`를 전달합니다. 요청 본문과 operation ID를 함께 보관하고, 동일 작업의 복구 시 요청 본문을 바꾸지 마세요. 같은 지갑의 nonce 관리는 서비스에서 직렬화합니다. 반환 해시는 제출 결과이며 확정 여부는 별도 조회해야 합니다.

Privy의 [external ID 규칙](https://docs.privy.io/wallets/wallets/external-ids)과 [authorization key 제어 모델](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls)을 사용합니다.

## 자금 조회와 전송

현재 지원 자산은 **아비트럼 세폴리아의 네이티브 ETH** 하나입니다 (chain ID `421614`, 소수점 18자리). `AssetClient`는 체인 ID를 확인하고 잔액을 조회하며, 인증된 Privy 백엔드 지갑으로 전송합니다. 조회 주소는 블록체인 주소이고 전송 지갑은 기존 `PrivyEvmSigner`로 지정합니다.

```java
import com.youngminkim.recanet.AssetClient;
import com.youngminkim.recanet.PrivyEvmSigner;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;

var assets = new AssetClient(URI.create("https://sepolia-rollup.arbitrum.io/rpc"));
var signer = new PrivyEvmSigner(client, wallet.id(), registration);
BigInteger balanceWei = assets.getBalance(signer.address());
BigDecimal balanceEth = new BigDecimal(balanceWei, AssetClient.DECIMALS);

// 0.001 ETH = 10^15 wei. 정수 wei를 사용해 반올림을 피합니다.
BigInteger amountWei = new BigInteger("1000000000000000");
String txHash = assets.transfer(signer, recipientAddress, amountWei, operationId);
```

- `operationId`는 전송별로 고유하고 안정적인 Privy idempotency key입니다. 수신 주소와 금액은 호출자가 검증하고, 같은 지갑의 전송은 애플리케이션에서 직렬화해야 pending nonce가 충돌하지 않습니다.
- 가스 추정, 현재 gas price와 pending nonce를 이용하며 가스비도 송신 지갑의 ETH에서 차감됩니다. 반환된 해시는 제출 결과이며 성공이나 최종 확정을 뜻하지 않습니다. 아래 `EvmTransactionClient`로 상태를 확인하세요.
- 서명/제출 오류는 원래 예외를 그대로 전달합니다. 유효하지 않은 반환 해시는 SDK 검증 오류 `SUBMISSION_UNRESOLVED`입니다. 자동 재전송하지 않으며, 호출 시마다 nonce와 가스를 다시 조회하므로 동일 key로 이 메서드를 재호출하는 것은 동일 요청의 안전한 재시도가 아닙니다.
- 이 기능은 백엔드 지갑을 대상으로 하며 HTTP 요청자의 해당 지갑에 대한 접근 권한 검증은 애플리케이션에서 수행해야 합니다. 자체 코인 발행 후에는 자산 종류와 전송 방식을 별도로 변경해야 합니다.

## Transaction 조회

`EvmTransactionClient`는 DMRVN 작업 여부와 무관하게 EVM 트랜잭션을 조회합니다.
체인 ID와 해당 체인의 RPC를 지정하며, Privy app secret이나 wallet private key는 필요하지 않습니다.
TX 입력은 **블록체인 transaction hash**, 지갑 입력은 **블록체인 주소**입니다.
Privy transaction ID 또는 wallet ID를 넣는 API가 아닙니다.

| 기능 | 메서드 | 반환값 |
| --- | --- | --- |
| 특정 TX 상세 | `getTransaction(txHash)` | `Optional<EvmTransaction>` |
| 특정 TX 상태 | `getTransactionStatus(txHash)` | `EvmTransactionStatus` |
| TX를 발생시킨 지갑 기준 목록 | `listTransactions(walletAddress, query)` | `EvmTransactionPage` |

```java
import com.youngminkim.recanet.EvmTransactionClient;
import com.youngminkim.recanet.EvmTransactionQuery;
import java.net.URI;

var transactions = new EvmTransactionClient(
    421614L, URI.create("https://sepolia-rollup.arbitrum.io/rpc"));
// 기존 DMRVN 설정을 사용하는 경우:
// var transactions = new EvmTransactionClient(config.chainId(), rpc);

var detail = transactions.getTransaction(txHash);
var status = transactions.getTransactionStatus(txHash);

// earliestBlock: 조회를 시작할 최초 블록 번호(예: 지갑 사용을 시작한 블록).
// 종료 블록 null: 첫 페이지에서 최신 블록을 고정하고 이후 페이지에서도 유지.
var query = new EvmTransactionQuery(earliestBlock, null, 20);
var page = transactions.listTransactions(walletAddress, query);
var items = page.transactions();
if (page.nextCursor() != null) {
    var nextPage = transactions.listTransactions(
        walletAddress, query.withCursor(page.nextCursor()));
}
```

- 상세에는 발신자·수신자, 정확한 `BigInteger` 금액(wei), nonce, calldata, 가스·수수료 필드, 블록 정보, 상태, 원본 transaction/receipt가 포함됩니다. receipt의 로그와 체인별 추가 수수료 필드도 보존합니다. 반환 데이터는 중첩 컬렉션까지 수정할 수 없습니다.
- 상태는 `NOT_FOUND`(해당 RPC에서 미발견), `PENDING`(블록 미포함), `MINED`(블록에 포함됐으나 실행 결과 미확인), `SUCCEEDED`(receipt status=1), `REVERTED`(receipt status=0)입니다. 조회 오류는 예외로 구분합니다. `NOT_FOUND`를 실패·취소·대체로 해석하지 않습니다.
- `confirmations`는 현재 RPC head 기준 블록 확인 수입니다. `SUCCEEDED`나 confirmations는 합의 최종성 또는 L2의 L1 확정을 의미하지 않습니다. 수신자가 null이면 컨트랙트 생성이며, pending TX의 블록 정보와 receipt는 null입니다.
- 목록은 **최상위 TX의 `from`이 지갑 주소와 일치하는, 블록에 포함된 거래**를 블록 번호·TX index 역순으로 반환합니다. 일반 송금, 컨트랙트 호출, 컨트랙트 생성, 실행 실패 거래가 포함됩니다. 입금, 내부 호출, pending 전체 목록, 다른 지갑이 대신 보낸 UserOperation은 포함하지 않습니다. DMRVN 대납 거래는 Relay 주소로 조회합니다.
- 목록은 인덱서가 아닌 **RPC 블록 탐색** 방식입니다. 한 페이지에서 최대 100개 블록, 최대 `limit`개 거래(1~100)를 반환하므로, **빈 페이지라도 nextCursor가 있으면 계속 조회**해야 합니다. 커서는 동일한 체인·주소·블록 범위에서 사용합니다. 전체 검색 종료는 nextCursor=null로 판단합니다. 새 블록을 포함하려면 cursor 없이 새 조회를 시작합니다.
- 과거 이력이 길거나 거래가 드문 지갑은 블록 탐색에 많은 RPC 호출이 필요합니다. 실제 사용 구간을 지정하고, 대규모 서비스에서 장기간의 거래 내역을 빠르게 표시하려면 별도 인덱스가 필요합니다. 과거 블록을 제공하지 못하는 RPC의 응답을 빈 내역으로 처리하지 않습니다.
- `TransactionQueryException.code()`는 `WRONG_CHAIN`, `CHAIN_CHANGED`, `RPC_UNAVAILABLE`, `INVALID_RESPONSE`, `INTERRUPTED`를 구분합니다. 페이지 사이 체인 재구성 또는 서로 맞지 않는 TX/receipt/block 응답은 `CHAIN_CHANGED`로 알리며 첫 페이지부터 다시 조회합니다. 잘못된 주소·해시·커서·범위는 `IllegalArgumentException`입니다.

조회 프로토콜은 [Ethereum JSON-RPC 명세](https://ethereum.org/en/developers/docs/apis/json-rpc/)의 `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`를 따릅니다.

## 빌드

```bash
./gradlew clean build
```

## 서버 인증과 사용자 요청 인증

```java
import com.youngminkim.recanet.PrivyClient;
import com.youngminkim.recanet.PrivyClientConfig;
import com.youngminkim.recanet.PrivyTokenVerificationConfig;
import com.youngminkim.recanet.AuthenticatedUser;
import java.net.URI;

// Privy Dashboard에서 제공하는 해당 앱의 신뢰할 수 있는 JWKS URL.
// 요청자의 JWT 헤더에서 URL을 가져오지 않습니다.
var verification = PrivyTokenVerificationConfig.usingJwks(
    URI.create(System.getenv("PRIVY_JWKS_URL"))
);

PrivyClient client = new PrivyClient(
    new PrivyClientConfig(
        System.getenv("PRIVY_APP_ID"),
        System.getenv("PRIVY_APP_SECRET")
    ).withTokenVerification(verification)
);

// 시작 시 또는 진단 시 명시적으로 호출합니다. 요청마다 호출하지 않습니다.
// 공식 SDK로 GET /v1/users?limit=1을 한 번 호출합니다.
// 이 확인에는 사용자 조회 권한이 필요하며, 사용자나 지갑을 생성하지 않습니다.
client.verifyAppCredentials();

// HTTP 서버에서 가져온 Authorization 헤더 값.
// 토큰은 frontend 또는 호출자가 보내야 합니다.
AuthenticatedUser user = client.authenticateAuthorizationHeader(authorizationHeader);
String userId = user.userId();
String sessionId = user.sessionId();

// privy-token cookie 등을 이미 추출했다면 raw JWT를 검증할 수도 있습니다.
AuthenticatedUser sameUser = client.verifyAccessToken(accessToken);
```

`PrivyClient`는 애플리케이션 수명 동안 재사용합니다. 초기화는 외부 API를 호출하지 않으며, JWKS는 첫 유효한 형식의 토큰 검증 시 가져옵니다. `verifyAppCredentials()`를 호출하지 않는 경우 서버 자격 증명은 실제 서버 API 요청에서 검증됩니다.

공개키 직접 주입을 선택하면 토큰 검증에 네트워크 호출이 전혀 필요 없습니다. Privy Dashboard의 **verification public key**를 사용합니다. app secret이나 wallet authorization private key와는 다른 값입니다.

```java
var verification = PrivyTokenVerificationConfig.usingPublicKey(
    System.getenv("PRIVY_VERIFICATION_KEY_PEM")
);
```

공개키를 고정하면 키 교체 시 설정을 갱신하고 verifier/client를 다시 생성해야 합니다. 운영에서 자동 키 교체 대응이 필요하면 JWKS 방식을 사용합니다.

Privy 서버 API를 호출하지 않고 사용자 토큰만 검증하는 서비스는 app secret 없이 사용할 수 있습니다.

```java
import com.youngminkim.recanet.PrivyTokenVerifier;

var verifier = new PrivyTokenVerifier(System.getenv("PRIVY_APP_ID"), verification);
AuthenticatedUser user = verifier.authenticateAuthorizationHeader(authorizationHeader);
```

## 검증 규칙과 오류 처리

access token은 ES256/P-256 서명, `typ=JWT`, `iss=privy.io`, 설정된 앱과 일치하는 `aud`, `sub=did:privy:...`, 비어 있지 않은 `sid`, 필수 `iat`/`exp`를 검증합니다. `nbf`가 있으면 함께 검증합니다. 만료·미래 발급·잘못된 날짜 형식/범위·identity token·unsigned/HMAC token은 거부합니다. clock skew 기본값은 0이며 필요할 때 `verification.withClockSkew(Duration.ofSeconds(10))`처럼 명시적으로 설정할 수 있습니다(최대 1분).

`AuthenticatedUser`에는 app/user/session ID와 발급·만료 시각만 들어갑니다. 원본 token은 보관하지 않고, 인증 성공 결과도 캐시하지 않으므로 매 요청의 만료 상태를 다시 검사합니다. 로컬 JWT 검증은 세션의 실시간 logout/revocation이나 사용자 삭제 여부를 조회하지 않습니다. 그런 정책이 필요하면 서버 애플리케이션에서 별도로 확인해야 합니다.

HTTP 서버는 다음 오류를 자체 HTTP 응답으로 변환할 수 있습니다. SDK 자체는 특정 서버 프레임워크에 의존하지 않습니다.

| 예외 | 코드 | 의미 / 권장 처리 |
| --- | --- | --- |
| `PrivyAuthenticationException` | `MISSING_TOKEN`, `INVALID_TOKEN` | 요청 인증 거부, HTTP 401 |
| `PrivyAuthenticationException` | `EXPIRED_TOKEN` | HTTP 401, 클라이언트에서 access token 갱신 후 재요청 |
| `PrivyAuthenticationException` | `KEY_SOURCE_UNAVAILABLE` | 검증키 조회/갱신 실패, HTTP 503 등으로 구분 |
| `io.privy.api.models.errors.APIException` | `code()`의 원래 HTTP 상태 | Privy 공식 예외를 그대로 전달. `bodyAsString()`, `message()`, `rawResponse()`로 원래 응답과 헤더 확인 |
| `UpstreamException` | `code()`의 원래 Greenfield/RPC 코드 | `source()`, `statusCode()`, `getMessage()`, `responseBody()`로 외부 오류 확인 |
| `PrivyApiException` | `INVALID_RESPONSE` | SDK가 감지한 지갑 목록·응답 메타데이터 오류. 외부 API 오류와 구분 |

외부 API의 코드·메시지·응답 본문은 SDK에서 일반 오류로 치환하지 않습니다. 통신 오류는 원래 예외 또는 원래 원인을 보존한 예외로 전달합니다. 이 변경은 오류 본문을 호출자에게 노출하며 자동 로그 출력은 추가하지 않습니다. `PrivyClientConfig.toString()`은 계속 secret을 가립니다. `verifyAccessToken`을 쓰기 전에 `withTokenVerification(...)`을 설정하지 않았다면 설정 오류인 `IllegalStateException`이 발생합니다.

## 최적화 및 요청 제한

- 공개키 파싱, HTTP client, JWT verifier를 초기화 시 한 번 만들고 재사용합니다.
- JWKS는 5분 캐시하며, 같은 시점의 최초/갱신 요청은 공유합니다. 알 수 없는 `kid`는 재조회로 키 교체에 대응하고, 30초 구간에 최대 2회 조회하는 Nimbus rate limiter로 조회 폭주를 제한합니다.
- JWKS connect/read timeout은 각각 5초, 응답 크기 한도는 128 KiB입니다. 백그라운드 스레드, 자동 재시도, 만료된 키를 사용하는 outage fallback은 사용하지 않습니다.
- 필요하면 `verification.withJwksPolicy(timeout, ttl, cooldown)`으로 조정합니다. `ttl`은 `cooldown`보다 커야 합니다.
- 서버 자격 증명 확인은 명시적 요청이며 매 사용자 요청의 경로에서 제외합니다. 실패 시 자동으로 재시도하거나 잠들지 않고, 429의 `Retry-After`를 반환합니다.
- 서버 API 응답은 본문 완료까지 timeout을 적용하며, 최대 4 MiB로 제한합니다. interrupt 시 진행 중인 요청을 취소하고 interrupt 상태를 보존합니다.

JWKS cache TTL 안에 이미 확보된 키는 네트워크 호출 없이 사용할 수 있습니다. TTL이 지난 후 키를 갱신하지 못하면 인증을 거부합니다. 알 수 없는 키가 rate limit에 걸린 경우도 검증키 사용 불가로 반환될 수 있습니다.

기본 서버 API 주소는 `https://api.privy.io`, 연결 및 요청 timeout은 30초입니다. `PrivyClientConfig`의 4개 인자 생성자로 API origin과 timeout을 지정하거나, `PrivyClient(config, httpClient)`로 Java `HttpClient`를 주입할 수 있습니다. API origin은 경로와 마지막 `/` 없이 지정합니다. API/JWKS는 HTTPS를 사용하며, 테스트를 위한 loopback HTTP만 허용합니다.

이전 골격의 `endpoint()`, `basicAuthHeader()`, `httpClient()`는 제거했습니다. SDK 내부 구현에 필요한 공식 client는 package-private 접근으로 유지합니다.

## 검증 및 배포 산출물

테스트에서는 생성한 P-256 키와 로컬 HTTP 서버를 사용해 위조·만료·잘못된 claim, 인증 헤더, 키 교체, 캐시 공유, JWKS 장애, 서버 인증 오류, 429, 본문 timeout/크기 제한, interrupt를 검증합니다. 실제 Privy 계정의 자격 증명 확인이나 실제 로그인은 수행하지 않습니다.

빌드하면 `build/libs/`에 라이브러리 JAR, sources JAR, Javadoc JAR가 생성됩니다. `maven-publish` 설정도 포함되어 있습니다. 이 JAR는 의존성을 포함하지 않으므로 배포 시 Maven/Gradle 메타데이터와 함께 제공해야 합니다.

설계 판단과 문서 검토 내용은 [docs/BACKEND_AUTH.md](docs/BACKEND_AUTH.md)를 참고하세요. 소유자가 있는 wallet 작업은 별도의 authorization 문제이며, 향후 wallet API에서 공식 SDK의 `AuthorizationContext`를 내부에서 구성하도록 확장합니다.

## 공식 문서

- [Java SDK 설치](https://docs.privy.io/basics/java/installation)
- [Java SDK 설정](https://docs.privy.io/basics/java/setup)
- [Java SDK Quickstart](https://docs.privy.io/basics/java/quickstart)
- [AuthorizationContext 사용](https://docs.privy.io/controls/authorization-keys/using-owners/sign/signing-on-the-server)
- [Access token 검증](https://docs.privy.io/authentication/user-authentication/access-tokens)
- [통합 최적화](https://docs.privy.io/recipes/dashboard/optimizing)

## DMRVN 연동

공유 명세 [`6da7d02`](https://github.com/RecycleFarm/specifications/tree/6da7d029ca9a9dad71e5b2928de0f3c06cc5b499/dmrvn/backend-sdk) 기준이다. 운영 지갑 하나로 provenance·Claim 승인·Relay를 수행하고, durable journal 없이 다음 단일 요청을 사용할 수 있다.

```java
// methodology는 운영자와 확인한 Evidence 버전을 명시하여 설정한다.
var sdk = new DmrvnClient(config, rpc, operatingSigner, storage, methodology);
var beneficiaries = memberWallets.forPartner(config.partnerId(), (partnerId, userId) ->
    accessPolicy.isWalletUseAuthorized(authenticatedPartnerCredentials, partnerId, userId));
var result = sdk.submitActivity(beneficiaries,
    new ActivityRequest(memberId, sourceEventId, Map.of("petBottleCount", 3)));
```

수혜자 지갑 조회·생성, Evidence 생성, Greenfield 저장·봉인, 승인·수혜자 서명, Relay 제출과 receipt/Claim 확인까지 수행한다. `source.ownerHash`는 유지하고 `source.kind`는 제거한다. `inputs`는 파트너 JSON 객체를 보존하며 방법론별 형식·값 검증은 DMRVN에 맡긴다. 수혜자 서명을 호출자가 준비할 필요는 없다.

`CONFIRMED`는 제출 receipt와 Claim을 확인했다는 뜻이며 `chainStatus=PENDING`은 최종 VALID가 아니다. 실패 시 `FAILED`·`UNKNOWN` 결과를 생성하지 않고 원래 예외를 전달한다. Privy는 공식 `APIException`, Greenfield/RPC는 원래 코드·메시지·응답을 담은 `UpstreamException`을 확인한다. SDK 자체 검증 오류는 `DmrvnException`이다. 자동 재전송하지 않는다. 기록 보존·조사·복구와 여러 프로세스의 운영 지갑 nonce 관리는 소비자 책임이며 journal은 선택 사항이다.

명세에서 새 Evidence wire 버전과 Privy 매핑·권한 방식은 미결이다. 고수준 API는 Evidence 버전을 명시하지 않으면 중단하며 파트너 권한 어댑터를 반드시 받는다. 제공된 `forPartner` 매핑은 명시적으로 선택하는 어댑터이며 기존 지갑을 자동 연결하지 않는다. 과거 QA는 새 계약의 실환경 인수 증거가 아니다.

Greenfield 쓰기 어댑터는 Node 22+와 `tools/greenfield`의 공식 JS SDK 설치가 필요하다. [DMRVN 연동 안내](docs/DMRVN.md)와 [검증 기록](docs/DMRVN_VALIDATION.md)을 참고한다.

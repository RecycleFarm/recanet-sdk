# RecanetJava

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
```

Privy app secret은 실행 환경의 환경변수 또는 secret manager에서 주입합니다.

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
| `PrivyApiException` | `INVALID_CREDENTIALS` | Privy가 서버 자격 증명을 401로 거부 |
| `PrivyApiException` | `FORBIDDEN` | 요청 API에 대한 권한 부족; 자격 증명이 틀렸다고 단정하지 않음 |
| `PrivyApiException` | `RATE_LIMITED` | HTTP 429, `retryAfter()`가 있으면 호출자에서 반영 |
| `PrivyApiException` | `UNAVAILABLE`, `INVALID_RESPONSE`, `INTERRUPTED` | 서버/네트워크 장애, 응답 형식 오류 또는 호출 취소 |

오류 메시지에는 원본 token, secret, upstream response body를 넣지 않습니다. `PrivyClientConfig.toString()`도 secret을 가립니다. `verifyAccessToken`을 쓰기 전에 `withTokenVerification(...)`을 설정하지 않았다면 설정 오류인 `IllegalStateException`이 발생합니다. 이 설정 오류를 사용자 토큰 오류와 구분해서 처리하세요.

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

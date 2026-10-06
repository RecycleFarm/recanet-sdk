# Backend 인증 구현 판단

검토일: 2026-10-02. 사용 버전: `io.privy.api:privy-java:0.59.0`, Nimbus JOSE + JWT `10.10`.

## 구분과 구현 범위

| 흐름 | 인증 근거 | 구현 |
| --- | --- | --- |
| 서버 → Privy API | app ID + app secret | 공식 SDK에 위임, `verifyAppCredentials()`로 명시적 확인 |
| 요청자 → 우리 backend | Privy access JWT의 서명·claim | `PrivyTokenVerifier`, `verifyAccessToken()`, `authenticateAuthorizationHeader()` |
| 서버 → 백엔드 소유 wallet 등록/판별 | 등록된 public key와 wallet public key | `registerBackendWallet()`, `isBackendWallet()`; private key는 API 요청에 보내지 않음 |
| 서버 → 소유자가 있는 wallet/policy 작업 | owner의 authorization signature | wallet 작업 API에서 공식 `AuthorizationContext` 사용 |

서버 app secret은 사용자 로그인 토큰이 아니며, access token은 app secret의 대체물이 아니다. Backend에서 정상 사용자를 판별하는 것과 특정 wallet 작업의 소유자 승인을 검증하는 것도 다른 단계다. 백엔드 지갑은 Privy에 public key owner로 등록하고, 이후 wallet metadata의 public key와 비교한다. private key는 서버 애플리케이션이 별도로 안전하게 보관하며 등록 요청에는 포함하지 않는다.

## 공식 문서에서 확인한 내용

1. [Java Setup](https://docs.privy.io/basics/java/setup): app ID와 app secret으로 client 초기화. owner가 있는 자원에는 별도 authorization context를 전달한다.
2. Setup의 [앱 생성/자격 증명 링크](https://docs.privy.io/basics/get-started/dashboard/create-new-app): 환경별 앱을 분리하고 app secret은 backend에 둔다. SDK가 앱 생성이나 secret 재발급을 대신 수행하지 않는다.
3. Setup의 [Using owners](https://docs.privy.io/controls/authorization-keys/using-owners/overview), [Authorization signatures](https://docs.privy.io/api-reference/authorization-signatures), [Signing on the server](https://docs.privy.io/controls/authorization-keys/using-owners/sign/signing-on-the-server): API 인증 후에도 owner의 요청 서명이 필요할 수 있다. 사용자 JWT나 authorization private key를 context에 넣으면 공식 SDK가 서명을 계산한다. 직접 wallet authorization 프로토콜을 새로 구현하지 않는다.
4. Setup의 [Optimize your setup](https://docs.privy.io/recipes/dashboard/optimizing): 공개키를 설정하면 검증키 조회가 사라지며, 키 교체 때 설정을 갱신해야 한다. 사용자 정보가 필요하면 identity token으로 조회 요청을 줄일 수 있다. 429에는 backoff/jitter 같은 호출 정책을 고려한다.
5. [REST Setup](https://docs.privy.io/basics/rest-api/setup): HTTPS, Basic Auth, `privy-app-id`가 필요하다. 이 부분은 이미 공식 Java SDK가 구현한다.
6. [Access tokens](https://docs.privy.io/authentication/user-authentication/access-tokens): ES256로 서명한 JWT를 검증하고 issuer, app audience, subject, session, 발급·만료 시각을 확인한다. 만료된 토큰 갱신은 호출자 측 인증 SDK가 담당한다.
7. [Identity tokens](https://docs.privy.io/user-management/users/identity-tokens): 사용자 정보 전달용이며 access token 검증 메서드와 분리해야 한다. 현재 access 인증에서는 identity token의 `linked_accounts`와 session 누락을 거부하고, identity 데이터 조회 기능은 별도로 남긴다.
8. [User authentication security](https://docs.privy.io/security/authentication/user-authentication): backend는 access token으로 요청자를 확인하며, 실제 로그인·refresh flow와 local verification의 역할이 다르다.

문서에 등장하는 Node SDK의 `verifyAuthToken`을 Java API에 그대로 대입하지 않았다. Maven Central의 Java `0.59.0` sources JAR에서 `PrivyClient`, `PrivyUsersService`, `PrivyUtils`를 확인했으며 현재 해당 검증 메서드는 없다. 이에 Nimbus가 서명과 JOSE 처리를 담당하도록 추가했다.

Access token 페이지에는 ES256 설명과 Ed25519 공개키 설명이 함께 있지만, 실제 ES256 검증은 P-256 ECDSA 공개키를 사용해야 한다. [공식 Node 패키지의 검증 구현](https://unpkg.com/@privy-io/node@0.20.0/lib/auth.mjs)도 `ES256`, `typ=JWT`, `issuer=privy.io`, app audience를 사용한다. 이 구현에서는 공개키의 P-256 curve까지 확인한다.

JWKS URL을 추측하거나 JWT의 `jku`/`jwk`에서 가져오지 않는다. Privy Dashboard에서 해당 앱에 제공하는 URL을 서버 설정으로 받는다. JWKS 요청에는 server secret이나 사용자 토큰을 보내지 않는다. 토큰만 검증하는 서버는 app secret을 주입할 필요가 없다.

## 최적화 선택

- 서버 API 호출/JSON/Basic Auth는 공식 SDK를 재사용한다. Jackson 버전을 별도로 고정하지 않는다.
- JWT 검증은 공개키와 verifier를 재사용한다. 캐시 대상은 공개키이고 인증 성공이나 bearer token 자체는 아니다. 요청마다 현재 시각을 사용해 expiry를 검사한다.
- [Nimbus JWKSourceBuilder](https://connect2id.com/products/nimbus-jose-jwt/examples/enhanced-jwk-retrieval)의 캐시, 동시 갱신 공유, unknown-key 재조회, rate limiter를 사용한다. 독자적인 키 캐시나 서명 알고리즘을 만들지 않는다.
- JWKS 기본 정책은 5분 TTL, 30초 rate-limit 구간(최대 2회), connect/read 각각 5초, 128 KiB 한도다. 백그라운드 refresh는 비활성화해 idle 서비스의 조회와 별도 스레드 관리를 줄인다. TTL 만료 후에는 성공적으로 갱신한 키만 사용한다.
- 공개키 고정 방식은 네트워크 비용이 0이며, 재배포/설정 갱신으로 rotation을 처리한다. JWKS 방식은 회전 자동 대응이 필요한 운영 환경에 적합하다.
- 서명 이전 claim 검사는 거부 용도의 사전 검사다. 반환할 claim은 Nimbus 서명 검증 이후 다시 검사한다. 잘못된 issuer/audience/날짜/형식 때문에 네트워크 조회가 발생하지 않도록 한다.
- `verifyAppCredentials`는 사용자 조회 권한이 필요한 읽기 전용 `GET /v1/users?limit=1`을 한 번 수행한다. 생성자나 매 사용자 요청에서는 호출하지 않는다. 실패한 자격 증명을 재시도하지 않는다. 429는 `Retry-After`를 호출자에 전달해 서버 애플리케이션이 요청량에 맞게 정책을 결정한다.
- HTTP client를 재사용하고 SDK transport에서 요청 본문 수신 완료까지 deadline을 적용한다. 응답을 4 MiB로 제한하고 timeout/interrupt 시 HTTP 요청을 취소한다. 현재 scope에는 streaming API가 없다.

## 사용 시 구분해야 하는 결과

서명과 claim 검증만으로 실시간 세션 폐기나 사용자 삭제 여부까지 확인할 수는 없다. 즉시 폐기가 필요한 서비스는 session ID를 이용한 자체 denylist 등 별도 정책을 추가해야 한다. 이 SDK는 Privy 로그인 세션을 생성하거나 유지하지 않는다.

API 인증의 403은 사용자 조회 권한 부족일 수 있으므로 app secret이 잘못됐다는 뜻으로 처리하지 않는다. 키 갱신 실패도 사용자 토큰 위조와 구분한다. API 오류 body/exception cause는 외부에 전달하지 않으며, 토큰이나 secret을 로그로 남기지 않는다.

테스트는 실제 로그인 없이 생성한 키로 서명한 JWT와 로컬 API/JWKS 서버로 수행한다. 동시 최초 조회 공유, 키 rotation, unknown-key 조회 제한, 캐시 만료 후 장애, 위조/만료/claim 오류, secret 미노출, 서버 API status 및 HTTP deadline/interrupt를 검증한다. 실제 Privy 앱과의 smoke test는 사용자 환경의 credentials와 token이 준비되면 실행해야 한다.

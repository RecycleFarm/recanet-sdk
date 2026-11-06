# Recanet TypeScript SDK

Node.js 22 이상에서 사용하는 서버 SDK입니다. 현재 개발 중이며 npm에 게시하지 않았습니다.

기준은 [Recanet SDK 개발](https://chatgpt.com/space/page_6aeadd6e8810819197fd76ba1f3b3923)과
`recanet-java` 커밋 `37c78cfa01d9892ca26de61bb74df827923917cf`입니다.

```sh
npm ci
npm run check
npm run build
```

```ts
import { PrivyClient, memberExternalId } from 'recanet-typescript';

const client = new PrivyClient({ appId: 'your-app-id', appSecret: 'your-server-secret' });
// 서비스 시작 시 명시적으로 진단한다. 생성자는 네트워크를 호출하지 않는다.
await client.verifyAppCredentials();
const externalId = memberExternalId('service', 'member-1');
```

실제 비밀은 서비스의 비밀 저장소에서 주입하세요. SDK가 환경변수를 직접 읽지 않습니다.
요청은 자동 재시도하지 않으며 `AbortSignal`로 취소할 수 있습니다.
오류의 `code`, `statusCode`, 선택적 `retryAfterMs`(bigint)를 서비스에서 처리하세요.

사용자 access token은 appSecret 없이도 고정 공개키로 검증할 수 있습니다.

```ts
import { PrivyTokenVerifier } from 'recanet-typescript';

const verifier = new PrivyTokenVerifier('your-app-id', { publicKeyPem: verificationPublicKeyPem });
const user = await verifier.authenticateAuthorizationHeader(authorizationHeader);
// user.userId, user.sessionId, user.issuedAtMs, user.expiresAtMs
```

시각은 UTC epoch 밀리초 `bigint`입니다. 검증은 로그인·실시간 로그아웃/철회 조회나 회원 지갑 권한 확인을 대신하지 않습니다.
`PrivyClient`의 `tokenVerification`에도 같은 설정을 지정할 수 있습니다.

키 회전에 대응하려면 Dashboard의 신뢰한 JWKS URL을 명시합니다.

```ts
const verifier = new PrivyTokenVerifier('your-app-id', {
  jwksUrl: 'https://your-trusted-jwks-url',
});
```

JWKS는 첫 검증 시 조회하며 5분간 캐시합니다. 동시 조회는 공유하고 갱신은 30초 구간당 최대 2회로 제한합니다.
갱신 실패 시 만료된 캐시 키를 사용하지 않습니다. `KEY_SOURCE_UNAVAILABLE`은 토큰 오류와 구분해 처리하세요.

회원 지갑은 서비스별 namespace와 회원 ID로 조회하거나 생성합니다.

```ts
import { BackendWalletRegistration } from 'recanet-typescript';

// 최초 생성 후 안전하게 영속 보관하세요. 호출마다 새 키를 만들지 마세요.
const registration = BackendWalletRegistration.generate();
// 재시작 시에는 저장한 공개키·개인키로 new BackendWalletRegistration(publicPem, privatePem).
const members = client.userWallets(registration, 'service');
const wallet = await members.getOrCreateWallet('authenticated-member-id');
const existing = await members.findWallet('authenticated-member-id'); // 없으면 null
```

호출자는 회원 인증과 tenant 권한을 먼저 확인해야 합니다. 승인키는 블록체인 지갑의 개인키가 아닙니다.
생성은 자동 재전송하지 않으며, 생성 충돌(409)일 때만 다시 조회합니다.
`isBackendWallet`의 기존 public key 비교는 서명 권한 판정에 사용하지 마세요.

운영 지갑을 서명자로 사용하려면 승인키 목록에서 해당 지갑의 권한을 확인합니다.

```ts
const signer = await client.signerForWallet(wallet.id, registration);
const signature = await signer.signMessage('hello');
const hash = await signer.sendTransaction(421614, {
  to: recipientAddress,
  value: '0x0', data: '0x', gas: '0x5208', gasPrice: '0x1', nonce: '0x0',
}, 'stable-operation-id');
```

거래의 nonce·가스·금액은 호출자가 구성해야 합니다. 동일 지갑의 nonce 처리는 서비스에서 직렬화하고,
원본 거래와 operation ID를 함께 보관하세요. 반환 hash는 실행 성공이나 최종 확정을 뜻하지 않습니다.
서명·전송 오류는 `DmrvnError.code`로 구분하며, `RPC_UNAVAILABLE`도 미제출을 보장하지 않습니다.

구현 범위와 검증은 [개발 현황](docs/progress.md), 미결 사항은 [의사결정 목록](docs/decisions.md)을 참고하세요.

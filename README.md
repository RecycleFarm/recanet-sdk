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

구현 범위와 검증은 [개발 현황](docs/progress.md), 미결 사항은 [의사결정 목록](docs/decisions.md)을 참고하세요.

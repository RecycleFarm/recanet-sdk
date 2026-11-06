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

회원 서명은 `members.signMessage(userId, message)`, `signTypedData`, `sendTransaction`으로 요청할 수 있습니다.
지갑이 없으면 생성하지 않고 실패합니다. DMRVN 파트너 매핑은 명시적으로 선택합니다.

```ts
const beneficiaries = members.forPartner(101, async (partnerId, userId) => {
  return accessPolicy.isWalletUseAuthorized(partnerId, userId);
});
const beneficiarySigner = await beneficiaries.getOrCreateSigner(101, 'authenticated-member-id');
```

콜백은 최초 지갑 확보와 이후 모든 서명·전송 때 실행합니다. 서비스에서 인증된 파트너 범위·회원 동의·철회를
판단해야 합니다. 파트너 지갑은 기존 일반 회원 지갑과 별개이며 자동 연결하지 않습니다.

ETH 잔액과 전송은 Arbitrum Sepolia(chain ID 421614)에서 지원합니다.

```ts
import { AssetClient } from 'recanet-typescript';

const assets = new AssetClient(rpcUrl); // 또는 주입한 EvmRpc
const balanceWei = await assets.getBalance(signer.address);
const transferHash = await assets.transfer(signer, recipientAddress, 1000000000000000n, 'transfer-operation');
```

금액과 잔액은 정수 wei `bigint`입니다. 가스·가격·pending nonce를 조회해 한 번 제출합니다.
`SUBMISSION_UNRESOLVED`이면 원래 요청·지갑 서비스·체인에서 먼저 확인하세요.
같은 key로 이 함수를 다시 호출해도 같은 nonce·body가 만들어진다는 보장은 없습니다.

거래 상세와 상태는 앱 자격 증명 없이 조회합니다.

```ts
import { EvmTransactionClient } from 'recanet-typescript';

const transactions = new EvmTransactionClient(421614, rpcUrl);
const detail = await transactions.getTransaction(transferHash); // 미발견이면 null
const status = await transactions.getTransactionStatus(transferHash);
```

`SUCCEEDED`는 receipt의 실행 성공이며 합의/L1 최종 확정을 뜻하지 않습니다. 금액·블록 번호·확인 수는 `bigint`이고,
원본 transaction/receipt는 변경할 수 없는 snapshot입니다. 조회 오류는 `TransactionQueryError.code`로 처리하세요.

발신 거래 목록은 블록 탐색으로 조회합니다. 입력 범위는 다음 페이지에서도 같은 형태로 유지합니다.

```ts
const query = { fromBlock: 0n, toBlock: null, limit: 20 };
let cursor: string | null = null;
do {
  const page = await transactions.listTransactions(signer.address, { ...query, cursor });
  // page.transactions 처리
  cursor = page.nextCursor;
} while (cursor !== null);
```

한 페이지는 최대 100개 블록을 읽으므로 **빈 페이지라도 cursor가 있으면 계속** 조회합니다.
실제 지갑 사용 시작 블록부터 범위를 좁히세요. 입금·내부 호출·pending 목록은 포함하지 않습니다.
`CHAIN_CHANGED`이면 cursor 없이 새 snapshot부터 조회해야 합니다.

DMRVN의 순수 계산 계층은 `DmrvnCrypto`, `DmrvnJson`, `DmrvnAbi`로 제공합니다.
`DmrvnJson.parse`의 소수는 `DmrvnDecimal`이며 해시·복사에는 SDK의 JSON 함수를 사용하세요.
이 경로는 Java의 현재 바이트 규칙을 재현하며 전체 입력에서 표준 JCS와 동일하다는 뜻은 아닙니다.
동봉 ABI는 필요한 타입의 부분집합만 인코딩하며, 실제 거래를 자동 제출하지 않습니다.

`DmrvnProtocol`은 Claim·ForwardRequest·보고서의 EIP-712 digest, provenance 검증, committee/report hash와
제출 calldata를 계산합니다. 이 계산만으로 signer 권한·quorum·DMRVN 최종 검증 성공을 판단하지 않습니다.

구현 범위와 검증은 [개발 현황](docs/progress.md), 미결 사항은 [의사결정 목록](docs/decisions.md)을 참고하세요.

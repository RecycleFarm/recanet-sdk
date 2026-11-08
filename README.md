# Recanet TypeScript SDK

Node.js 22 이상에서 사용하는 서버 SDK입니다. 현재 개발 중이며 npm에 게시하지 않았습니다.

기준은 [Recanet SDK 개발](https://chatgpt.com/space/page_6aeadd6e8810819197fd76ba1f3b3923)과
`recanet-java` 커밋 `37c78cfa01d9892ca26de61bb74df827923917cf`입니다.

```sh
npm ci
npm ci --prefix tools/greenfield --ignore-scripts
npm run check
npm run build
npm run check:package
```

```ts
import { PrivyClient, memberExternalId } from 'recanet-typescript';

const client = new PrivyClient({ appId: 'your-app-id', appSecret: 'your-server-secret' });
// 서비스 시작 시 명시적으로 진단한다. 생성자는 네트워크를 호출하지 않는다.
await client.verifyAppCredentials();
const externalId = memberExternalId('service', 'member-1');
```

Privy 자격 증명은 서비스의 비밀 저장소에서 주입하세요. PrivyClient는 환경변수를 자동으로 읽지 않습니다.
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

`DeclaredMethodology`는 manifest와 원시 WASM hash를 확인하고, 호출자가 제공한 registry 함수로 활성을 조회합니다.
Evidence 본문을 만들 때는 운영자와 확인한 `evidenceSchemaVersion`을 명시해야 합니다. SDK는 WASM을 실행하거나
파트너 입력 프로필을 선택하지 않습니다. 현재 Evidence 계약의 미결 사항은 의사결정 문서에 남아 있습니다.

`DmrvnDeployment.fromManifest`는 승인된 배포 manifest를 정규화하고 `DmrvnConfig.fromDeployment`는
RPC·파트너·저장소 prefix·비용 한도를 결속합니다. 동봉 testnet 자료는 고정 스냅샷이며 현재 체인 준비 상태가 아닙니다.
과거 direct 배포는 읽기·복구용으로만 유지합니다.

`DmrvnPreflight`는 배포·운영자 역할·방법론·명시 Evidence 버전·잔액을 읽기 전용으로 확인합니다.
`ready=true`여도 Greenfield 쓰기/재읽기, 검증자 읽기 권한, 충분한 가스 잔액이나 Evidence 버전의 실제 수용을
입증하지 않습니다. `checks`의 미시험 항목과 오류를 함께 확인하세요.

`OperationJournal`은 선택적 단계 상태 경계이고 `MemoryOperationJournal`은 프로세스 내 휘발성 구현입니다.
재시작·다중 프로세스 복구를 제공하지 않습니다. `withLock` 콜백 안의 모든 비동기 작업은 완료까지 await하세요.
영속 adapter는 저장 완료·작업자 간 잠금·소유권 상실 후 부작용 차단과 배포 전체 claim 검색을 제공해야 합니다.

`FileOperationJournal(directory)`는 단일 호스트의 로컬 POSIX 파일에서 OS 잠금과 fsync·원자 교체로 상태를
보존합니다. 생성 시 디렉터리를 만들고 권한을 0700으로 설정하며 파일은 0600으로 씁니다. 같은 디렉터리의
모든 작업자는 동일 잠금 계약을 지켜야 합니다. `store`와 claim 검색은 대응 `withLock` 안에서만 가능합니다.
같은 key 재진입은 거부하며, 잠금 콜백 안의 모든 비동기 작업은 await하세요. NFS·분산 lease/fencing은 지원하지 않습니다.
잠금 대기에는 자체 timeout이 없으며 지원 OS·native 빌드/배포 경계는 아래와 의사결정 문서를 확인하세요.

`GreenfieldPublicReader`는 신뢰한 Storage Provider에서 공개 객체의 원시 bytes를 직접 읽습니다.
private 객체의 접근 권한을 제공하지 않으며, 결과 보고서의 hash·서명 검증은 별도 계층의 책임입니다.

NodeGreenfieldStorage는 동봉 공식 SDK worker로 private 객체 생성·업로드·읽기와 원래 생성 거래 확인을
실행합니다. rpcUrl·chainId·address·keyEnvironmentVariable을 명시하고, 필요하면 feeGranter·timeoutMs를
지정하세요. 저장소 키는 해당 환경에서 호출마다 읽어 전용 자식 환경 하나로 전달합니다.
부모 환경·EVM/Privy 자격 증명·stderr는 전달/반환하지 않습니다. validator 권한과 feegrant는 별도 운영 설정입니다.
고정 worker 의존성의 알려진 감사 결과와 업그레이드 미결 정책은
[Greenfield 의존성](docs/greenfield-dependencies.md)을 확인하세요.

`DmrvnClient.prepareEvidence`는 Evidence 서명·저장소 생성·업로드·sealed 재읽기를 단계 상태로 기록합니다.
운영 서명자·`GreenfieldStorage` 쓰기 adapter·방법론을 명시적으로 주입합니다. 생성 결과가 불확실하면
`recoverCreateTransaction`으로 원래 거래를 확인한 후 같은 작업을 재개하세요. intent를 지우거나 다른
작업 ID로 재생성하지 마세요. `operation` snapshot에는 재사용 가능한 서명이 있어 접근 권한 관리가 필요합니다.

`approveClaim`은 저장된 Evidence를 재읽고 파트너 승인 서명을 만듭니다. `prepare`는 Evidence 저장과 승인의
조합이며 Claim 거래를 전송하지 않습니다. 승인 실패 후에도 같은 작업의 nonce/deadline과 예약을 보존하며,
만료된 승인을 자동 갱신하지 않습니다. 저장된 승인의 반환은 현재 역할·만료·nonce의 재검증을 뜻하지 않습니다.

`prepareSponsored(operationId, gas)`는 beneficiary가 서명할 ForwardRequest를 고정합니다. gas는
`100000`..`2000000`의 십진 문자열이며 서명 대상 호출의 gas입니다. `recordSponsoredSignature`는
앱에서 받은 서명을 검증·저장하고 전송하지 않습니다. 같은 요청의 서명도 저장 후 교체할 수 없습니다.
`prepareSelfPaid`는 직접 제출용 calldata를 반환하기 전에 전송 intent를 기록합니다. 반환 유실 시에도
원래 거래를 먼저 확인해야 하며, 이미 선택한 직접 제출/대납 모드는 바꿀 수 없습니다.

`resolveSubmission(operationId, txHash?)`은 저장한 요청의 Claim·receipt·거래·이벤트를 확인하고 전송하지 않습니다.
hash가 없으면 승인 nonce로 제한된 블록 범위를 검색합니다. `SUBMISSION_UNRESOLVED`는 실패 증거가 아니므로
재전송하지 마세요. `CONFIRMED`는 Claim 접수 거래의 확인이며, 최종 DMRVN 판정은 저장된 `chainStatus`와 별개입니다.

`submitSponsored`는 저장한 beneficiary 요청·서명을 검증하고 비용·잔액·nonce·시뮬레이션을 확인한 뒤
완성 relay 거래와 intent를 저장해 한 번 전송합니다. 첫 반환은 `BROADCAST`이며 실행 성공을 뜻하지 않습니다.
intent 이후 재호출은 원래 거래를 조회합니다. 자동 replacement·fee bump·재전송은 제공하지 않습니다.

`submitActivity(beneficiarySigner, operationId, claimId, objectName, evidenceBody, gas)`는 위 단계를 조합합니다.
복구할 때 같은 operationId와 입력을 사용하세요. 최초 `BROADCAST` 뒤 자동 polling하지 않으며,
intent가 있으면 저장된 서명을 재사용해 조회합니다.

`submitActivity(wallets, new ActivityRequest(userId, sourceEventId, inputs, options))`는 파트너 권한 adapter로
회원 지갑을 확보하고 새 ID로 저장·승인·대납·접수 확인을 실행합니다. `wallets`는 `forPartner` 반환값 또는
`BeneficiaryWallets` 구현입니다. 기본 확인 대기는 60초이며 전송 결과가 나온 뒤부터 측정합니다.
반환 `outcome`은 `CONFIRMED`·`UNKNOWN`·`FAILED`이고, `confirmed`는 관찰 사실만 담습니다.
이 고수준 API를 재호출하면 **새 작업**입니다. UNKNOWN 후에는 반환 ID/hash와 journal로 원래 작업을 복구하세요.
명시 journal이 없으면 호출 종료 후 단계 상태의 자동 복구를 보장하지 않습니다.

`DmrvnReader`는 Privy 자격 증명 없이 확인 높이의 Claim과 보고 거래·파일을 검증합니다.
`readResult(claimId, fromBlock?, reportTxHash?, waitTimedOut?, expectedFileHash?)`는 자동 대기하지 않습니다.
`waitTimedOut`은 호출자의 표식이며 task 만료를 뜻하지 않습니다. 보고서 읽기에 실패해도 `chainStatus`를
보존하고 `reportError`를 반환하므로 `reportVerified`와 함께 확인하세요. 초기 체인/배포 오류는 전파됩니다.
`defaultReportResolver(chainId, bucket)`의 파일 경로는 `dmrvn/v4/reports/<hash>.json`입니다.
파일 checksum과 프로토콜 reportHash는 다르며, `metadataIndependentlyVerified`는 항상 false입니다.
`verifyEvidenceProvenance`는 별도로 제공받은 private Evidence bytes를 저장 Claim의 hash·approver와 대조합니다.

작업 client의 `readResult(operationId, reader, fromBlock?, reportTxHash?, waitTimedOut?)`는 관찰 결과와 오류를
journal에 보존하고 저장 Evidence의 출처를 추가 대조합니다. fromBlock을 자동 보완하지 않으며 외부 파일
commitment도 전달하지 않습니다. 외부 commitment 검증이 필요하면 독립 reader를 직접 호출하세요.
이 관찰 저장은 `resolveSubmission`의 거래 확인·nonce 예약 해제를 대신하지 않습니다.

check:package는 실제 npm tarball을 임시 소비자 프로젝트에 설치하고, Node 전용 strict 타입 컴파일과
ESM·ABI·native journal 실행을 검증합니다. npm install lifecycle은 실행하지 않고 종료 후 임시 프로젝트를
삭제합니다. 캐시는 RECANET_NPM_CACHE, 오프라인 실행은 RECANET_PACKAGE_OFFLINE=1로 지정할 수 있습니다.
같은 OS/arch에서 빌드한 native binary를 검사하며 다른 플랫폼 인수를 대신하지 않습니다.

구현 범위와 검증은 [개발 현황](docs/progress.md), 미결 사항은 [의사결정 목록](docs/decisions.md)을 참고하세요.
원본 C-01~C-12와 시험 증거의 대응, 실환경 실행에 필요한 승인 입력은 [인수 현황](docs/acceptance.md)에 정리했습니다.

소스 빌드는 TypeScript와 함께 영속 journal용 Node-API OS 잠금 컴포넌트를 컴파일합니다.
macOS/Linux에서 C compiler와 `node_api.h`가 필요합니다. 자동 검색이 안 되면 `RECANET_NODE_INCLUDE`를
해당 header 디렉터리로 지정하세요. 다른 OS/arch의 tarball을 사용할 때는 동봉 소스에 대해
`node scripts/build-native.mjs`로 다시 빌드해야 합니다. 플랫폼별 prebuild 배포 정책은 아직 결정되지 않았습니다.
pure/HTTP SDK import는 native 컴포넌트를 즉시 로드하지 않습니다.

PrivyClient.exportWalletPrivateKey(walletId, registration)는 요청마다 임시 HPKE 수신 키를 만들고
승인한 export 응답을 메모리에서 복호화해 블록체인 개인키 문자열을 반환합니다. 자동 로그·저장·회원 권한
판정은 하지 않습니다. 호출 서비스에서 반출 접근 제어와 안전한 보관을 담당해야 합니다.
exportAndLog 및 키를 자동 출력하는 초기화 편의 API는 채택하지 않았습니다.

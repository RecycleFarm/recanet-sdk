# @recyclefarm/recanet-sdk

Recanet 서버 SDK의 GitHub Packages 릴리스 버전은 `0.1.0-rc.2`다.

지원 런타임은 Node 22(`>=22 <23`)이며 ESM JavaScript와 TypeScript 선언을 제공한다. CI 검증 기준은 Ubuntu 24.04 Linux x64와 macOS 15 ARM64(Apple Silicon)다. 설치 허용 조합은 `linux/x64`와 `darwin/arm64`이며 Linux ARM64·Intel Mac·Windows는 지원하지 않는다. 다른 Linux 배포판·libc 또는 macOS 버전의 호환성은 별도 확인이 필요하다.

배포 패키지에는 Linux x64와 macOS ARM64용 Node-API v8 네이티브 바이너리를 모두 포함한다. 실행 시 OS·CPU에 맞는 파일을 선택한다. **패키지 사용자는 C compiler, Xcode Command Line Tools, Node headers가 필요 없다.** 설치 시 컴파일하거나 외부 바이너리를 다운로드하지 않으며 `--ignore-scripts`로 설치해도 지원 플랫폼에서 영속 journal을 사용할 수 있다.

## GitHub Packages에서 설치

GitHub Packages에서 설치하려면 GitHub 인증이 필요하다.

설치하는 계정의 classic PAT(`read:packages`)를 `GITHUB_PACKAGES_TOKEN` 환경변수에 설정한다. 설치할 프로젝트의 `.npmrc`에는 토큰 원문 대신 다음 두 줄을 추가한다.

```ini
@recyclefarm:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

```sh
npm install @recyclefarm/recanet-sdk@0.1.0-rc.2
npm ls @recyclefarm/recanet-sdk
```

토큰 원문은 환경변수 또는 CI Secrets로 제공한다.

## .tgz 패키지 설치

배포 담당자에게 받은 `recyclefarm-recanet-sdk-0.1.0-rc.2.tgz`를 사용할 Node 프로젝트 디렉터리에 복사한다. 아래 명령은 그 프로젝트 디렉터리에서 실행한다. 새 프로젝트라면 먼저 `npm init -y`로 `package.json`을 만든다. `.tgz`를 직접 풀거나 SDK 소스를 빌드할 필요는 없다.

```sh
# Node 22와 지원 OS·CPU인지 확인한다.
node -p 'JSON.stringify({ node: process.version, os: process.platform, cpu: process.arch })'

# 프로젝트 디렉터리에 복사한 패키지를 설치한다.
npm install ./recyclefarm-recanet-sdk-0.1.0-rc.2.tgz

# 설치된 버전을 확인한다.
npm ls @recyclefarm/recanet-sdk
```

환경 출력은 `node`가 `v22.*`, `os`/`cpu`가 `linux`/`x64` 또는 `darwin`/`arm64`여야 한다. 설치 버전은 `@recyclefarm/recanet-sdk@0.1.0-rc.2`이다. 다른 디렉터리에 있는 파일은 `npm install /패키지/절대경로/recyclefarm-recanet-sdk-0.1.0-rc.2.tgz`처럼 경로를 지정한다. npm은 SDK의 JavaScript 의존성을 설치하므로 해당 의존성을 받을 수 있는 Registry 접근이 필요하다.

보안 정책으로 lifecycle scripts를 실행하지 않는 프로젝트는 다음 명령으로 설치해도 된다. 두 설치 방법 모두 컴파일 도구 없이 영속 journal을 사용할 수 있다.

```sh
npm install --ignore-scripts ./recyclefarm-recanet-sdk-0.1.0-rc.2.tgz
```

이 설치 방식은 로컬 `.tgz` 파일을 참조하므로, 프로젝트를 다른 머신이나 CI로 옮길 때도 `package.json`/`package-lock.json`이 참조하는 위치에 같은 파일을 제공해야 한다. Registry에서 설치하는 프로젝트는 위의 GitHub Packages 설정을 사용한다.

## 설치 후 동작 확인

설치한 프로젝트 디렉터리에서 다음 명령을 실행한다. SDK import, 기본 클라이언트 생성, 네이티브 파일 잠금, journal 저장 및 새 인스턴스의 재조회를 확인한다. 실제 자격 증명은 필요 없으며 외부 서비스 요청·지갑 생성·거래 전송은 실행하지 않는다. 확인에 쓰는 임시 디렉터리는 종료 시 삭제한다.

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOperationJournal, PrivyClient } from '@recyclefarm/recanet-sdk';

new PrivyClient({ appId: 'installation-check', appSecret: 'installation-check' });
const directory = await mkdtemp(join(tmpdir(), 'recanet-install-check-'));
try {
  const journal = new FileOperationJournal(directory);
  await journal.withLock('installation-check', async () => {
    await journal.store('installation-check', { status: 'ok' });
  });
  const saved = await new FileOperationJournal(directory).load('installation-check');
  assert.equal(saved?.status, 'ok');
  console.log('Recanet SDK 설치 및 네이티브 journal 확인 완료');
} finally {
  await rm(directory, { recursive: true, force: true });
}
JS
```

종료 코드가 `0`이고 `Recanet SDK 설치 및 네이티브 journal 확인 완료`가 출력되면 성공이다. `.mjs` 대신 애플리케이션의 `.js` 파일에서 `import`를 사용하려면 해당 프로젝트의 `package.json`에 `"type": "module"`을 설정한다. 위 확인 명령은 `--input-type=module`을 사용하므로 이 설정 없이도 실행된다.

설치나 확인에 실패하면 다음을 확인한다.

- `EBADENGINE` 경고 또는 오류: `node --version`을 확인하고 Node 22로 실행한다. npm의 `engine-strict` 설정에 따라 경고 또는 설치 실패가 될 수 있다.
- `EBADPLATFORM` 또는 `Recanet SDK supports linux/x64 and darwin/arm64`: OS·CPU를 확인한다. Apple Silicon에서도 x64 Node를 사용하면 지원 조합에 해당하지 않으므로 ARM64 Node 22를 사용한다.
- `JOURNAL_UNAVAILABLE`: 두 플랫폼의 바이너리가 포함된 `.tgz`인지 확인하고 다시 설치한다. 영속 journal은 쓰기 권한이 있는 단일 호스트의 로컬 파일시스템에서 사용한다. 사용자 머신에서 native를 재빌드할 필요는 없다.

## 애플리케이션에서 사용

```ts
import { PrivyClient } from '@recyclefarm/recanet-sdk';
const client = new PrivyClient({ appId: 'your-app-id', appSecret: 'your-server-secret' });
```

위 값은 예시이며 실제 서버에서는 애플리케이션이 환경변수나 secret manager에서 자격 증명을 주입한다. SDK는 `.env` 파일을 자동으로 읽지 않는다. 생성자는 서비스 요청을 실행하지 않으며, 서버 자격 증명을 실제로 확인하려면 `await client.verifyAppCredentials()`를 명시적으로 호출한다.

주요 진입점은 다음과 같다.

| 기능 | API |
| --- | --- |
| 서버 자격 증명·사용자 토큰 검증 | `PrivyClient`, `PrivyTokenVerifier` |
| 백엔드 지갑 등록·조회·키 export | `PrivyClient`, `BackendWalletRegistration` |
| 서비스 회원 지갑 조회·생성·서명 | `client.userWallets(registration, namespace)` |
| ETH 잔액·전송 / EVM 거래 조회 | `AssetClient` / `EvmTransactionClient` |
| DMRVN 제출·조회 / Greenfield / 영속 journal | `DmrvnClient`, `DmrvnReader`, `NodeGreenfieldStorage`, `FileOperationJournal` |

`AssetClient`의 현재 자산은 Arbitrum Sepolia(chain ID `421614`)의 네이티브 ETH다. `EvmTransactionClient`는 지정한 EVM 체인의 거래를 조회하며, 지갑 목록은 해당 주소가 보낸 최상위의 채굴된 거래를 RPC 블록 탐색으로 찾는다. 전체 입출금 내역 인덱서가 아니다.

지갑 생성·키 export·서명·전송·Greenfield 쓰기는 실제 외부 동작이므로 애플리케이션의 인증·권한 및 요청 검증을 먼저 수행한다. `BackendWalletKeyPair.generateAndLog()`와 `exportWalletPrivateKeyAndLog()`는 개인키를 출력한다. `ensureBackendWallet()`도 backend 키 환경변수 두 개 중 하나라도 비어 있으면 새 키를 생성·로그 출력한다. 일반 초기화에서는 키를 미리 영속 보관해 명시적으로 주입한다. DMRVN은 운영자가 확인한 Evidence 버전과 파트너 권한 어댑터가 필요하며, 생성자가 임의의 버전을 선택하지 않는다.

## Greenfield 추가 설치

Greenfield를 사용할 때만 별도 worker 의존성을 설치한다. SDK를 설치한 프로젝트 디렉터리에서 실행한다. 위 설치 후 동작 확인에는 이 단계가 필요 없다.

```sh
npm ci --prefix node_modules/@recyclefarm/recanet-sdk/tools/greenfield --omit=dev --ignore-scripts
```

SDK의 ethers6와 worker의 ethers5는 분리되어 있다. worker에는 보안 수정된 로컬 호환 모듈을 동봉하며 THIRD_PARTY_NOTICES에서 출처를 확인할 수 있다.

## SDK 소스 개발 및 패키징

다음 명령은 `.tgz` 소비자 프로젝트가 아니라 **SDK 소스 저장소 루트**에서 실행한다. Node 22, JDK 17(잠금 상호운용 시험용), C compiler, Node-API headers가 필요하다. macOS에서는 Xcode Command Line Tools를 사용한다. headers 자동 탐색이 실패하면 `RECANET_NODE_INCLUDE`에 `node_api.h`가 있는 디렉터리를 지정한다.

```sh
npm ci --prefix sdks/typescript
npm ci --prefix sdks/typescript/tools/greenfield
npm --prefix sdks/typescript run check
npm --prefix sdks/typescript run test:security
```

`npm run build`는 해당 SDK 디렉터리에서 실행하는 명령이며 현재 플랫폼의 `prebuilds/<os>-<cpu>/`만 생성한다. 배포용 `npm pack`, `check:package`, 루트의 `make typescript-check`에는 **두 플랫폼 산출물이 모두 필요**하다. `prebuilds/`는 Git에 포함되지 않는다.

CI의 `TypeScript native prebuilds`가 각 OS에서 같은 native 소스를 빌드하고 실제 OS 잠금을 시험한다. TypeScript CI·공통 계약 CI·릴리스 workflow는 두 artifact를 자동으로 모은다. 로컬에서 패키징하려면 GitHub CLI와 해당 저장소의 artifact 다운로드 권한이 필요하다. 다음 명령은 저장소 루트에서 실행하며 `RUN_ID`는 아래 목록에서 고른 성공 실행 번호로 바꾼다. 두 `recanet-native-*` artifact가 있고 현재 `native/posix-lock.c`와 소스 해시가 같은 실행을 선택한다. 문서만 검사하고 SDK 검사를 생략한 실행에는 해당 artifact가 없을 수 있다.

```sh
gh run list --repo RecycleFarm/recanet-sdk --workflow typescript-ci.yml --status success --limit 10
# RUN_ID를 실제 실행 번호로 바꾼다.
RECANET_NATIVE_ARTIFACTS="$(mktemp -d)"
gh run download RUN_ID --repo RecycleFarm/recanet-sdk --pattern 'recanet-native-*' --dir "$RECANET_NATIVE_ARTIFACTS"
mkdir -p sdks/typescript/prebuilds
cp -R "$RECANET_NATIVE_ARTIFACTS/recanet-native-ubuntu-24.04/linux-x64" sdks/typescript/prebuilds/
cp -R "$RECANET_NATIVE_ARTIFACTS/recanet-native-macos-15/darwin-arm64" sdks/typescript/prebuilds/
node sdks/typescript/scripts/check-prebuilds.mjs
rm -rf "$RECANET_NATIVE_ARTIFACTS"

npm --prefix sdks/typescript run check:package
# 배포용 .tgz는 staging/typescript에 생성한다.
mkdir -p staging/typescript
(cd sdks/typescript && npm pack --pack-destination ../../staging/typescript)
```

`check:package`는 tarball을 임시 프로젝트에 일반 설치한 뒤 strict TypeScript 컴파일과 journal 실행을 확인하고, `--ignore-scripts` 재설치 후 다시 실행한다. `prepack`은 두 바이너리의 형식·CPU·소스 및 바이너리 해시를 확인한다. 오래된 native 소스의 artifact나 한 플랫폼만 있는 상태로는 패키징할 수 없다. 소스 코드가 변경됐다면 먼저 빌드·검증하며, 헤더·컴파일러 요구는 이 개발 경로에만 해당한다.

패키지에는 내부 문서와 source map을 포함하지 않는다. 두 플랫폼의 native 바이너리와 필요한 runtime JS·타입·resources·worker를 포함한다. 영속 journal은 단일 호스트 로컬 파일시스템을 전제로 한다.

Registry에서의 이름 기반 설치와 journal 실행을 Linux x64와 macOS ARM64의 Node 22에서 검증했다. [Registry 설치 검증 결과](https://github.com/RecycleFarm/recanet-sdk-distribution/actions/runs/44219967674)

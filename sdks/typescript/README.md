# @recyclefarm/recanet-sdk

Recanet 파트너용 서버 SDK의 0.1.0-rc.1 PoC 후보다. 아직 Registry에 발행하지 않았으며 private=true로 발행을 막고 있다.

지원 환경은 Ubuntu24.04 Linux x64 또는 macOS ARM64(Apple Silicon), Node22다. ESM JavaScript와 TypeScript 선언을 제공한다. Linux ARM64·Intel Mac·Windows 설치는 지원하지 않는다.

배포 패키지에는 Linux x64와 macOS ARM64용 Node-API v8 네이티브 바이너리를 모두 포함한다. 실행 시 OS·CPU에 맞는 파일을 선택한다. **패키지 사용자는 C compiler, Xcode Command Line Tools, Node headers가 필요 없다.** 설치 시 컴파일하거나 외부 바이너리를 다운로드하지 않으며 `--ignore-scripts`로 설치해도 지원 플랫폼에서 영속 journal을 사용할 수 있다.

## .tgz 패키지 설치

배포 담당자에게 받은 `recyclefarm-recanet-sdk-0.1.0-rc.1.tgz`를 사용할 Node 프로젝트 디렉터리에 복사한다. 아래 명령은 그 프로젝트 디렉터리에서 실행한다. 새 프로젝트라면 먼저 `npm init -y`로 `package.json`을 만든다. `.tgz`를 직접 풀거나 SDK 소스를 빌드할 필요는 없다.

```sh
# Node 22와 지원 OS·CPU인지 확인한다.
node -p 'JSON.stringify({ node: process.version, os: process.platform, cpu: process.arch })'

# 프로젝트 디렉터리에 복사한 패키지를 설치한다.
npm install ./recyclefarm-recanet-sdk-0.1.0-rc.1.tgz

# 설치된 버전을 확인한다.
npm ls @recyclefarm/recanet-sdk
```

환경 출력은 `node`가 `v22.*`, `os`/`cpu`가 `linux`/`x64` 또는 `darwin`/`arm64`여야 한다. 설치 버전은 `@recyclefarm/recanet-sdk@0.1.0-rc.1`이다. 다른 디렉터리에 있는 파일은 `npm install /패키지/절대경로/recyclefarm-recanet-sdk-0.1.0-rc.1.tgz`처럼 경로를 지정한다. npm은 SDK의 JavaScript 의존성을 설치하므로 해당 의존성을 받을 수 있는 Registry 접근이 필요하다.

보안 정책으로 lifecycle scripts를 실행하지 않는 프로젝트는 다음 명령으로 설치해도 된다. 두 설치 방법 모두 컴파일 도구 없이 영속 journal을 사용할 수 있다.

```sh
npm install --ignore-scripts ./recyclefarm-recanet-sdk-0.1.0-rc.1.tgz
```

이 설치 방식은 로컬 `.tgz` 파일을 참조하므로, 프로젝트를 다른 머신이나 CI로 옮길 때도 `package.json`/`package-lock.json`이 참조하는 위치에 같은 파일을 제공해야 한다. 현재 Registry 발행 전이므로 패키지 이름만 지정하는 `npm install @recyclefarm/recanet-sdk`는 이 후보의 설치 방법이 아니다.

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

- `EBADENGINE`: `node --version`을 확인하고 Node 22로 실행한다.
- `EBADPLATFORM` 또는 `Recanet SDK supports linux/x64 and darwin/arm64`: OS·CPU를 확인한다. Apple Silicon에서도 x64 Node를 사용하면 지원 조합에 해당하지 않으므로 ARM64 Node 22를 사용한다.
- `JOURNAL_UNAVAILABLE`: 두 플랫폼의 바이너리가 포함된 `.tgz`인지 확인하고 다시 설치한다. 영속 journal은 쓰기 권한이 있는 단일 호스트의 로컬 파일시스템에서 사용한다. 사용자 머신에서 native를 재빌드할 필요는 없다.

## 애플리케이션에서 사용

```ts
import { PrivyClient } from '@recyclefarm/recanet-sdk';
const client = new PrivyClient({ appId: 'your-app-id', appSecret: 'your-server-secret' });
```

실제 지갑 생성·키 반출·전송·Greenfield 쓰기에는 별도 승인된 설정과 권한이 필요하다. 생성자는 서비스 요청을 실행하지 않는다.

## Greenfield 추가 설치

Greenfield를 사용할 때만 별도 worker 의존성을 설치한다. SDK를 설치한 프로젝트 디렉터리에서 실행한다. 위 설치 후 동작 확인에는 이 단계가 필요 없다.

```sh
npm ci --prefix node_modules/@recyclefarm/recanet-sdk/tools/greenfield --omit=dev --ignore-scripts
```

SDK의 ethers6와 worker의 ethers5는 분리되어 있다. worker에는 보안 수정된 로컬 호환 모듈을 동봉하며 THIRD_PARTY_NOTICES에서 출처를 확인할 수 있다.

## SDK 소스 개발 및 패키징

소스 저장소에서 SDK를 개발·빌드하는 경우에만 C compiler와 Node headers가 필요하다. `npm run build`는 현재 플랫폼의 `prebuilds/<os>-<cpu>/`를 생성한다. 배포용 `npm pack`에는 두 플랫폼의 바이너리가 모두 필요하며, CI가 각 OS에서 빌드·실행 검증한 파일을 모은다. `prepack`에서 바이너리 형식·CPU·소스와 바이너리 해시를 확인하고 누락되거나 오래된 파일은 거부한다.

패키지에는 내부 문서와 source map을 포함하지 않는다. 두 플랫폼의 native 바이너리와 필요한 runtime JS·타입·resources·worker를 포함한다. 영속 journal은 단일 호스트 로컬 파일시스템을 전제로 한다.

설치와 접근 안내는 [파트너 배포 저장소](https://github.com/RecycleFarm/recanet-sdk-distribution)를 참조한다. 현재 파트너 Registry 설치 검증은 미완료다.

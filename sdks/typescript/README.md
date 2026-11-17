# @recyclefarm/recanet-sdk

Recanet 파트너용 서버 SDK의 0.1.0-rc.1 PoC 후보다. 아직 Registry에 발행하지 않았으며 private=true로 발행을 막고 있다.

지원 환경은 Ubuntu24.04 Linux x64 또는 macOS ARM64(Apple Silicon), Node22다. ESM JavaScript와 TypeScript 선언을 제공한다. Linux ARM64·Intel Mac·Windows 설치는 지원하지 않는다.

배포 패키지에는 Linux x64와 macOS ARM64용 Node-API v8 네이티브 바이너리를 모두 포함한다. 실행 시 OS·CPU에 맞는 파일을 선택한다. **패키지 사용자는 C compiler, Xcode Command Line Tools, Node headers가 필요 없다.** 설치 시 컴파일하거나 외부 바이너리를 다운로드하지 않으며 `--ignore-scripts`로 설치해도 지원 플랫폼에서 영속 journal을 사용할 수 있다.

소스 저장소에서 SDK를 개발·빌드하는 경우에만 C compiler와 Node headers가 필요하다. `npm run build`는 현재 플랫폼의 `prebuilds/<os>-<cpu>/`를 생성한다. 배포용 `npm pack`에는 두 플랫폼의 바이너리가 모두 필요하며, CI가 각 OS에서 빌드·실행 검증한 파일을 모은다. `prepack`에서 바이너리 형식·CPU·소스와 바이너리 해시를 확인하고 누락되거나 오래된 파일은 거부한다.

```ts
import { PrivyClient } from '@recyclefarm/recanet-sdk';
const client = new PrivyClient({ appId: 'your-app-id', appSecret: 'your-server-secret' });
```

실제 지갑 생성·키 반출·전송·Greenfield 쓰기에는 별도 승인된 설정과 권한이 필요하다. 생성자는 서비스 요청을 실행하지 않는다.

Greenfield를 사용할 때는 설치된 패키지의 tools/greenfield 디렉터리에서 `npm ci --omit=dev --ignore-scripts`로 별도 worker 의존성을 설치한다. SDK의 ethers6와 worker의 ethers5는 분리되어 있다. worker에는 보안 수정된 로컬 호환 모듈을 동봉하며 THIRD_PARTY_NOTICES에서 출처를 확인할 수 있다.

패키지에는 내부 문서와 source map을 포함하지 않는다. 두 플랫폼의 native 바이너리와 필요한 runtime JS·타입·resources·worker를 포함한다. 영속 journal은 단일 호스트 로컬 파일시스템을 전제로 한다.

설치와 접근 안내는 [파트너 배포 저장소](https://github.com/RecycleFarm/recanet-sdk-distribution)를 참조한다. 현재 파트너 Registry 설치 검증은 미완료다.

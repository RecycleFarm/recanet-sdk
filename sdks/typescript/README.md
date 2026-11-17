# @recyclefarm/recanet-sdk

Recanet 파트너용 서버 SDK의 0.1.0-rc.1 PoC 후보다. 아직 Registry에 발행하지 않았으며 private=true로 발행을 막고 있다.

첫 PoC 지원은 Ubuntu24.04 Linux x64와 Node22다. ESM JavaScript와 TypeScript 선언을 제공한다. 다른 OS/CPU 설치는 지원하지 않는다.

```ts
import { PrivyClient } from '@recyclefarm/recanet-sdk';
const client = new PrivyClient({ appId: 'your-app-id', appSecret: 'your-server-secret' });
```

실제 지갑 생성·키 반출·전송·Greenfield 쓰기에는 별도 승인된 설정과 권한이 필요하다. 생성자는 서비스 요청을 실행하지 않는다.

Greenfield를 사용할 때는 설치된 패키지의 tools/greenfield 디렉터리에서 `npm ci --omit=dev --ignore-scripts`로 별도 worker 의존성을 설치한다. SDK의 ethers6와 worker의 ethers5는 분리되어 있다. worker에는 보안 수정된 로컬 호환 모듈을 동봉하며 THIRD_PARTY_NOTICES에서 출처를 확인할 수 있다.

패키지에는 내부 문서와 source map을 포함하지 않는다. 플랫폼별 native 파일과 필요한 runtime JS·타입·resources·worker를 포함한다. 영속 journal은 단일 호스트 로컬 파일시스템을 전제로 한다.

설치와 접근 안내는 [파트너 배포 저장소](https://github.com/RecycleFarm/recanet-sdk-distribution)를 참조한다. 현재 파트너 Registry 설치 검증은 미완료다.

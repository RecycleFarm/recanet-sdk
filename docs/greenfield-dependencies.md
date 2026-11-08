# Greenfield 의존성 의사결정

이 문서는 운영 채택 승인이 아니다. Java 기준 worker와 lockfile의 호환성 기준을 기록한다.

| 의존성 | 고정 버전 |
| --- | --- |
| @bnb-chain/greenfield-js-sdk | 2.2.2 |
| @bnb-chain/reed-solomon | 1.1.4 |
| ethers (worker 전용) | 5.8.0 |

SDK 본체의 ethers 6.17.0과 worker 의존성은 별도 디렉터리/프로세스로 분리한다.
worker는 Java commit 37c78cfa01d9892ca26de61bb74df827923917cf의 원본 사본이며 SHA-256은
e342ea90d687c9cef9a9d628705a6ef4a40fb1f38bbdefcd84782eee81d70305다.

설치 후 최초로 실행한 npm audit은 28건(low 16, moderate 4, high 8, critical 0)을 보고했다.
이는 감사 DB 시점의 보고이며, 테스트 통과나 프로세스 격리로 취약점이 해소됐다는 뜻은 아니다.
실제 경로에는 greenfield-cosmos-types → protobufjs, stargate 및
follow-redirects/lodash.set/ws가 포함된다. elliptic 6.6.1도 low 항목으로 보고됐다.
중첩된 여러 버전이 있을 수 있으므로 최상위 node_modules 버전 하나만으로 전체 경로를 판단하지 않는다.

재현:

    npm ci --prefix tools/greenfield --ignore-scripts
    npm audit --prefix tools/greenfield --json
    npm ls --prefix tools/greenfield --all

검토할 근거:

- [protobufjs code injection advisory](https://github.com/advisories/GHSA-66ff-xgx4-vchm)
- [lodash.set prototype pollution advisory](https://github.com/advisories/GHSA-p6mc-m468-83gw)
- [follow-redirects credential advisory](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)
- [elliptic implementation advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84)

결정할 내용은 공식 SDK 교체 버전, 호환 가능한 transitive override, 검증한 보안 fork의 허용 여부와
그에 따른 거래 wire·체크섬·서명·오류 사실의 재인수 범위다. audit의 자동 수정 제안 중 SDK 0.2.3이나
ethers 6 전환은 현재 worker API를 바꾸므로 무조건 적용하지 않는다.
운영 키 사용 및 외부 서비스 인수 전에 이 정책과 공급자 수용 결과를 별도로 확인해야 한다.
현재 시험은 고정 공개 시험키와 합성 SDK/RPC 응답만 사용한다.

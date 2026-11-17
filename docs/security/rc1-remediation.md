# 0.1.0 rc.1 보안 수정 기록

2026-11-17. 원본 recanet-java/recanet-typescript 저장소를 변경하지 않고 Monorepo에만 반영했다. 실제 패키지 발행과 요금제 변경은 하지 않는다.

## Java 의존성

Jackson BOM/databind/core와 datatype 모듈을2.22.4 유지보수 버전으로 정렬했다. Bouncy Castle은 bcprov-jdk15to18:1.85 하나로 통일하고 Privy의 bcprov-jdk18on:1.80 전이 의존성을 제외했다. Privy 및 그 외 깨끗한 의존성은 유지했다.

실제 resolve 결과는13개에서12개로 줄었고 BC provider는 하나다. 수정 후 OSV 조회에서 이12개 구성요소의 알려진 권고가0건이었다. 기존 고유12건과 중복 provider 문제를 처리한 결과이며, 향후 새 권고나 애플리케이션 전체의 무취약을 보증하지 않는다.

## Greenfield 의존성

공식 SDK2.2.2와 ethers5 API를 유지했다. protobufjs7.6.6, fast-xml-parser5.12.1, follow-redirects1.16.3, qs6.17.1, ws8.23.0을 고정 override하고 양쪽 worker lockfile을 갱신했다. protobuf6의 기존 고정 wire bytes, XML 응답 형태와 ethers5의 실제 로컬 WebSocket JSON-RPC 통신을 회귀 검사한다.

공식 최신 패키지에도 남은 두 문제는 아래처럼 명시적인 로컬 호환 모듈로 처리했다. 감사 결과만 깨끗하게 보이도록 이름을 바꾸거나 위험을 수용한 것은 아니다. 실제 수정과 파일 hash 검증·독립 회귀 시험을 모두 수행한다.

### elliptic CVE 2025 14505

원본 elliptic6.6.1은 GHSA-848j-6mx2-7j84에 대해 공식 수정 버전이 없다. vendored @recyclefarm/recanet-elliptic:6.6.1-recanet.1에서 RFC6979의 생성 nonce를 정수로 바꾸기 전 고정 byte width를 보존하도록 수정했다. custom nonce callback은 기존 입력 해석을 유지한다.

원본 runtime 파일 중 바뀐 것은 lib/elliptic/ec/index.js 하나다. `_truncateToN(k, true)`에 생성 byte 폭을 전달하는 제한된 수정이다. upstream MIT license와 npm integrity, 원본/수정 파일 SHA256을 [검토 manifest](compatibility-forks.json)에 보존했다.

P-521의 첫 nonce byte가0인 고정 공개 입력을 찾아 구버전 오류 경로와 수정 결과가 다름을 확인하고, 수정 결과는 별도 구현인 @noble/curves와 r/s 값까지 일치하는지 시험한다. 기존 SDK가 사용하는 secp256k1/P-256의 결정적 서명도 별도 구현과 대조한다. 새 암호 알고리즘을 설계하지 않았으며 이 검증을 정식 암호 인증이나 외부 서비스 인수로 해석하지 않는다.

[원본 이슈](https://github.com/indutny/elliptic/issues/321), [원본6.6.1 구현](https://github.com/indutny/elliptic/blob/v6.6.1/lib/elliptic/ec/index.js).

### lodash.set prototype pollution

수정 버전이 없는 lodash.set4.3.2를 그대로 올리지 않고, 유지보수되는 lodash4.18.1의 set으로 위임하는 작은 호환 모듈을 사용한다. 정상 중첩/배열 경로와 __proto__/constructor.prototype 오염 거부를 시험한다. runtime lodash의 MIT license는 npm 설치 시 그대로 보존된다.

## 지속 검증

양쪽 worker의 npm audit 결과는 기존28건에서0건으로 줄었고 SDK 본체도0건이다. 하지만 Registry 감사는 로컬 fork의 수정을 자동 판정하지 못한다. 따라서 다음을 함께 요구한다.

1. 수정 provenance와 모든 vendored runtime 파일의 고정 SHA256.
2. 양쪽 worker의 보안 회귀6개와 기존 worker 테스트.
3. npm audit 및 Java OSV 조회 성공. 네트워크/조회 실패도 통과로 취급하지 않음.
4. 같은 commit의 security report가 있어야 후보 생성. 후보 manifest에 report hash와 로컬 수정 권고를 기록.

외부 발행 전에는 이 로컬 호환 모듈의 유지보수 책임을 인수해야 한다. 향후 upstream 공식 수정이 나오면 제거 가능성을 검토하고 같은 벡터로 재검증한다. 예외 allowlist나 advisory 무시 설정은 추가하지 않았다.

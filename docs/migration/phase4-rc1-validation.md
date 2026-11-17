# Linux x64 0.1.0 rc.1 후보 검증

확인일: 2026-11-17 KST. 사용자 승인에 따라 패키지 이름·버전·Linux x64 범위와 제외 파일을 적용하고, 보안 수정 후 새 후보를 검증했다. 실제 Registry 발행·GitHub Release·파트너 초대·요금제 변경은 하지 않았다.

## 최종 후보

| SDK | 좌표 | 검증된 후보 실행 |
| --- | --- | --- |
| Java | com.youngminkim.recanet:recanet-java:0.1.0-rc.1 | [Java 후보](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44022832174) |
| TypeScript | @recyclefarm/recanet-sdk@0.1.0-rc.1 | [npm 후보](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44022842828) |

후보 source commit은 `64200672c39fa9b038be93572d2321a56acd0aa9`다. 같은 version의 이전 내부 후보와 구분해 이 run ID·source commit·digest를 사용한다. 앞선22c8a99 Java 후보는 설치 부산물 제외를 보완하며 대체했다. 실제 공개 버전을 덮어쓴 것이 아니며 Registry에는 발행한 적이 없다.

후보의 모든 SHA256SUMS, 내부 manifest의 source/version/platform, 별도 보안 보고서 hash를 다운로드 후 확인했다. actual published와 publishReady는 모두 false다. npm private=true를 발행 보류 장치로 유지했고 publisher 권한/토큰은 추가하지 않았다.

## 검증 결과

| 항목 | 결과 |
| --- | --- |
| [Java CI](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44022742674) | Ubuntu24.04 x64/JDK17/Node22에서 성공 |
| Java JUnit | XML14개에서126개, 실패/오류/skip0 |
| Java worker / 보안 회귀 | 기존8개 + 보안6개 통과. 로컬 WASM·예제 컴파일도 통과 |
| [TS CI](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44022742771) | Ubuntu24.04 x64/Node22에서 성공 |
| TS 본체 / worker / 보안 회귀 | 267개 / 14개 / 6개 통과, 실패0 |
| CI·staging 규칙 | 19개 통과, actionlint 통과 |
| 공개 API | Java66개 class entry의 public 선언, TS59개 선언파일이 원래 baseline과 동일 |
| npm 소비자 | 새 scope/name의 tarball 설치, strict Node 타입, ESM/native journal 실행, 동봉 worker의 production 의존성 설치 통과 |
| Maven 소비자 | 실제 후보 Maven file repository에서 Gradle module/POM-only 각각 resolve·컴파일·실행 성공 |
| Java runtime dependency | 소비자에서도 BC1.85 한 개, Jackson core/databind/datatype2.22.4 정렬 확인 |
| Java worker 압축물 | npm ci --omit=dev --ignore-scripts 후 Node22에서 runtime 모듈 로드 성공 |
| 원본 이력 | 원래 refs·SHA와 고정 import tree·조상 관계 보존. 원본 원격 heads 변화 없음 |

주요 CI와 후보 생성·npm 소비자 검증은 Linux x64에서 수행했다. 추가 Maven file repository 소비자와 worker 압축물 설치 점검은 개발 머신 macOS/JDK17/Node22에서 수행했다. 이를 macOS PoC 배포 지원으로 해석하지 않는다. 실제 외부 GitHub Packages 설치·토큰 회수 검증은 미실행이다.

## 제외 파일과 플랫폼

Java 후보는 binary JAR·public Javadoc JAR·POM·Gradle module metadata와 별도 Greenfield worker runtime 압축물이다. source JAR와 sources variant가 없고 JAR에 Java 소스나 source map도 없다. worker에는 runtime JS·lockfile·로컬 호환 모듈·필수 license만 두고 내부 문서·테스트·설치 부산물을 제외했다. worker 설치에는 Node22와 별도 npm ci가 필요하다.

npm 후보의 os/cpu는 linux/x64, Node 범위는22다. native가 Linux x64 ELF인지 확인했다. docs/ 내부 문서와 모든 .map, root의 파트너 README 이외의 Markdown, node_modules 설치 부산물은 없다. 필요한 runtime JS·타입·ABI/resource·native·worker·보안 수정 모듈·제3자 고지는 유지한다. 의존성을 설치한 뒤 제3자 패키지에 포함되는 문서까지 모두 제거한다는 뜻은 아니다.

## 보안 처리와 범위

Java의 기존 고유 권고12건과 BC 중복을 처리했다. 실제 runtime12개 OSV 조회에서 알려진 미해결 권고0건, BC provider1개다. SDK 본체와 양쪽 Greenfield worker의 npm audit도0건이다.

이 결과에는 로컬 호환 모듈2개가 포함된다. 공식 수정 버전이 없는 elliptic의 nonce width 오류를 제한적으로 고치고, lodash.set은 유지보수되는 lodash의 안전한 setter로 대체했다. 원본 provenance·MIT license·파일 hash와 P-521 오류 재현/독립 구현 대조, 기존 secp256k1/P-256 서명, protobuf wire bytes·XML·WebSocket 호환성 시험을 보존했다. [상세 수정](../security/rc1-remediation.md), [로컬 패치 hash](../security/compatibility-forks.json).

npm registry 감사는 로컬 fork의 실제 수정을 자동 판정하지 않는다. 따라서0건만을 근거로 삼지 않고 hash와 독립 회귀 시험을 함께 요구한다. 공식 Greenfield2.2.2의 API 호환을 유지해 상위 CosmJS0.32의 deprecation 경고 자체는 남아 있다. 해당 의존성의 elliptic은 검토한 fork로 resolve되며, 향후 공식 SDK/암호 모듈 교체와 유지보수 책임은 별도로 관리해야 한다. [상위 프로젝트 이슈](https://github.com/cosmos/cosmjs/issues/1708).

현재 알려진 권고 처리와 회귀 검증 결과이며 정식 암호 인증, 모든 향후 취약점 제거, 실서비스 validator/Privy/Greenfield 인수의 증거는 아니다. 실제 지갑 생성·키 export·거래 전송·스토리지 쓰기는 실행하지 않았다.

## 발행 보류 상태

배포용 저장소의 확정 좌표·version·Linux 범위·제외 파일 정책만 갱신했다. publishingEnabled=false, npm private=true, partnerInstallationVerified=false를 유지한다. 실제 발행 승인·발행 인증/권한·이용 조건·외부 파트너 계정 검증은 별도다. 원본 두 저장소와 조직 Free 요금제는 그대로다.

전체 실행·metadata·파일별 checksum·보안 결과는 [검증 JSON](phase4-rc1-validation.json)에 있다. 후보는 유한 보관 Actions artifact이므로 실제 발행 전에는 이 정확한 후보와 당시 최신 보안 상태를 다시 확인해야 한다.

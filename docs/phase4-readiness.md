> 현재 TypeScript 설치 지원은 Linux x64와 macOS ARM64·Node22다. 아래 Linux 전용 후보와 native 제약은 확장 전 기록이다. 현재 tarball은 두 플랫폼의 사전 빌드 native를 포함하며 사용자 설치에서는 컴파일하지 않는다. [현재 호환성](compatibility.md)과 [설치 안내](../sdks/typescript/README.md)를 따른다.

# Phase 4 배포 준비와 배포 전 결정

확인일: 2026-11-17 KST. 상태: 초기 준비 기록과 현재 결정 상태. D1~D4 및 보안 수정 후 rc.1 후보 검증은 사용자 승인으로 반영했다. 발행 권한·토큰·파트너 접근과 실제 패키지 발행은 계속 보류한다.

사용자는 이후 D1~D4와 보안 수정 후 새 후보 검증을 승인했다. 현재 적용·검증 결과는 [Linux x64 rc.1 후보 보고서](migration/phase4-rc1-validation.md)를 기준으로 한다. 아래 초기 조사와 남은 승인 조건은 시점을 구분한다.

## 1. 준비한 결과와 현재 상태

파트너용 [Private recanet-sdk-distribution](https://github.com/RecycleFarm/recanet-sdk-distribution)을 만들고 설치·인증 문서 초안, 환경변수만 사용하는 Maven/npm 설정 예시, `release-policy.json`을 넣었다. 이 저장소에 내부 개발 이력·QA 감사·CVE 상세·후보 바이너리를 복사하지 않았다. 파트너 초대는 하지 않았으며 outside collaborator와 대기 초대는 각각0개로 확인했다. [준비용 원격 검사](https://github.com/RecycleFarm/recanet-sdk-distribution/actions/runs/44018915812)도 통과했다.

준비용 CI는 문서 설정 형식과 `publishingEnabled=false`를 확인한다. 발행 workflow, packages:write 권한, Registry/GitHub Release 업로드는 없다. null/false 결정 필드는 승인되지 않은 상태이며 이 정책 파일만 바꾼다고 배포되는 코드도 없다.

현재 계정 `raddaslul`은 개발 저장소 admin이고 조직 member이며 read:packages를 가지고 있다. 조직은 Free다. Maven/npm 목록 조회는 HTTP200이고 현재 계정에 보이는 항목은 각각0개다. 목록은 계정의 읽기 범위이므로 조직 전체의 숨겨진 패키지나 이름 사용 가능 여부를 보증하지 않는다.

개발 저장소 environments 조회는 HTTP200·0개였다. 환경 생성이나 설정 변경은 시도하지 않았다. API가 빈 목록을 반환한 사실과 Free private 저장소의 환경 기능 가용성은 구분한다.

초기 조사 당시 Phase 3 후보를 읽기 재검사했다. Java는 `com.youngminkim.recanet:RecanetJava:0.1.0-SNAPSHOT`, npm은 `recanet-typescript@0.1.0`, private=true이며 repository/publishConfig가 없다. 두 후보 모두 published=false/publishReady=false이고 체크섬은 일치했다. [검사 근거](migration/phase4-preparation-evidence.json).

## 2. 배포 전에 확정할 결정

| ID | 결정 | 권고안 | 현재 상태와 이유 |
| --- | --- | --- | --- |
| D1 | Maven/npm 이름 | Maven `com.youngminkim.recanet:recanet-java`, npm `@recyclefarm/recanet-sdk` | 확정·반영. Maven group은 유지하고 artifact만 소문자로 바꾸는 최소 전환안. 회사 명의 group을 원하면 최초 발행 전 `com.recyclefarm` 계열로 별도 결정 |
| D2 | 첫 외부 검증 버전 | 양쪽 `0.1.0-rc.1`, SDK별 독립 버전 유지 | 확정·반영. 기존 snapshot/0.1.0을 운영 승인으로 취급하지 않는다. 안정판은 외부 설치·보안 검토 후 결정 |
| D3 | 첫 PoC 플랫폼 | Ubuntu24.04 Linux x64·Node22, JDK17 | 확정·검증. 현재 npm 후보의 native는 Linux x86_64 ELF다. macOS/다중 OS 배포는 별도 packaging 구현 필요 |
| D4 | 파트너 제공 파일 | 실행 바이너리·타입·필수 resource/worker와 선별한 설치 문서. source JAR는 초기 제외 권고 | source JAR·내부 문서·source map 제외로 확정·검증. SDK 소스 공개를 허용하려면 source JAR 포함을 명시한다. 내부 QA/결정 문서·source map은 기본 외부 제외 권고 |
| D5 | 보안 처리 | critical 권고와 BC 중복을 먼저 평가·수정하고 전체 검증 후 외부 PoC | 알려진 권고 수정·검증 완료. 예외를 수용하려면 대상 권고·영향 조건·승인자·만료일을 명시해야 하며 단순 테스트 통과로 대체하지 않는다 |
| D6 | 승인/요금제 방식 | PoC는 명시적 수동 승인. 운영은 Team+보호된 승인 manifest 검토, 환경 승인 UI가 필수면 Enterprise 검토 | 미확정. 현재 Free에서 기술적 2인 승인 강제를 구성했다고 주장하지 않는다 |
| D7 | 외부 검증 대상 | 개발 저장소 권한 없는 실제 파트너 GitHub/CI 계정1개부터 | 미정. 담당 계정·CI OS/CPU·토큰 관리 책임자·비용 범위를 지정해야 한다 |
| D8 | 배포 조건·담당자 | 파트너 이용 조건, 제3자 고지, 릴리스 승인자·회수 담당자 확정 | 미정. SDK 자체 LICENSE가 없으며 CI 성공은 계약/라이선스 승인이 아니다 |

D1의 대체안은 설치 좌표의 브랜딩 선택이며 Java의 소스 package `com.youngminkim.recanet` 변경을 의미하지 않는다. npm 이름 전환도 설치/import 계약 변경으로 문서화해야 한다. 위 값을 실제 package metadata에 아직 적용하지 않았다.

## 3. 필요한 권한과 설정

| 역할/단계 | 필요한 최소 권한 | 부여 위치/주체 | 이번 상태 |
| --- | --- | --- | --- |
| distribution 유지관리자 | 해당 저장소 Write/Admin, 파트너는 Read | 저장소 관리자 | 준비 저장소 생성만 완료, 파트너 미초대 |
| 내부 후보 조회 | 내부 recanet-sdk의 Actions:read, commit/조상 검증에 Contents:read, Metadata 자동 읽기 | 해당 저장소에만 설치한 GitHub App을 권고. 조직 승인자가 설치 | App·키·Secrets 미생성 |
| 실제 발행 job | distribution의 GITHUB_TOKEN에 contents:read + packages:write | 향후 발행 workflow의 해당 job에만 명시 | 현재 모든 workflow는 contents:read, 발행 job 없음 |
| 조직 새 패키지 | private package 생성 허용, npm 자동 권한 상속 정책 확인 | 조직 Owner가 Packages 설정 확인 | 설정 가용/허용 여부 미확인, 변경하지 않음 |
| npm 읽기 정책 | private visibility 명시 확인 + distribution 저장소 권한 상속 확인 | 최초 발행 후 package admin | 패키지 미생성으로 사전 구성 불가 |
| 외부 파트너 설치 | distribution Read와 계정의 package Read, classic PAT read:packages | 파트너 계정/CI Secrets 담당자 | 계정·토큰 미지정, 설치 미검증 |
| 조직 요금제·정책 | 결제는 Owner/Billing manager, App/PAT/SSO 정책은 권한 있는 조직 관리자 | 조직 | 결제·정책 변경 없음 |

내부 Monorepo의 기본 GITHUB_TOKEN이 distribution의 Maven에 발행할 수 있다고 가정하지 않는다. 권고 흐름은 내부에서 검증한 후보를 distribution의 발행 job이 읽어 자신의 저장소 토큰으로 발행하는 것이다. 교차 저장소 조회용 App token과 Registry 발행용 GITHUB_TOKEN은 서로 다른 용도다. [공식 Registry/권한 문서](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages), [artifact 읽기 권한](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact).

GitHub App을 채택하면 별도 승인 후 App ID·설치 대상과 private key 저장 위치를 정한다. 설치 범위는 recanet-sdk로 제한하고 조회 토큰에 쓰기 권한을 주지 않는다. 키 원문을 채팅이나 문서로 받을 필요는 없다. 발행에는 가능하면 distribution 자체 GITHUB_TOKEN을 사용하므로 현재 사용자 CLI에 write:packages를 추가할 필요도 없다.

파트너의 기본 CI GITHUB_TOKEN은 다른 조직의 비공개 Maven/npm 설치 자격 증명으로 자동 사용되지 않는다. 실제 설치는 classic PAT read:packages와 계정의 읽기 권한으로 검증한다. classic PAT 차단·SSO가 적용된다면 조직 허용/SSO 승인을 별도로 확인한다. REST로 private Maven 메타데이터/저장소 API까지 읽을 경우 repo scope 요구가 추가될 수 있지만, 이를 모든 파트너 Registry 설치 토큰에 무조건 부여하라고 안내하지 않는다.

Maven은 저장소 권한/가시성을 따른다. npm은 package visibility와 repository access inheritance를 따로 확인해야 한다. 조직이 자동 상속을 껐을 수도 있으므로 npm에 repository URL을 넣었다는 사실만으로 outside collaborator 설치가 검증됐다고 보지 않는다. org npm 개별 권한 초대는 조직 사용자/팀 범위이므로 외부 협업자는 distribution 상속 경로를 실제 계정으로 확인한다. [접근 설정 공식 문서](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

outside collaborator는 조직 team에 추가할 수 없다. 유료 plan의 private repository 외부 협업자는 license 수에 영향을 주므로20개 회사가 아니라 사람/CI 계정 수로 비용을 계산해야 한다. [공식 외부 협업자 안내](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-outside-collaborators/adding-outside-collaborators-to-repositories-in-your-organization).

## 4. 승인 기능의 요금제 제약

조직 Free의 private repository는 branch protection/rulesets와 환경 기능 가용성에 제약이 있다. Team은 private 저장소 보호 규칙과 기본 environments를 제공하지만 private 환경의 required reviewers/wait timer까지 제공하는 것은 아니다. 공식 문서는 Free/Pro/Team의 이 추가 보호 기능을 public repository에 한정한다. [공식 환경 기능 안내](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

따라서 Team으로만 바꾸고 `environment: production`을 적는 것으로 2인 발행 승인 UI가 강제된다고 설계하지 않는다. 선택지는 다음과 같다.

- 현 Free PoC: 명시적인 사용자/운영 승인 후 제한된 담당자가 수동 발행. 절차적 승인이고 플랫폼의 2인 강제 승인이라고 부르지 않는다.
- Team 운영: 보호된 main에 후보의 run ID/commit/digest/버전을 담은 승인 manifest를 PR 리뷰로 병합하고, 발행 job은 그 승인된 후보만 읽도록 설계한다. 우회/관리자 예외도 검토한다. 이는 앞으로 구현·검증할 방안이다.
- Enterprise 운영: private environment required reviewers 같은 플랫폼 기능을 사용할지 비용·조직 정책과 함께 검토한다. 이번에는 요금제를 바꾸지 않는다.

## 5. 실제 발행을 막는 기술 문제

### Java 좌표와 산출물 연결

초기 후보 artifactId `RecanetJava`는 GitHub Maven의 소문자 규칙에 맞지 않으며 공식 문서는 대문자에422를 명시한다. [Maven 명명 규칙](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-apache-maven-registry).

rc.1 반영 전에는 Gradle publication, JAR base name, 생성 POM/module의 좌표와 URL, staging의 파일명 조합, API 검사 JAR 경로를 함께 맞춰야 한다. publish artifactId만 바꾸면 현재 staging은 동일 이름의 `build/libs/<artifactId>-<version>.jar`를 찾으므로 실패할 수 있다. Maven binary/POM/module을 맞추고 Gradle/Maven 외부 consumer로 다시 검증해야 한다. snapshot을 rc 버전으로 바꾸는 경우에도 새 후보를 만든다.

### npm 이름·private·소비자 검사

GitHub npm은 소문자 scope 패키지를 요구한다. 초기 unscoped 이름과 repository/publishConfig 미설정은 rc.1에서 수정했다. private=true는 실제 발행 보류를 위해 유지한다. 승인된 package name으로 package.json/lockfile, check-package.mjs의 dependency/설치 경로, package-consumer.ts의 import를 함께 갱신해야 한다. distribution 연결과 최초 private visibility/상속을 확인한다. [npm 공식 문서](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

원본 tarball에는 내부 문서9개와 source map59개가 들어 있다. 별도 partner allowlist를 정하고 그에 맞춰 check-package의 문서 동봉 조건/링크 검사도 수정해야 한다. 실행에 필요한 dist/internal JS까지 제거하면 안 되며 JavaScript 실행 코드를 배포하면서 구현 자체의 완전한 비공개를 보장할 수도 없다.

### native 플랫폼과 Greenfield 설치

현재 native 파일은 ELF machine62(Linux x86_64)이고 원격 후보 manifest도 같은 플랫폼을 기록한다. macOS CI는 해당 OS에서 native를 새로 빌드해 통과한 결과이며 Linux tarball의 macOS 설치 증거가 아니다. 첫 PoC를 Linux x64/검증된 runtime으로 제한할지, OS/CPU별 prebuild+loader/별도 optional package를 제공할지 결정해야 한다. 자동 install 빌드나 외부 다운로드 lifecycle은 아직 없다.

양쪽 Greenfield worker는 본체와 별도 npm lockfile/설치가 필요하다. Java JAR만 받으면 worker와 Node 의존성이 자동 설치되는 구조가 아니다. 외부 배포 allowlist에 worker를 별도 압축물로 제공할지와 설치·검증 절차를 정해야 한다. worker의 ethers5와 본체 ethers6을 임의 통합하지 않는다.

### 보안과 라이선스

초기 조사에서는 Java OSV 고유 권고12건(critical2/high7/moderate3), Greenfield npm28건(high8 포함), BC 중복 class4,245개를 확인했다. rc.1에서 수정 후 알려진 미해결 Registry 권고0건과 BC provider1개를 확인했다. 로컬 패치2개는 별도 hash·독립 회귀로 검증했다. SDK의 직접 BC 참조는 Keccak/EC 중심이고 직접 GOST/LDAP 호출은 이번 검색에서 발견되지 않았지만, 전이 라이브러리 전체 도달성이나 실제 악용 불가능성을 증명하지 않는다. [기존 상세 근거](phase1-additional-validation.md).

외부 PoC 전에 수정 또는 구체적인 위험 수용을 결정하고 변경 후 같은 검사를 다시 실행해야 한다. 두 SDK의 라이선스/파트너 사용 조건과 제3자 고지도 확정해야 한다. 이번에는 의존성 업그레이드나 예외 승인을 대신하지 않았다.

### 기능 대응과 실서비스 인수

Java main에는 TS의 PET v3 전용 factory와 같은 API가 없고 worker의 UTF-8 chunk 처리에도 차이가 있다. telemetry는 Java 보존 브랜치에만 있으며 제품 main에는 포함하지 않았다. 양쪽에 같은 0.1.0-rc.1을 선택해도 기능 동등성을 의미하지 않는다. 현재 [호환성 표](compatibility.md)와 대응 관계를 파트너에게 안내해야 한다.

Registry 설치 PoC와 Privy/Greenfield/DMRVN의 업무 인수는 구분한다. 후자의 승인된 RPC·배포·manifest/WASM/hash·validator·자격 증명·비용 상한(C-12)은 이전 보류 상태를 유지한다. 패키지 발행 승인을 지갑 생성·키 export·실제 거래·스토리지 쓰기 승인으로 해석하지 않는다. 기존 testnet JSON과 과거 fixture를 운영 승인값으로 사용하지 않는다.

### 보존 baseline과 버전 변경

초기 verify-migration은 HEAD의 SDK tree를 원본과 비교해 이름/버전 변경에도 실패했다. rc.1에서는 원래 이관 commit의 고정 tree·legacy refs·조상 관계를 검사하도록 분리했다. 현행 공개 API baseline은 그대로 유지하고 Java JAR 경로는 생성 POM에서 찾는다. 과거 tree나 source SHA를 덮어쓰지 않았다.

## 6. 발행 후보 전달 규약

향후 distribution job은 단순 URL이나 version 문자열을 신뢰하지 않고 아래 조건을 모두 확인해야 한다.

1. 승인된 내부 저장소·release workflow·성공한 run 및 attempt, main에 포함된 source commit.
2. run의 artifact ID와 API digest, 내부 manifest의 commit·언어·version·platform 일치.
3. 전체 SHA256SUMS 및 package/POM/module metadata 일치, 승인된 외부 파일 allowlist.
4. 확정된 보안·라이선스·승인 기록, 동일 좌표/version의 중복 발행 거부 정책.
5. distribution 로그·Actions artifact에 내부 원본 전체, 토큰, 임시 다운로드 URL을 출력하지 않음.

다운로드 권한과 metadata 일치만으로 배포가 승인되는 것은 아니다. 초기 Phase 3 후보는 원래 이름/버전과 내부 문서가 남아 있어 그대로 발행하지 않는다. D1~D5를 반영한 rc.1은 새 source revision과 새 run/digest로 검증했다. 실제 발행 승인과 외부 설치 검증은 별도로 남아 있다.

현재 두 원격 후보의 보관 만료는2026-12-01 KST다. 만료 후에는 같은 version이라도 새 run/digest 승인이 필요하다. 유한 보관 Actions artifact를 영구 Registry 저장으로 취급하지 않는다.

## 7. 승인 후 실행 순서

1. D1~D8 값을 기록하고 조직 package 생성/상속 정책, 승인 방식과 담당자 권한을 확인한다.
2. 별도 변경으로 좌표·버전·packaging/worker/native 전략·검사 경로·보존 gate를 반영하고 보안 문제를 처리한다. 원본 두 저장소는 그대로 유지한다.
3. 언어별 CI·공개 API·실제 tarball/JAR 소비자 검증을 다시 실행하고 새 내부 후보를 만든다.
4. 최소 App 조회 권한과 distribution 발행 job만 구성하고 provenance/중복·승인/allowlist 검사를 검증한다. 이 단계도 실제 발행과 분리할 수 있다.
5. 정확한 package/version/source/run/digest·권한 공개 범위가 확정된 후에만 실제 private Registry 발행을 별도 승인받아 실행한다.
6. 개발 저장소 권한 없는 외부 계정으로 Maven/Gradle와 npm 설치·실행·native/worker를 시험한다. 무권한 계정 거부·권한 회수 후 새 다운로드 거부·CI 토큰 회전도 확인한다.
7. Java와 npm 모두 외부 검증을 통과한 뒤 파트너 설치 안내를 실제 좌표/버전으로 교체한다. 문서만 작성한 상태를 Phase 4 외부 설치 검증 완료로 표시하지 않는다.

현재 판정: **준비 자료는 제공했지만 실제 발행과 파트너 검증은 보류 상태**다. 현재 CLI에 추가 쓰기 scope를 부여하거나 토큰 원문을 제공할 필요는 없다.

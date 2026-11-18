# CI와 릴리스 후보 생성

Phase 3에서는 언어별 CI와 내부 릴리스 후보 생성을 구성했다. 실제 GitHub Packages 발행, GitHub Release 생성, distribution 저장소 전송은 수행하지 않는다. 워크플로 권한은 contents:read이며 packages:write, contents:write 또는 배포 자격 증명을 사용하지 않는다.

## 빌드·테스트 CI

| 워크플로 | 실행과 검사 |
| --- | --- |
| Java CI | PR, main push, 수동 실행. Ubuntu24.04, JDK17, Node22.23.5에서 JUnit·JAR/POM·예제 컴파일·Greenfield worker·로컬 WASM·공개 API 검사 |
| TypeScript CI | 같은 이벤트. Ubuntu24.04 x64와 macOS15 ARM64에서 본체·worker·tarball 소비자·공개 타입 검사 |

Java 소스 변경은 Java, TS 소스 변경은 TS를 실행한다. contracts, scripts, workflow/공통 action, CI 규칙 테스트, Makefile, API baseline 변경은 양쪽을 실행한다. 일반 문서만 바뀌면 SDK 빌드는 생략하되 CI 규칙 테스트와 최종 상태 확인은 실행한다. 변경 이력 조회에 실패하거나 수동 실행한 경우에는 해당 SDK의 전체 검사를 실행한다.

각 워크플로는 항상 생성되는 최종 `Java checks`, `TypeScript checks` job을 둔다. 변경 감지 실패나 선택된 빌드 실패·취소는 성공 처리하지 않는다. workflow 자체의 paths filter를 사용하지 않으므로 문서 변경 PR이 검사 미생성으로 pending에 머무르는 상황을 피한다. 현재 Free 조직의 private 저장소는 필수 검사/보호 규칙 강제에 제약이 있으므로 검사 생성과 병합 차단 강제는 구분한다.

두 SDK 모두 Java·Node가 필요하다. Java worker는 Node, TS의 Java 호환 시험은 javac/java를 사용한다. 공통 setup action으로 두 도구를 구성하고 native Node headers의 존재를 확인한다. 외부 action은 확인한 전체 commit SHA에 고정했다. SDK 소스·패키지명·의존성은 변경하지 않았다.

## 릴리스 후보 워크플로

| 워크플로 | 태그 이벤트 | 현재 수동 실행 버전 |
| --- | --- | --- |
| Java Release Candidate | java-vX.Y.Z 또는 SemVer prerelease | 0.1.0-rc.1 |
| TypeScript Release Candidate | typescript-vX.Y.Z 또는 SemVer prerelease | 0.1.0-rc.1 |

GitHub의 Actions에서 해당 Release Candidate를 선택하고 Run workflow로 main과 정확한 package version을 지정한다. 수동 실행을 위해 태그를 만들 필요는 없다. 태그 이벤트는 언어별 prefix와 package version이 일치해야 한다. 숫자만 바꾸거나 다른 언어 태그를 사용하면 후보가 생성되지 않는다. 현재 package version을 사용자 승인 없이 바꾸지 않았다.

릴리스 후보는 main에 이미 포함된 정확한 commit만 대상으로 한다. 태그/수동 실행의 해당 revision을 새로 checkout해 기존 테스트와 공개 API 비교를 다시 실행한다. 실패한 검사나 버전 불일치를 건너뛰는 옵션은 없다. 내부 artifact 이름은 언어·run ID·attempt를 포함하며14일간 보관한다. 테스트 증거는 CI artifact로7일간 보관한다.

### 산출물

Java는 binary JAR·javadoc JAR·생성 POM·Gradle module metadata를 Maven 경로로 보관한다. source JAR와 sources variant는 제외한다. 별도 Greenfield runtime worker 압축물을 동봉하며 설치 시 Node22와 npm ci --omit=dev --ignore-scripts가 필요하다.

TS는 package.json의 files/exports로 npm pack한 tarball을 보관하고 이름·버전·JS/타입과 Linux x64·macOS ARM64의 .node 바이너리 및 빌드 해시를 확인한다. 재사용 native workflow가 같은 revision을 각 OS에서 빌드·OS 잠금 실행 검증하고, CI·release·contract workflow가 두 artifact를 모은다. 빌드 OS/architecture는 manifest에 기록하되 동일 tarball을 Linux x64와 macOS ARM64에 설치할 수 있다. 설치에서는 컴파일이나 바이너리 다운로드를 하지 않는다. CI에서 C compiler·Node headers 경로를 사용할 수 없도록 설정하고, 일반 설치 및 --ignore-scripts 재설치 후 journal 실행까지 검증한다. prepack은 두 바이너리의 형식·CPU·소스 해시·바이너리 해시를 확인하고 불완전한 패키지를 거부한다.

각 후보에 manifest.json과 SHA256SUMS를 동봉한다. manifest에는 SDK·버전·commit·ref·workflow/run ID·attempt·빌드 플랫폼과 도구, package metadata가 있다. 항상 published=false, publishReady=false이며 미해결 발행 조건을 명시한다. SHA256SUMS는 manifest와 모든 후보 파일을 포함한다. 다운로드한 후보 디렉터리에서 다음과 같이 확인한다.

```sh
# Linux
sha256sum -c SHA256SUMS
# macOS
shasum -a 256 -c SHA256SUMS
```

내부 후보는 원격 Registry의 불변 버전이나 외부 배포물이 아니다. 같은 version을 다른 run에서 다시 검증할 수 있으며, 최종 발행 대상은 향후 승인된 run·commit·digest로 고정해야 한다. 공유 패키지 레지스트리에 새 버전이 생기는 작업은 없다.

## 로컬 검사

```sh
make ci-rules
make check

# Java 후보를 만들기 전 module metadata 생성
(cd sdks/java && ./gradlew generateMetadataFileForMavenJavaPublication)
python3 scripts/stage-release.py --language java --version 0.1.0-rc.1
python3 scripts/stage-release.py --language typescript --version 0.1.0-rc.1
```

로컬 후보는 staging/ 아래에 생성되고 Git에서 제외한다. 이미 같은 출력 디렉터리가 있으면 덮어쓰지 않는다. 새 시험에는 --output으로 별도 경로를 사용한다. 로컬 후보의 존재는 워크플로의 원격 검증 완료를 뜻하지 않는다.

## 발행 전 남은 조건

Java의 대문자 artifactId, npm private/scope/name, native 플랫폼 배포 전략과 의존성 보안 검토는 해결하지 않았다. distribution 연결·파트너 접근·발행 인증·실제 외부 설치는 후속 단계다. 현재 워크플로에 Registry 주소와 발행 step을 추가하기 전 별도 승인 및 검증이 필요하다. 이번에는 배포 토큰이나 GitHub App·Secrets를 만들지 않았다.


현재 Phase 4의 준비 상태와 실제 발행 전 결정은 [배포 준비 보고서](phase4-readiness.md)에 정리했다. distribution 문서/설정 초안은 생성했지만 발행 workflow와 실제 Registry 발행은 여전히 보류 상태다.


## rc.1 승인 반영

현재 후보 이름은 com.youngminkim.recanet:recanet-java:0.1.0-rc.1 및 @recyclefarm/recanet-sdk@0.1.0-rc.1이다. Java 첫 PoC는 Linux x64·JDK17이며 TypeScript는 Linux x64 또는 macOS ARM64·Node22를 지원한다. npm os/cpu, 플랫폼 검사 스크립트와 두 플랫폼의 사전 빌드 바이너리·해시를 검사하며 내부 문서/source map을 거부한다. npm private=true와 모든 workflow의 발행 비활성은 유지한다.

보안 조회가 성공하고 알려진 미해결 권고가0건이며 검토된 로컬 호환 모듈 hash와 회귀 시험을 통과해야 후보를 생성한다. 같은 commit의 보안 보고서 hash를 manifest에 넣고, 보안 보고서는 후보와 분리한 내부 artifact로 보관한다. [보안 수정 근거](security/rc1-remediation.md).

# CI와 SDK 릴리스

언어별 릴리스 워크플로는 기본값으로 후보를 검증하고 보관한다. `main`에서 수동으로 공개 발행을 선택하면 같은 실행에서 검증한 산출물을 선택한 레지스트리에 발행한다. 기본 발행 대상은 GitHub Packages다.

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
| Java Release | java-vX.Y.Z 또는 SemVer prerelease | 0.1.0-rc.2 |
| TypeScript Release | typescript-vX.Y.Z 또는 SemVer prerelease | 0.1.0-rc.2 |

GitHub의 Actions에서 해당 릴리스 워크플로를 선택하고 **Run workflow**에서 `main`과 정확한 package version을 지정한다. 수동 실행을 위해 태그를 만들 필요는 없다. 태그 이벤트는 언어별 prefix와 package version이 일치해야 한다. 숫자만 바꾸거나 다른 언어 태그를 사용하면 후보가 생성되지 않는다. 현재 package version을 사용자 승인 없이 바꾸지 않았다.

릴리스 후보는 main에 이미 포함된 정확한 commit만 대상으로 한다. 태그/수동 실행의 해당 revision을 새로 checkout해 기존 테스트와 공개 API 비교를 다시 실행한다. 실패한 검사나 버전 불일치를 건너뛰는 옵션은 없다. 내부 artifact 이름은 언어·run ID·attempt를 포함하며14일간 보관한다. 테스트 증거는 CI artifact로7일간 보관한다.

### 산출물

Java는 binary JAR·javadoc JAR·생성 POM·Gradle module metadata를 Maven 경로로 보관한다. 공개 발행용 후보에는 sources JAR와 sources variant가 추가된다. 별도 Greenfield runtime worker 압축물을 동봉하며 설치 시 Node22와 npm ci --omit=dev --ignore-scripts가 필요하다.

TS는 package.json의 files/exports로 npm pack한 tarball을 보관하고 이름·버전·JS/타입과 Linux x64·macOS ARM64의 .node 바이너리 및 빌드 해시를 확인한다. 재사용 native workflow가 같은 revision을 각 OS에서 빌드·OS 잠금 실행 검증하고, CI·release·contract workflow가 두 artifact를 모은다. 빌드 OS/architecture는 manifest에 기록하되 동일 tarball을 Linux x64와 macOS ARM64에 설치할 수 있다. 설치에서는 컴파일이나 바이너리 다운로드를 하지 않는다. CI에서 C compiler·Node headers 경로를 사용할 수 없도록 설정하고, 일반 설치 및 --ignore-scripts 재설치 후 journal 실행까지 검증한다. prepack은 두 바이너리의 형식·CPU·소스 해시·바이너리 해시를 확인하고 불완전한 패키지를 거부한다.

각 후보에 manifest.json과 SHA256SUMS를 동봉한다. manifest에는 SDK·버전·commit·ref·workflow/run ID·attempt·빌드 플랫폼과 도구, package metadata가 있다. 스테이징 시점의 `published`는 `false`다. `publishReady`는 공개 발행용 검증을 통과한 후보에서만 `true`다. SHA256SUMS는 manifest와 모든 후보 파일을 포함한다. 다운로드한 후보 디렉터리에서 다음과 같이 확인한다.

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
python3 scripts/stage-release.py --language java --version 0.1.0-rc.2
python3 scripts/stage-release.py --language typescript --version 0.1.0-rc.2
```

로컬 후보는 staging/ 아래에 생성되고 Git에서 제외한다. 이미 같은 출력 디렉터리가 있으면 덮어쓰지 않는다. 새 시험에는 --output으로 별도 경로를 사용한다. 로컬 후보의 존재는 워크플로의 원격 검증 완료를 뜻하지 않는다.

## GitHub Packages 발행

1. GitHub Packages의 npm 패키지 설정에서 `RecycleFarm/recanet-sdk`에 Actions **Write** 권한을 부여하고 패키지의 공개 상태를 확인한다. Maven은 `recanet-sdk` 저장소의 공개 상태를 상속한다.
2. 두 SDK의 버전을 맞춘다. TypeScript는 `package.json`과 `package-lock.json`, Java는 `build.gradle.kts`를 갱신한다.
3. `main`에서 **TypeScript Release**와 **Java Release**를 각각 실행한다. 정확한 버전, `publish`, `registry: github-packages`를 지정한다. 두 작업은 GitHub Actions의 `GITHUB_TOKEN`을 사용한다. npm prerelease는 `next` 태그로 발행한다.
4. 두 발행 작업의 레지스트리 설치 검사를 확인한다. 배포 저장소 전환 시에는 조직 외부 계정의 classic PAT(`read:packages`)로도 두 SDK를 설치한 뒤 배포 저장소를 아카이브한다.

## npmjs와 Maven Central 발행

1. 프로젝트 라이선스를 정하고 루트 `LICENSE`를 추가한다. 동일한 본문을 `sdks/typescript/LICENSE`에 복사하고, npm manifest에 SPDX 식별자를 `license`로 추가한다. npm 11로 `sdks/typescript/package-lock.json`의 루트 메타데이터를 갱신한다. Java는 같은 SPDX 식별자를 `sdks/java/gradle.properties`에 `recanetLicense=<SPDX>`로 기록한다.
2. npmjs에 `@recyclefarm` 조직 발행 권한을 확보한다. 최초 발행에 사용할 패키지 생성 권한과 2FA 우회가 설정된 granular access token을 GitHub Actions의 `npmjs` 환경 비밀 `NPM_TOKEN`에 등록한다. 최초 발행 이후에는 npmjs 패키지 설정에 `RecycleFarm/recanet-sdk`, `typescript-release.yml`, 환경 `npmjs`로 Trusted Publisher를 등록하고 `NPM_TOKEN`을 제거할 수 있다. [npm 발행 문서](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/), [Trusted Publishing 문서](https://docs.npmjs.com/trusted-publishers/)
3. Central Portal에서 `com.youngminkim.recanet`을 사용할 수 있는 네임스페이스 소유권을 확인하고, 토큰과 서명 키를 GitHub Actions의 `maven-central` 환경에 등록한다. 비밀 이름은 `CENTRAL_USERNAME`, `CENTRAL_PASSWORD`, `CENTRAL_GPG_PRIVATE_KEY`(ASCII-armored), `CENTRAL_GPG_PASSPHRASE`다. Central에서 조회할 수 있는 키서버에 공개키를 올린다. [Central 네임스페이스 문서](https://central.sonatype.org/register/namespace/), [서명 요구 사항](https://central.sonatype.org/publish/requirements/gpg/)
4. 변경이 `main`에 반영되면 GitHub Actions에서 **TypeScript Release**와 **Java Release**를 각각 실행한다. `main`, 정확한 버전, `publish`를 선택하고 각 레지스트리로 `npmjs`와 `maven-central`을 지정한다. npm prerelease의 dist-tag는 `next`이며 정식 버전은 `latest`다. Maven Central에는 서명과 체크섬을 포함한 번들이 발행된다. 업로드 후 실행이 중단되면 Central Portal의 deployment 상태를 확인한 뒤 재실행한다.
5. 두 워크플로의 `verify-public-install` 성공을 확인한다. npm 검사는 인증 없이 npmjs에서 패키지를 설치하고 네이티브 journal을 실행한다. Java 검사는 빈 Maven 캐시에 SDK 및 전이 의존성을 해결하고 Central의 JAR·POM·Gradle module·sources·Javadoc·Greenfield worker를 후보 파일과 비교한다.

공개 발행 후 Java Greenfield worker는 Maven Central에서 `recanet-sdk-java-<version>-greenfield-worker-linux-x64.tar.gz`를 받을 수 있다. SDK와 같은 버전을 사용하고, 압축을 푼 `greenfield/`에서 `npm ci --omit=dev --ignore-scripts`를 실행한다.

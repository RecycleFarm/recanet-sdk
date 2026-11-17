# Recanet SDK Monorepo 구조와 마이그레이션 가이드

검토일: 2026-11-17 KST. 상태: Phase 1 조사 기록과 Phase 2 설계 기준. Phase 2 실행 결과는 [이관 기록](migration/phase2-migration.md)에 별도로 유지한다. 패키지 배포는 미실행.

추가 결과는 [Phase 1 추가 검증](phase1-additional-validation.md), 필요한 사용자 설정은 [GitHub 접근 설정 안내](github-access-checklist.md)를 참조한다.

이 문서는 내부 개발 저장소 `RecycleFarm/recanet-sdk`의 `docs/monorepo-migration-guide.md`로 유지할 가이드다. Phase 1 당시 결과물의 `recanet-sdk/`는 문서 전달용 디렉터리였다. 이후 사용자의 Phase 2 승인에 따라 실제 Monorepo로 이관했으며 아래 과거 조사 범위와 후속 계획은 시점을 구분해 읽는다. 사용자가 기존 로컬 프로젝트 경로가 없다고 확인하여 이 위치에 준비했다. Phase 2에서 실제 프로젝트에 문서를 포함하고 README에서 연결한다.

결론: Java와 TypeScript를 독립 빌드로 유지하면서 내부 Monorepo로 이관하고, 파트너 접근은 별도 Private `recanet-sdk-distribution`으로 분리한다. Maven과 npm 모두 배포 저장소를 권한 기준으로 삼는 방안을 권고한다. 다만 현재 패키지 이름, 네이티브 바이너리 배포, 보호 규칙, 실제 파트너 설치가 해결되지 않아 운영 배포 승인 상태는 아니다.

## 1. 조사 범위와 근거

실제 GitHub 인증 계정으로 두 비공개 저장소의 메타데이터·전체 접근 가능한 브랜치/태그·소스·문서·빌드 설정·Actions/릴리스 API를 조회했다. 분석용 복제본에서 일반 빌드와 테스트를 실행했다. 원본 저장소에 push, 설정 변경, PR 생성, 새 GitHub 저장소 생성, 패키지 발행은 하지 않았다. 참조 대화도 읽었으며 거기에 제시된 패키지명은 현재 실측값과 구분했다.

| 항목 | Java | TypeScript |
| --- | --- | --- |
| 실제 저장소 | [RecycleFarm/recanet-java](https://github.com/RecycleFarm/recanet-java) | [RecycleFarm/recanet-typescript](https://github.com/RecycleFarm/recanet-typescript) |
| 공개 여부 / 보관 여부 | Private / archived=false | Private / archived=false |
| 기본 브랜치 | main | main |
| 조사 기준 SHA | `37c78cfa01d9892ca26de61bb74df827923917cf` | `eb132e7d03110d7238e14627b3f87be6cb7b8798` |
| main 도달 커밋 수 | 6 | 56 |
| 전체 접근 가능한 브랜치 도달 커밋 수 | 8 | 56 |
| 브랜치 | main, codex/sdk-telemetry | main |
| 태그 / GitHub Releases | 각각 0개 | 각각 0개 |
| Actions workflows / runs API | 각각 0개 | 각각 0개 |
| LICENSE | 추적 파일에서 없음, 메타데이터 license=null | 동일 |

Java telemetry 브랜치 HEAD는 `0e8fcaf7675e2cd607ff7d4e3805c4476c60434b`다. main 대비 2개 커밋이 있고 57개 파일 차이가 있다. telemetry·오류 처리·테스트·Greenfield worker 수정까지 포함하므로 main으로 임의 병합하지 않는다. TypeScript는 `be7b810`에서 진단 로깅을 추가한 뒤 `2ec9f22`에서 되돌렸다. Java 브랜치 기능을 TypeScript에도 이미 제공한다고 해석하면 안 된다. 이력 수는 GitHub가 노출한 refs 기준이며 삭제된 브랜치나 숨겨진 커밋까지 포함한다는 의미는 아니다.

근거 파일은 위 SHA의 `build.gradle.kts`, `settings.gradle.kts`, `gradle/wrapper/gradle-wrapper.properties`, `package.json`, `tsconfig.json`, 각 `src/`, `tools/greenfield/`, TS `src/index.ts`, `docs/java-parity.md`, `docs/decisions.md`, `docs/evidence-v4.md`다. 원본 링크와 공개 API 발췌는 [API 조사 부록](api-inventory.md)에 정리했다.

## 2. 현재 디렉터리와 빌드

### Java

```text
recanet-java/
├── src/main/java/com/youngminkim/recanet/       # 지갑·인증·자산·거래 API
│   └── dmrvn/                                # Evidence·Claim·journal·reader
├── src/main/resources/dmrvn/                  # 배포·ABI·PET 자료
├── src/test/java/ 및 src/test/resources/      # JUnit·고정 벡터·WASM
├── src/examples/java/                        # Diagnostics·PET 실행 예제
├── tools/greenfield/                         # 별도 npm worker
├── tools/run-dmrvn-*.py                      # 실행 보조 도구
├── docs/                                    # BACKEND_AUTH·DMRVN 등
├── build.gradle.kts / settings.gradle.kts
└── gradlew / gradlew.bat / gradle/wrapper/
```

Gradle Kotlin DSL, Wrapper 8.10.2, Java toolchain 17, java-library 및 maven-publish를 사용한다. 일반 `test`는 `live-dmrvn` 태그를 제외한다. 실제 서비스 쓰기가 가능한 `dmrvnPetLiveTest`와 `dmrvnPet`는 별도 task다. 이번에는 실행하지 않았다.

현재 생성 POM의 좌표는 `com.youngminkim.recanet:RecanetJava:0.1.0-SNAPSHOT`이다. group은 build 설정, artifactId는 `rootProject.name = "RecanetJava"`에서 나온다. 원격 publishing repository 설정은 없고 sources/javadoc JAR 생성만 정의돼 있다. 권한 승인 후 조직 Maven 목록과 이 저장소 연결 패키지 조회가 성공했으나 모두0개였다. 현재 조회 범위에서는 기존 발행 패키지를 발견하지 못했다. 과거 삭제된 패키지나 다른 저장소/계정 Registry의 발행 이력까지 확인한 것은 아니다.

| 직접 의존성 | 버전 |
| --- | --- |
| io.privy.api:privy-java | 0.59.0 |
| com.nimbusds:nimbus-jose-jwt | 10.10 |
| com.fasterxml.jackson.core:jackson-databind | 2.22.1 |
| org.bouncycastle:bcprov-jdk15to18 | 1.83 |
| io.github.erdtman:java-json-canonicalization | 1.1 |
| JUnit BOM / Jupiter | 5.11.4 |

현재 생성 POM에서 일반 의존성은 runtime scope다. 공개 시그니처에 외부 타입이 노출된다면 소비자 컴파일에 필요한 compile/api 의존성을 별도 점검해야 한다. 추가 검증에서 main JAR만 컴파일 경로에 둔 외부 소비자 예제의 컴파일과 전체 런타임 의존성을 사용한 실행을 확인했다. jdeps --api-only 결과에서도 공개 시그니처가 참조하는 외부 라이브러리 타입은 발견되지 않았다. 검증 범위는 [추가 결과](phase1-additional-validation.md)에 기록했다.

### TypeScript

```text
recanet-typescript/
├── src/index.ts                             # 공개 패키지 진입점
├── src/internal/                            # 내부 전송·복구·검증
├── src/resources/dmrvn/                     # 배포·ABI JSON
├── tests/ 및 tests/helpers/ 및 tests/fixtures/
├── native/posix-lock.c                      # Node-API 파일 잠금
├── scripts/build-native.mjs / check-package.mjs
├── tools/greenfield/                        # 별도 worker 및 lockfile
├── tools/ci/Dockerfile                      # Node22 Linux 검증용
├── docs/                                   # QA·차이·결정 보류·인수
└── package.json / package-lock.json / tsconfig.json
```

npm과 package-lock을 사용한다. Node 요구는 `>=22`, TypeScript 6.0.3, @types/node 22.20.5다. NodeNext/ES2022 strict 컴파일로 `dist/`에 ESM JavaScript, `.d.ts`, source map을 만든다. exports는 루트의 types/import만 제공하며 CommonJS 진입점은 없다. 현재 이름은 `recanet-typescript`, 버전은 `0.1.0`, `private: true`다. GitHub scope/repository/publishConfig는 아직 설정돼 있지 않다.

직접 런타임 의존성은 ethers 6.17.0, @hpke/core 1.10.1, @hpke/chacha20poly1305 1.8.1이다. 두 언어의 별도 Greenfield worker는 @bnb-chain/greenfield-js-sdk 2.2.2, @bnb-chain/reed-solomon 1.1.4, ethers 5.8.0을 사용한다. 본체 ethers6와 worker ethers5를 하나로 통합하지 않는다. worker는 별도 `npm ci --prefix tools/greenfield` 설치가 필요하다.

`build`는 C 네이티브 잠금을 먼저 빌드하고 tsc를 실행한다. macOS/Linux에서 C compiler와 Node headers가 필요하다. `check`는 본체 테스트 다음 worker 테스트, `check:package`는 실제 tarball 설치·strict Node 타입·ESM·native 실행·문서 링크를 검사한다. 현재 tarball에는 빌드 머신 OS/arch의 `.node`가 들어가며 자동 재빌드 install lifecycle이나 범용 prebuild 전략은 없다. Windows의 FileOperationJournal 지원을 보장하지 않는다.

## 3. 실행한 검증과 한계

환경: macOS ARM64, Node 25.5.0, npm 11.11.0, Zulu OpenJDK 17.0.18. 아래 결과는 조사 기준 main 복제본에서 확인한 것이다.

| 검증 | 결과 |
| --- | --- |
| Java `./gradlew test assemble generatePomFileForMavenJavaPublication --console=plain` | 성공. JUnit XML 합계 126개, 실패/오류/skip 0 |
| Java JAR·sources·javadoc·POM 생성 | 성공. Javadoc 경고 100건 출력 |
| Java `npm --prefix tools/greenfield test` | 8개 통과, 실패/skip 0 |
| Java `npm --prefix tools/greenfield run test:pet-wasm` | 고정 로컬 WASM 출력 검증 통과. 운영 승인 증거는 아님 |
| TS `npm ci` | 성공. 당시 본체 npm audit 0건 |
| TS worker 설치 완료 후 `npm run check` | 본체 267개 + worker 14개 = 281개 통과, 실패/skip 0 |
| TS `npm run check:package` | 성공. tarball 200파일 / 195,460 bytes, 소비자 smoke 통과 |
| Greenfield npm audit | 28건: low16 / moderate4 / high8 / critical0. 양쪽 설치 출력이 같고 TS JSON으로 세부 확인 |

첫 TS check는 worker 의존성 설치와 동시에 시작돼 Greenfield bundle 테스트 1개가 실패했다. 설치 완료 후 전체 check를 다시 실행해 모두 통과했다. 초기 실패를 숨기거나 코드 결함 해결로 해석하지 않는다. 코드 수정은 없었다.

추가 검증에서는 Node22.23.5/macOS ARM64의 전체 check·패키지 소비자 검사와 Java telemetry 브랜치의 빌드·일반 테스트221개·worker12개를 확인했다. Java main 런타임 의존성13개와 telemetry 추가 의존성3개를 OSV로 조회했으며, main 의존성4개에서 고유 권고12건이 보고됐다. Linux/x64/Windows, 외부 파트너 설치, 실제 Privy 키 export·지갑 생성·거래 전송·Greenfield 저장·validator 수용은 실행하지 않았다. 현재 머신에 Linux 실행 도구가 없어 과거 Linux 검증을 이번 HEAD 결과로 대체하지 않는다. [추가 검증 상세](phase1-additional-validation.md).

## 4. 공개 API와 기능 차이

Java main 소스에서 public 최상위 타입은 39개다. TS 공식 소비 경계는 `src/index.ts`에 명시한 exports다. 각 파일의 export가 모두 외부 패키지 경로로 제공된다는 뜻은 아니다. 부록의 Java 발췌는 중첩 타입과 public 멤버를 포함하며, 완전한 바이너리 호환성 판정 도구 결과는 아니다.

| 기능 | Java main | TS main / 차이 |
| --- | --- | --- |
| 서버 자격·JWT/JWKS | PrivyClient, PrivyTokenVerifier, Config 타입 | PrivyClient, PrivyTokenVerifier, options·JwksPolicy |
| 승인키·운영 지갑 | BackendWalletRegistration/KeyPair, 등록·조회·명시 export | 동일 핵심 경로, KeyPair는 등록 객체 속성에 통합 |
| 회원 지갑·서명 | UserWalletClient, PrivyEvmSigner, 파트너 callback | userWallets interface, async signer·callback |
| 자산·거래 | AssetClient, EvmTransactionClient, Query/Page/Status | 동일 기능군, Promise·readonly interface·bigint |
| DMRVN 프로토콜 | EvmRpc/EvmSigner, DmrvnProtocol, 내부 Abi/Crypto/Chain | 공개 DmrvnAbi/DmrvnCrypto/DmrvnChain, DmrvnJson/Decimal |
| 제출·복구 | DmrvnClient: prepareEvidence, recoverCreateTransaction, approveClaim, prepareSponsored/SelfPaid, recordSponsoredSignature, submitSponsored, resolveSubmission, operation, readResult, submitActivity | 같은 핵심 경로, 별도 DmrvnPreflight 및 ActivityOutcome/Stage 타입 |
| reader·journal·storage | DmrvnReader, GreenfieldPublicReader/Storage, FileOperationJournal, OperationJournal, package-private MemoryOperationJournal | 대응 API, MemoryOperationJournal도 공개, native 잠금 빌드 필요 |
| PET 전용 프로필 | 일반 DeclaredMethodology 생성자와 명시 schema 인자. petV3 전용 factory 없음 | `DeclaredMethodology.petV3` 추가. Evidence4/partner101/activity1003/방법론2003·v3/petBottleCount 키 결속 |
| 부트스트랩·자동 로그 | ensureBackendWallet, generateAndLog, exportWalletPrivateKeyAndLog, 환경 로더 등 존재 | 비밀 자동 출력·첫 지갑 선택·환경 로더 정책 보류/미구현 |
| 런타임 설정 조회 | PrivyClient.config 및 설정 getter | 대응 조회 API 없음 |
| 실환경 도구 | Diagnostics/PET Java 예제, Python 실행 도구, live task | 실행 가능한 같은 CLI를 전부 이식하지 않음 |

양쪽 모두 `DMRVN v4 source:` 서명 경로를 갖는다. 그러나 그것만으로 Java에 TS의 PET v3 전용 프로필 전체가 구현됐다고 볼 수 없다. Java 기본 생성자의 schema=3과 명시 인자 경로를 유지하고, 프로필 정합성 보완은 이관 이후 별도 변경으로 다룬다.

추가 차이:

- Java의 동기 호출·Duration·정수/BigDecimal과 TS의 Promise·정수 밀리초·bigint·DmrvnDecimal은 표현 및 허용 범위가 다르다. JWT/JWKS 비표준 입력·timeout·오류 동등성 전체는 미검증이다.
- Java `listWalletsByAuthorizationKey`는 TS `listBackendWallets`와 대응한다. deprecated approver/relay 분리 생성자를 별도의 두 운영 지갑 기능으로 해석하지 않는다.
- TS worker는 UTF-8 chunk를 StringDecoder로 처리한다. Java main worker와 바이트가 다르므로 공통 파일로 즉시 합치면 수정이 유실되거나 동작이 바뀐다.
- 배포 JSON2개와 ABI JSON3개는 이번 바이트 비교에서 일치했다. Java의 pet-manifest.json/pet-publication.json은 TS 본체에 없다. 이 자료는 과거 예제/테스트 자료이며 현재 승인된 운영 패키지라는 증거가 아니다.
- `docs/java-parity.md`의 비교 기준은 현재 Java main과 일치하지만 후속 TS PET 기능이 추가됐다. 그 문서의 과거 테스트 수나 “누락 없음” 결론을 현재 완전 동등성 선언으로 사용하지 않는다.
- TS decisions/acceptance에 남은 C-12 실환경 인수 보류는 그대로 유지한다. 이 분석은 그 결정을 대신하지 않는다.

## 5. 최종 목표 디렉터리

아래는 Phase 2 이후의 목표 구조다. 현재 저장소의 모든 추적 파일을 각 SDK 아래에 먼저 그대로 옮기는 것을 우선한다. 기존 Java 빌드를 Maven으로 바꾸거나 루트 JS workspace를 강제하지 않는다.

```text
recanet-sdk/                                # 내부 개발 Private
├── README.md                               # 빌드와 가이드 진입점
├── Makefile                                # 각 SDK 디렉터리에서 기존 명령 호출
├── sdks/
│   ├── java/                               # 기존 Java 추적 파일 전체
│   │   ├── src/{main,test,examples}/
│   │   ├── build.gradle.kts / settings.gradle.kts
│   │   ├── gradle.properties / gradlew / gradlew.bat / gradle/
│   │   ├── tools/greenfield/ 및 run-dmrvn-*.py
│   │   ├── docs/ / README.md / .env.example / .gitignore
│   └── typescript/                         # 기존 TS 추적 파일 전체
│       ├── src/ / tests/ / native/ / scripts/
│       ├── package.json / package-lock.json / tsconfig.json
│       ├── tools/greenfield/ / tools/ci/Dockerfile
│       └── docs/ / README.md / .gitignore / .dockerignore
├── contracts/
│   ├── README.md                           # 출처·대상 SDK SHA·적용 프로필 기록
│   └── test-cases/                          # 확인된 공통 벡터부터 추가
├── examples/README.md                       # 실제 SDK 내 예제 연결
├── scripts/                                # 전체 확인·release staging·manifest 검사
├── docs/
│   ├── monorepo-migration-guide.md          # 설계와 이관 상태의 기준 문서
│   ├── api-inventory.md
│   ├── compatibility.md                    # 기능군과 API/계약 버전 대응
│   ├── release-guide.md
│   ├── partner-onboarding.md               # 내부 운영용
│   ├── decisions.md
│   └── migration/                          # 원본 refs/SHA·검증·승인 기록
└── .github/
    ├── CODEOWNERS
    └── workflows/
        ├── java-ci.yml
        ├── typescript-ci.yml
        ├── contract-ci.yml
        ├── java-release.yml                # 내부 빌드·검증·staging
        └── typescript-release.yml

recanet-sdk-distribution/                   # 파트너 Read, Private
├── README.md
├── docs/
│   ├── java-installation.md
│   ├── typescript-installation.md
│   ├── compatibility.md
│   └── troubleshooting.md
├── examples/                               # 승인된 외부용 예제만
├── releases/<language>/<version>.json       # 외부용 릴리스 manifest
└── .github/workflows/
    ├── publish-java.yml
    └── publish-typescript.yml
```

주석의 의미: contracts에는 출처·대상 SDK SHA·적용 프로필을 기록하고 확인된 공통 벡터부터 추가한다. docs/migration은 원본 refs/SHA와 검증·승인 기록을 보존한다. distribution에는 파트너 공개가 승인된 문서·예제·릴리스 메타데이터만 둔다. 내부 API 조사·결정 대기 문서 전체를 복사하지 않는다. Spring Boot/Node.js 완성 예제는 현재 양쪽에 같은 형태로 존재하지 않으므로 이관 시 발명하지 않고 후속 문서 단계에서 추가한다.

각 SDK의 원래 .gitignore를 유지하고 루트에는 공통 생성물 제외 규칙을 별도로 둔다. 루트 .github는 기존에 없으므로 새 CI만 위치시킨다. 원래 docs와 scripts를 처음부터 합치지 않아 상대 경로와 패키지 문서 링크를 보존한다. Greenfield worker 중복 제거와 공통 ABI 단일 원본화는 기능 검증 후 별도 변경이다.

## 6. Registry와 권한 설계

### Maven

Maven/Gradle 패키지는 연결된 저장소 권한과 가시성을 따른다. 내부 Monorepo에 연결한 뒤 파트너에게 패키지만 허용하는 구조로 설계하면 안 된다. Java 배포 대상은 `https://maven.pkg.github.com/recyclefarm/recanet-sdk-distribution`으로 명시하고 distribution 저장소에 연결해야 한다. [공식 권한 문서](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages), [Gradle Registry 문서](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-gradle-registry).

현재 artifactId `RecanetJava`는 GitHub Maven에서 대문자로 인해 422 대상이다. 기존 좌표 무변경 배포는 불가능하다. Phase 2에서 group `com.youngminkim.recanet`은 유지하고 소문자 artifactId 후보 `recanet-java`를 검토하는 것이 최소 변경안이다. `com.recyclefarm:recanet-sdk`는 이전 대화의 예시이며 실제 기존 좌표가 아니다. 확정 전에 기존 소비자/패키지 존재를 확인하고 설치 설정 변경을 안내한다. Java 소스 package `com.youngminkim.recanet`은 이관만으로 변경하지 않는다. [Maven 명명 제약](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-apache-maven-registry).

### npm

npm은 저장소와 분리한 패키지 권한을 지원한다. 다만 조직 패키지 직접 권한의 사용자/팀 범위를 outside collaborator 초대와 동일하게 가정하지 않는다. 20개 이상 파트너를 두 Registry에서 일관되게 관리하려면 npm도 distribution에 연결하고 저장소 Read 권한을 상속하는 방안을 우선한다. 실제 외부 협업자 계정으로 상속 경로를 검증해야 한다. 내부 Monorepo의 권한을 상속하지 않도록 최초 발행 시 연결과 상속 설정을 확인한다. [접근 제어 문서](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

배포 후보명은 `@recyclefarm/recanet-sdk`이며 현재 이름과 다르다. scope/name은 소문자여야 한다. `private: true` 해제, publishConfig.registry, repository 연결, lockfile·문서·check-package 소비자 import를 함께 갱신해야 한다. ESM과 Node22+를 기본으로 유지하고 CJS 제공은 별도 결정이다. 이름 변경만으로 native OS/arch 문제는 해결되지 않는다. [npm Registry 문서](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

### 발행 실행 위치와 인증

내부 Monorepo의 `GITHUB_TOKEN`은 distribution에 발행할 권한을 자동으로 갖지 않는다. 권고 흐름은 내부에서 빌드·검증한 불변 산출물을 distribution의 제한된 발행 workflow가 받아 자신의 `GITHUB_TOKEN`으로 발행하는 방식이다. distribution의 발행 job만 `contents: read`, `packages: write`를 가진다. [GitHub Actions 패키지 발행 문서](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions).

두 저장소 사이의 workflow 호출·산출물 읽기에는 승인된 GitHub App 설치 토큰 등 저장소 접근용 인증을 별도로 설계한다. 이 App 토큰을 Maven/npm Registry 인증에 사용할 수 있다고 가정하지 않는다. 직접 교차 저장소 발행을 택한다면 classic PAT의 발행 scope와 distribution 쓰기 권한 및 회전 책임을 따로 검증해야 한다.

산출물 전달 명세에는 SDK/버전, 원본 SHA·태그, 내부 workflow/run ID, 파일별 SHA256, POM 또는 package manifest, 검증 결과를 넣는다. dispatch payload의 URL/버전만 신뢰하지 않고 승인된 내부 저장소·성공한 run·허용 ref·artifact digest를 대조한다. Maven JAR만 전달하면 안 되며 POM·선택 sources/javadoc·Gradle module metadata의 일관성을 유지한다. deploy-file을 쓸 경우 `.module`과 POM marker의 처리까지 확인한다. npm은 검증한 동일 tarball을 발행한다. 이 전달 구현과 실제 Registry 연결은 Phase 3/4 검증 대상이다.

파트너 Read는 distribution 코드와 Actions 로그·접근 가능한 산출물에 대한 열람 가능성을 포함해 검토해야 한다. 내부 소스·비밀·내부 QA 문서를 발행 로그나 artifact에 남기지 않는다. Java sources JAR와 TS source map 및 docs의 공개 범위를 패키지 allowlist로 결정한다. Java가 현재 sources JAR를 생성한다는 사실만으로 외부 공개가 승인됐다고 보지 않는다.

### 파트너 운영

| 주체 | 내부 Monorepo | distribution | 패키지 |
| --- | --- | --- | --- |
| 내부 개발자 | Write | 필요한 관리자/릴리스 담당자만 Write | 역할별 관리 |
| 내부 CI | contents read, 검증 권한 | 교차 전달용 별도 최소 권한 | staging까지만 |
| distribution 발행 job | 승인 artifact 읽기만 | contents read | packages write |
| 파트너 담당자/CI용 계정 | 없음 | Read | 읽기만 |

일반 외부 설치 인증은 classic PAT의 `read:packages`와 계정의 대상 읽기 권한이 필요하다. 파트너 CI의 기본 `GITHUB_TOKEN`이 RecycleFarm 비공개 Maven/npm에 자동 접근한다고 안내하지 않는다. npm의 별도 Actions access 경로를 사용하려면 소비 저장소별 검증이 필요하다. fine-grained PAT를 classic PAT의 검증된 대체로 제시하지 않는다. 조직의 PAT 제한·SSO 적용 여부는 이번에 확인되지 않았다. [패키지 인증/권한 문서](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages).

파트너별 담당자와 CI 계정, 계약 종료일, 부여한 저장소 역할, 토큰 소유자·만료/회전 책임, 사용 버전을 내부 대장으로 관리한다. 토큰 원문은 대장·저장소에 기록하지 않는다. 신규 초대 수락 후 깨끗한 외부 환경에서 두 SDK를 설치한다. 종료 시 distribution 권한 및 별도 package/Actions 권한을 모두 회수하고 재설치 실패를 확인한다. 이미 다운로드된 패키지·캐시를 원격 회수할 수 있다고 보장하지 않는다.

outside collaborator는 조직 team에 직접 넣을 수 없다. 조직 API의 현재 plan은 free이며, 향후 유료 plan으로 바꾸면 private repository 외부 협업자 seat 비용을 함께 확인한다. 파트너 회사 수와 과금 계정 수는 다르다. [외부 협업자 공식 안내](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-outside-collaborators/adding-outside-collaborators-to-repositories-in-your-organization).

## 7. CI와 릴리스 정책

권한 승인 후 기존 두 저장소의 Actions 설정도 확인했다. enabled=true, allowed_actions=all, sha_pinning_required=false, default_workflow_permissions=read, can_approve_pull_request_reviews=false다. Actions 자체는 허용돼 있지만 현재 workflow/run은0개다. 후속 CI에서는 action SHA 고정을 코드에 명시하고 발행 job에만 필요한 packages:write를 부여하는 방안을 유지한다. 이번에는 설정을 바꾸지 않았다.

Java와 TS는 독립 SemVer 및 `java-vX.Y.Z`, `typescript-vX.Y.Z` 태그를 사용한다. 현재 버전은 개발 버전이며 `1.0.0`을 이미 승인됐거나 존재하는 버전으로 만들지 않는다. SDK 버전과 지원하는 Evidence/방법론/API 계약 버전은 compatibility 표에서 별도로 연결한다.

- Java 변경은 Java test/assemble/POM 확인과 Java worker 검증을 실행한다. TS 변경은 본체·worker·tarball 소비자 검증을 실행한다.
- contracts, 공통 검증 스크립트, 릴리스 전달 규약 변경은 양쪽 검증을 실행한다. 문서·배포 workflow 변경도 그 영향에 따라 패키지 검증을 포함한다.
- required check를 path filter로 아예 생성하지 않으면 PR이 pending에 머무를 수 있다. 항상 생성되는 집계 check와 언어별 조건 실행을 조합한다.
- 태그 release는 과거 CI 성공만 믿지 않고 정확한 태그 SHA를 다시 검증한다. 태그/manifest/파일 내 버전 일치, prerelease 처리, 동일 버전 재발행 차단, 언어별 concurrency를 검증한다.
- PR 검증과 발행 권한을 분리하고 외부 입력이 발행 job이나 비밀을 획득하지 못하게 한다. 승인된 action revision을 고정한다.
- 네이티브 지원 OS/arch와 Node22 검증을 먼저 확정한다. 현재 한 머신 tarball을 여러 플랫폼 지원 패키지로 내보내지 않는다.
- 운영 rollback은 공개된 버전 덮어쓰기보다 직전 정상 버전 pin과 새 수정 버전 발행을 기본으로 한다. 패키지 삭제는 별도 운영 조치다.

추가 조사에서 두 저장소의 main 브랜치 API는 protected=false를 반환했다. 상세 protection/rulesets API의 HTTP403은 현재 조직 Free plan에 대한 기능 제약 안내다. 현재 계정은 두 저장소 admin이므로 단순 저장소 관리자 권한 부족으로 해석하지 않는다. 비공개 조직 저장소 보호 규칙을 사용하려면 조직 소유자가 GitHub Team 또는 Enterprise 요금제를 검토해야 한다. 개인 Pro 업그레이드는 이 조직 요금제를 바꾸지 않는다. 이번에는 요금제나 보호 설정을 변경하지 않았다. [설정 안내](github-access-checklist.md).

## 8. Git 이력 보존과 단계별 이관

### Phase 2 승인 후 사전 고정

1. 두 저장소 모든 노출 refs를 다시 조회하고 기준 main/브랜치/태그 SHA·commit 수·작성자/날짜를 기록한다. 현재 HEAD가 바뀌었으면 이 문서의 기준을 갱신한다. 원본 전체 refs의 bundle/독립 백업과 복원 검증을 준비한다.
2. telemetry 2커밋의 유지/후속 병합 여부를 결정한다. 기본은 main을 제품 기준으로 사용하고 미병합 브랜치를 내부 보존 refs로 유지한다. 기능 변경을 이관과 섞지 않는다.
3. 기존 소비자, Maven/npm 실재 패키지와 설치 경로, 조직 인증 정책·보호 기능을 확인한다. package name/좌표와 native 플랫폼 정책의 결정 기록을 남긴다.

### Phase 2 소스와 이력 이관

원본 SHA 보존을 우선하면 히스토리를 재작성하지 않는 import 방식을 선택한다. 각 원본 main의 descendant에 경로 이동만 하는 커밋을 만들고 Java 파일 전체를 `sdks/java/`, TS 파일 전체를 `sdks/typescript/`로 옮긴 다음 두 이력을 unrelated-histories 병합으로 연결한다. 원래 커밋들은 조상이므로 SHA를 유지한다. 원본 커밋 시점의 파일은 여전히 루트에 있고 이동 커밋 이후 prefix 아래에 있다는 점을 문서화한다.

원본 모든 브랜치/태그는 언어 namespace의 보존 refs로 유지한다. telemetry도 원래 SHA를 가리키는 보존 브랜치를 남기되 제품 main에 자동 병합하지 않는다. 향후 병합은 prefix 이동을 반영한 별도 검토 작업이다. 원본 remote 브랜치를 복제했다고 새 origin에 자동 보존되는 것은 아니므로 명시적인 ref 목록과 도달성 검사가 필요하다.

`git filter-repo --to-subdirectory-filter`는 과거 경로까지 일관되게 바꾸지만 SHA와 서명 검증 관계를 바꾼다. 기본안으로 사용하지 않는다. 과거 경로 일관성이 더 중요하다는 별도 결정이 생기면 원본 bundle과 old→new SHA mapping을 필수 보존한다. source repo에 force push하지 않는다.

이관 완료 조건:

- 원본 기준 커밋이 새 main의 조상인지, 모든 보존 refs가 동일 원본 SHA를 가리키는지 확인한다.
- 단순 파일 이동 직후 원본 대비 모든 추적 파일 bytes·실행 비트·symlink가 보존됐는지 검사한다. 이후 경로 수정은 별도 커밋으로 구분한다.
- SDK 안에서 기존 명령으로 독립 빌드하고 루트 Makefile에서도 같은 검증을 실행한다. Docker build context, Java 예제의 `tools/greenfield` 상대 경로, TS 패키지 검사·문서 링크를 확인한다.
- 원본 저장소는 삭제·archive·기본 브랜치 변경 없이 유지한다. 새 저장소 push와 원본 전환 공지는 Phase 2 범위 승인 후 진행한다.

### Phase 3 CI와 발행 준비

각 언어 CI와 안정적인 required check를 구성하고, 독립 태그 검증 및 승인 artifact 전달 규약을 구현한다. distribution의 실제 발행 workflow, 패키지 allowlist, 파트너 문서 생성 절차를 분리한다. Java 소문자 artifactId, npm scope/name/private 설정과 잠금 파일·검증 consumer를 갱신한다. 패키지 변환 전후 소비자 호환성을 확인한다. 아직 발행하지 않는 dry-run으로 산출물 구성과 메타데이터를 검토한다.

### Phase 4 Registry와 외부 계정 검증

실제 발행은 별도 승인된 범위에서 수행한다. 내부 Monorepo 접근이 없는 outside collaborator 계정으로 distribution Read+개별 읽기 토큰을 사용해 Gradle/Maven 설치와 npm 설치·타입 검사·ESM·native/worker 동작을 검증한다. 권한 없는 계정의 거부, 초대 취소/권한 회수 후 새 다운로드 거부, 파트너 CI, 토큰 회전도 확인한다. 내부 GitHub 문서 열람 실패가 유지되는지 함께 검사한다. 토큰 사용자에 개발 저장소 권한이 이미 있다면 분리 검증의 증거가 될 수 없다.

### Phase 5 운영 문서와 전환

내부 가이드와 파트너 설치 가이드, compatibility, changelog, 온보딩/오프보딩, 장애·rollback 절차를 확정한다. 기존 설치 경로를 쓰는 소비자의 전환 기간과 지원 버전을 공지한다. 원본 저장소 archive 여부는 이관 완료와 별개 결정으로 남긴다.

## 9. 위험과 진행 조건

| 위험 | 확인 사실 / 영향 | 다음 조치 |
| --- | --- | --- |
| Java 패키지명 제약 | 현재 RecanetJava 대문자 artifactId는 GitHub Maven에 부적합 | 소문자 좌표 및 기존 소비자 전환 확정 |
| npm 미배포 설정 | unscoped·private 상태, 소비자 검사에 기존 이름 하드코딩 | scope/name·publish 설정·lock/consumer 동시 전환 |
| 분리 저장소 발행 | 내부 GITHUB_TOKEN만으로 배포 저장소 발행을 가정할 수 없음 | distribution 실행 토큰·artifact 전달 검증 |
| native 이식성 | 빌드 OS/arch용 .node, C compiler/headers 필요 | 지원 행렬·prebuild/명시 재빌드 방식 결정 |
| 의존성 보안 | Greenfield high8 포함28건, Java OSV 고유12건(critical2 포함) 및 BC 중복4245클래스 | 사용 경로·버전 정합성 검토. 이번에는 변경하지 않음 |
| 기능 차이 | TS petV3/UTF8 수정, Java 전용 편의 API·telemetry 브랜치 | telemetry221+worker12 통과. 자동 병합 없이 compatibility에 별도 표시 |
| 보호 기능 제약 | 두 main protected=false, 조직 Free, 상세 API403 | 조직 Team/Enterprise 검토. 실제 규칙 생성은 후속 단계 |
| 외부 공개 범위 | sources JAR, TS docs/source maps, Actions 로그 노출 가능 | 외부 allowlist와 내부 문서 제외 검증 |
| 이력/경로 | 숨김 파일·미병합 브랜치·상대 경로 유실 가능 | 모든 refs/bytes/모드/빌드 context 검사 |
| 공통 계약 과신 | ABI 일치가 전 입력·오류·validator 동등성을 보장하지 않음 | 출처 있는 공통 벡터부터 교차 실행 |
| 라이선스 | 두 SDK 자체 LICENSE 없음 | 파트너 제공 조건·제3자 고지 정책 확인 |

접근 불가/미확인 항목:

1. 사용자 승인으로 read:packages가 적용돼 조직 Maven/npm 목록 API가 모두HTTP200으로 성공했다. pagination을 포함한 현재 계정 조회 결과는 각각 빈 목록이며, 두 SDK 저장소의 연결 패키지도 GraphQL에서 각각0개였다. 따라서 개별 버전·visibility·권한을 조사할 기존 대상은 발견되지 않았다. 조직 전체의 숨겨진 패키지나 과거 삭제 이력은 이 결과로 배제하지 않는다. Registry 설치/배포 인증은 검증하지 않았다.
2. 두 main의 protected=false는 추가 API에서 확인했다. 조직 plan=free와 현재 계정의 repository admin도 확인했다. 상세 protection/rulesets는 기능 요금제 제약으로 여전히 조회되지 않는다.
3. 실제 파트너 목록·외부 계정·각 CI·PAT/SSO 제한·패키지 상속 설치 경로는 확인되지 않았다. 운영 가능성은 공식 문서 기반 설계이며 실증 완료가 아니다.
4. telemetry 브랜치는 추가 검증에서 빌드와 JUnit221개 및 worker12개가 통과했다. main 병합·운영 수용·OTLP 실서비스 연결은 수행하지 않았다.
5. 사용자가 recanet-sdk의 기존 로컬 경로가 없다고 확인했다. 결과물에 문서만 준비했으며 새 GitHub 저장소를 생성한 상태가 아니다.

Phase 1 종료 상태: 실측 구조·빌드·API·의존성·CI·refs·기능 차이 조사 및 승인 후 패키지 접근 재확인을 완료했다. 추가 사용자 권한 요청은 없으며, 미확인 범위와 후속 운영 검증을 구분해 설계 가이드에 기록했다. Phase 2 이후 실행, 원본 변경, 새 저장소 생성, Registry 발행은 수행하지 않았다.

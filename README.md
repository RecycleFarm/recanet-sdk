# Recanet SDK

Privy 기반 서버 지갑, EVM 자산·트랜잭션 조회, DMRVN 연동을 제공하는 Java·TypeScript SDK 모노레포다. 사용자 토큰 검증, 회원별 지갑 조회·생성·서명, Evidence 저장과 Claim 제출·조회 기능을 제공한다. 공통 입력·결과·오류 계약은 [공통 Contract](contracts/recanet-sdk-contract.md)에 정의한다.

두 SDK의 GitHub Packages 릴리스 버전은 `0.1.0-rc.2`다.

## SDK 설치와 사용

| SDK | 사용 환경 및 배포 형태 | 안내 |
| --- | --- | --- |
| TypeScript / ESM JavaScript | Node 22(`>=22 <23`), Ubuntu 24.04 Linux x64 또는 macOS ARM64. 두 플랫폼의 네이티브 바이너리를 포함해 배포 | [Registry 설치 방법](sdks/typescript/README.md#github-packages에서-설치) |
| Java | JDK 17. 의존성 메타데이터와 함께 사용하는 라이브러리 JAR | [Registry 설치 방법](sdks/java/README.md#github-packages에서-설치) |

GitHub Packages에서 설치하려면 GitHub 계정의 classic PAT(`read:packages`)를 사용한다.

TypeScript 배포 패키지 사용자는 C compiler·Node headers가 필요 없다. Java SDK 자체는 Node 네이티브 모듈을 사용하지 않으며, Greenfield 어댑터를 사용할 때는 별도의 Node worker가 필요하다. 현재 CI의 Java 기준 환경은 Linux x64다. Java 로컬 macOS 빌드·테스트 결과와 TypeScript 플랫폼 검증을 Java의 전체 macOS 배포 인수로 확대하지 않는다.

API 자격 증명·RPC·Greenfield 설정은 사용하는 기능에 맞게 제공한다. SDK는 `.env` 파일을 자동으로 읽지 않는다. 실제 서비스 연동과 권한·비용 처리는 각 SDK 안내를 따른다.

## 소스 개발과 로컬 검증

저장소 루트에서 실행한다. JDK 17, Node 22, npm, Python 3, make가 필요하다. TypeScript 네이티브 모듈을 소스에서 빌드할 때만 C compiler와 Node-API headers가 필요하다. macOS 개발자는 Xcode Command Line Tools를 준비하고, headers 자동 탐색이 실패하면 `RECANET_NODE_INCLUDE`에 `node_api.h`가 있는 디렉터리를 지정한다.

```sh
make install
make test
```

`make install`은 두 SDK의 npm 의존성을 설치한다. Java 의존성은 Gradle 빌드·테스트에서 내려받는다. `make test`는 Java와 TypeScript 본체 테스트를 실행하며, 전체 worker·패키지·공통 계약 검사를 모두 포함하지는 않는다.

```sh
# 현재 머신용 SDK 빌드
make build

# 각 SDK와 worker 검사
make java-check
npm --prefix sdks/typescript run check
npm --prefix sdks/typescript run test:security

# 양언어 공통 동작 및 공개 API 검사
make contract-test
make contract-check
make verify-api
```

패키징 검사(`npm --prefix sdks/typescript run check:package`, `make typescript-check`, `make check`)에는 **현재 native 소스와 일치하는 Linux x64·macOS ARM64 바이너리가 모두 필요**하다. 로컬 `make build`는 현재 머신용 파일만 생성하므로, 다른 플랫폼 파일은 [TypeScript README의 패키징 절차](sdks/typescript/README.md#sdk-소스-개발-및-패키징)에 따라 CI 산출물에서 준비한다. CI는 두 OS에서 빌드·실행 검증한 산출물을 자동으로 모은다.

`make check`는 추가로 고정 이관 tree·보존 refs와 의존성 보안을 검사하며, 보안 조회에는 네트워크 접근이 필요하다. 새 clone에서 이관 검사를 실행하려면 전체 이력과 다음 로컬 보존 refs가 있어야 한다. shallow clone은 먼저 `git fetch --unshallow`로 전체 이력을 받는다.

```sh
git fetch origin 'refs/heads/legacy/*:refs/heads/legacy/*'
make check
```

`make help`에서 명령 목록을 확인할 수 있다. 기본 검사는 로컬 fixture와 loopback 서버를 사용하며 실제 지갑 생성·거래 전송·Greenfield 쓰기·패키지 발행을 하지 않는다. 별도 live 태그·예제 task는 기본 검사에 포함되지 않는다.

## 플랫폼 검증

커밋 `e60258a`에서 Linux x64와 macOS ARM64·Node 22.23.5의 테스트 296개, 일반 설치와 `--ignore-scripts` 설치 후 네이티브 journal 실행을 확인했다. 컴파일러·헤더 설정을 사용할 수 없는 경로로 지정한 패키지 소비자 검사도 통과했다. 이 결과는 해당 커밋의 검증 기록이며 이후 모든 커밋의 성공을 뜻하지 않는다.

- [두 플랫폼 TypeScript CI](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44055757655)
- [공통 SDK Contract CI](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44055757599)
- [Java CI](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44055757719)

## 디렉터리와 문서

| 경로 | 역할 |
| --- | --- |
| [sdks/java](sdks/java) | Java SDK, Gradle 빌드, 테스트, 예제, Greenfield worker |
| [sdks/typescript](sdks/typescript) | TypeScript SDK, 네이티브 소스·빌드 스크립트, 테스트, Greenfield worker |
| [contracts](contracts) | 공통 동작 계약, API 대응표, 현재 공개 API baseline |
| [examples](examples) | 언어별 예제 위치와 실행 안내 |
| [scripts](scripts) | CI·패키징·보안·API·이관 검증 도구 |
| [docs](docs) | 설계, 호환성, 릴리스 절차와 과거 이관 기록 |

- [현재 공통 API 계약](contracts/api-reference.md) · [TypeScript API 변경 안내](contracts/typescript-migration.md)
- [호환성 기록](docs/compatibility.md) · [CI와 릴리스 가이드](docs/release-guide.md)
- [이관 가이드](docs/monorepo-migration-guide.md) · [Phase 2 이관 기록](docs/migration/phase2-migration.md)
- [과거 Linux rc.1 후보 검증](docs/migration/phase4-rc1-validation.md) · [보안 수정 기록](docs/security/rc1-remediation.md)

과거 Phase 문서는 당시 결과를 보존한 기록이다. 현재 패키지 구성과 설치 지원 범위는 각 SDK README 및 CI 설정을 확인한다.

## Git 이력과 개발 기준

Phase 2 이관에서는 원본 두 main의 소스를 각 SDK 경로로 이동한 뒤 Git 이력을 연결했다. 원본 커밋 SHA·작성자·날짜는 재작성하지 않았다. 과거 원본 커밋의 파일은 당시 루트 경로에 있고 이동 커밋 이후 `sdks/` 경로에 있다.

보존 브랜치는 원본 SHA를 그대로 가리킨다.

```text
legacy/java/main
legacy/java/codex/sdk-telemetry
legacy/typescript/main
```

telemetry는 이관 시 보존만 했고 통합 SDK에 병합하지 않았다. 위 브랜치에는 원래 SDK 루트 구조가 남아 있으므로 현재 Monorepo 구조와 혼동하지 않는다. 현재 기능과 설치 지원 범위는 이 README 및 각 SDK README를 기준으로 확인한다.

Phase 2 보존 검사는 고정 import commit의 원본 tree와 legacy refs·조상 관계를 확인한다. 이후 승인된 SDK 변경을 허용하되 과거 이관 tree나 원본 SHA를 덮어쓰지 않는다. 공개 API 검사는 현재 빌드 결과를 `contracts/public-api-baseline.json`과 비교하며 기존 Phase 2 baseline은 보존한다. API 변경을 자동 승인하는 도구는 아니다.

## 배포 상태

GitHub Packages의 Java 좌표는 `com.youngminkim.recanet:recanet-sdk-java:0.1.0-rc.2`, npm 패키지명은 `@recyclefarm/recanet-sdk@0.1.0-rc.2`다. [릴리스 가이드](docs/release-guide.md#github-packages-발행)

Java 후보는 라이브러리 JAR·Javadoc JAR·POM·Gradle module metadata와 별도 Greenfield worker를 포함한다. sources JAR는 생성·배포하지 않는다. npm 후보는 runtime JS·타입·resources·두 플랫폼 네이티브 바이너리·Greenfield worker를 포함하며 source map과 내부 문서는 제외한다. npm README와 필수 라이선스 고지는 포함한다.

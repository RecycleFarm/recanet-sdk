# Recanet SDK

내부 개발용 Java·TypeScript SDK Monorepo다. 기존 저장소의 소스와 Git 커밋을 보존하여 Phase 2 이관을 수행했다. 언어별 CI와 내부 릴리스 후보 워크플로를 구성했다. 실제 패키지 배포나 파트너 접근 설정은 아직 구성하지 않았다.

## 시작하기

JDK17, Node22+, npm, Python3, make를 사용한다. TypeScript의 FileOperationJournal native 빌드에는 지원 OS의 C compiler와 Node headers가 필요하다. 현재 지원 검증 범위와 제약은 [호환성 기록](docs/compatibility.md)에 있다.

```sh
make install
make check
```

개별 SDK 명령도 그대로 사용할 수 있다.

```sh
(cd sdks/java && ./gradlew test assemble)

# 저장소 루트에서 실행
npm --prefix sdks/typescript run check
npm --prefix sdks/typescript run check:package
```

`make help`에서 전체 명령을 확인할 수 있다. `make check`는 원본 이력·소스 트리, Java/worker/WASM, TypeScript/worker/tarball 소비자, 공개 API baseline을 검증한다. 실제 지갑 생성·거래 전송·Greenfield 저장이나 패키지 발행은 실행하지 않는다.

## 디렉터리

| 경로 | 역할 |
| --- | --- |
| [sdks/java](sdks/java) | 원본 Gradle Java SDK 전체, 언어별 문서·예제·worker 포함 |
| [sdks/typescript](sdks/typescript) | 원본 npm TypeScript SDK 전체, native·worker·테스트 포함 |
| [docs](docs) | 구조 설계, 조사 근거, 이관·호환성 기록 |
| [scripts](scripts) | Phase 2 이력·소스·공개 API 보존 확인 |
| [contracts](contracts) | 공통 검증의 경계 안내. 기존 fixture는 각 SDK에 유지 |
| [examples](examples) | 실제 SDK 내 기존 예제 연결 |

## 설계와 이관 기록

- [Monorepo 구조와 마이그레이션 가이드](docs/monorepo-migration-guide.md)
- [CI와 릴리스 후보 가이드](docs/release-guide.md)
- [Phase 2 이관 결과](docs/migration/phase2-migration.md)
- [원본 refs·SHA·트리·백업 기록](docs/migration/phase2-source-manifest.json)
- [API 보존 baseline](docs/migration/phase2-public-api-baseline.json)
- [공개 API 조사 부록](docs/api-inventory.md)
- [Phase 1 추가 검증과 의존성 보안 결과](docs/phase1-additional-validation.md)
- [GitHub 접근 설정과 현재 제약](docs/github-access-checklist.md)

## Git 이력과 개발 기준

`main`은 원본 두 main의 소스를 각 SDK 경로로 이동한 뒤 두 이력을 연결한 브랜치다. 원본 커밋 SHA·작성자·날짜는 재작성하지 않았다. 과거 원본 커밋의 파일은 당시 루트 경로에 있고 이동 커밋 이후 `sdks/` 경로에 있다.

보존 브랜치는 원본 SHA를 그대로 가리킨다.

```text
legacy/java/main
legacy/java/codex/sdk-telemetry
legacy/typescript/main
```

telemetry는 보존만 했고 제품 main에 병합하지 않았다. 위 브랜치에는 원래 SDK 루트 구조가 남아 있으므로 현재 Monorepo 구조와 혼동하지 않는다. 새 기능 개발은 main에서 시작한다.

Phase 2 보존 검사 스크립트는 이관 기준으로 원본과의 정확한 일치를 확인한다. 후속 승인된 SDK 변경이 생기면 이관 검사를 별도 검증으로 분리하거나 baseline 갱신을 명시적으로 검토해야 한다. 변경된 API를 자동 승인하는 스크립트가 아니다.

## 배포 상태

Java 좌표와 TypeScript 패키지명·버전·private 설정은 원본을 유지했다. GitHub Maven에서 기존 대문자 artifactId를 사용할 수 없다는 제약과 native 플랫폼·의존성 보안 문제는 아직 해결하지 않았다. 운영 배포 준비 완료를 의미하지 않는다. release workflow는 테스트와 내부 산출물 보관까지만 수행한다. GitHub Packages 발행, distribution 저장소, 파트너 권한은 후속 단계 범위다.

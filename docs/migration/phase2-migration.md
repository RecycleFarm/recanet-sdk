# Phase 2 Monorepo 이관 기록

이관일: 2026-11-17 KST. 내부 Private 저장소: [RecycleFarm/recanet-sdk](https://github.com/RecycleFarm/recanet-sdk). 패키지 발행, distribution 저장소 생성, 배포 CI, 원본 저장소 변경은 범위에서 제외했다.

## 이관 결과

Java SDK를 `sdks/java`, TypeScript SDK를 `sdks/typescript`에 배치했다. 각 SDK의 추적 파일 전체와 빌드·테스트·도구·문서·lockfile을 원본 그대로 유지했다. 공통 명령은 루트 Makefile에 추가했다. [구조 설계 가이드](../monorepo-migration-guide.md)와 Phase 1 조사 근거를 프로젝트 docs에 포함했다.

| 원본 | 기준 main SHA | 추적 파일 | 보존 브랜치 |
| --- | --- | --- | --- |
| RecycleFarm/recanet-java | 37c78cfa01d9892ca26de61bb74df827923917cf | 96 | legacy/java/main |
| RecycleFarm/recanet-typescript | eb132e7d03110d7238e14627b3f87be6cb7b8798 | 153 | legacy/typescript/main |

Java 미병합 `codex/sdk-telemetry`는 `legacy/java/codex/sdk-telemetry`에 원본 SHA `0e8fcaf7675e2cd607ff7d4e3805c4476c60434b` 그대로 보존했다. Java 전체8개·main6개 커밋과 TS56개 커밋이 보존 대상이다. 원본 태그는 두 저장소 모두0개였다. telemetry를 main에 병합하지 않았다.

## 이력 보존 방식

1. 원본 원격 저장소를 별도 bare mirror로 읽기 복제했다.
2. 모든 노출 refs를 bundle로 백업하고, 각 bundle을 새 bare 저장소로 복원해 refs 일치 및 `git bundle verify`를 확인했다.
3. Monorepo 안에 원본 branch/tag refs를 언어별 legacy namespace로 가져왔다.
4. 각 원본 main의 자식에 경로 이동만 하는 커밋을 만들었다. 원본 커밋 자체를 다시 쓰지 않았다.
5. Java와 TS 이동 커밋을 unrelated-histories merge로 연결했다. 통합 커밋은 `4507e3f68d66bec362ddcfe2498ac0aa03eb2708`이다.
6. 루트 문서·Makefile·보존 확인 스크립트를 별도 커밋으로 추가했다.

prefix 이동 커밋과 원본 tree ID는 [소스 manifest](phase2-source-manifest.json)에 있다. `HEAD:sdks/java`와 원본 Java tree, `HEAD:sdks/typescript`와 원본 TS tree가 각각 정확히 같음을 검사했다. Git tree는 파일 경로·blob·모드를 포함하므로 파일 내용뿐 아니라 실행 비트와 symlink도 보존한다. 각 원본 main이 통합 main의 조상임을 확인하고, legacy refs가 원본 SHA를 가리키는지도 검증했다.

과거 원본 커밋을 checkout하면 파일은 당시 루트 경로에 있다. 새 이동 커밋 이후에만 `sdks/` 구조가 적용된다. 이는 원본 SHA를 유지하기 위한 선택이다. telemetry 보존 브랜치도 원래 루트 구조를 유지한다. 현 Monorepo에서 새 작업은 main을 기준으로 시작한다.

원본 저장소에는 push, branch 이동, default 변경, archive, 태그·릴리스·Actions 설정 변경을 수행하지 않았다. 새 origin은 recanet-sdk만 가리키며 원본 원격은 push remote로 등록하지 않았다.

## 검증 결과

macOS ARM64, Zulu JDK17.0.18, Node22.23.5에서 실행했다. npm 의존성은 기존 lockfile을 사용해 `make install`로 설치했다. TypeScript native는 Node22 공식 headers로 빌드했다.

| 검증 | 결과 |
| --- | --- |
| `make check` | 종료코드0 |
| 원본 refs·SHA·조상·하위 tree 동일성 | 통과, SDK 추적 파일 변경0 |
| Java test/assemble/POM | 성공, JUnit126개 실패·오류·skip0 |
| Java examplesClasses | 컴파일 성공. 예제 실행은 하지 않음 |
| Java Greenfield worker | 8개 통과, 실패·skip0 |
| Java PET WASM | 기존 고정 로컬 벡터 통과. 운영 승인 증거 아님 |
| TypeScript 본체 / worker | 267개 / 14개 통과, 실패·skip0 |
| TypeScript packed consumer | 실제 tarball 설치, strict 타입, ESM/native, 동봉 문서 링크 검사 통과 |
| Java 공개 선언 비교 | 원본 JAR의66개 class entry에서 추출한 public 선언·상수와 이관 JAR 결과 동일 |
| TypeScript 선언 비교 | 원본과 이관 결과의59개 .d.ts 파일 경로·SHA256 동일 |
| Git 복원·객체 무결성 | 두 원본 bundle 복원 및 fsck 확인 |

[검증 결과 JSON](phase2-validation.json), [API baseline](phase2-public-api-baseline.json)을 함께 보존한다. Java public 최상위 타입 수39개와 class entry66개는 서로 다른 집계다. class entry에는 내부·중첩 타입도 포함한다. TS59개 선언 파일 역시 직접 공개 exports만의 수가 아니다. 소스 tree 전체 일치와 함께 공개 API 보존의 근거로 사용한다.

## 변경하지 않은 항목

Java의 group/artifact/version과 Java package, TypeScript의 package name/version/private/exports, 의존성 버전, 각 언어별 문서·실행 도구·fixture를 그대로 유지했다. Greenfield worker 차이와 PET v3 프로필 차이도 유지했다. 이관 중 기능 정합성 수정이나 보안 의존성 업그레이드는 하지 않았다.

루트 Makefile의 Java 명령은 `sdks/java`에서 실행하므로 기존 예제의 `tools/greenfield` 상대 경로를 보존한다. TS Dockerfile도 그대로 유지했으며 향후 실행 시 `sdks/typescript`를 build context로 사용한다. 이번 머신에는 컨테이너 실행 도구가 없어 Docker/Linux 검증은 실행하지 않았다.

## 후속 범위

Phase 3의 CI·release workflow, Maven 소문자 artifactId 전환, npm scope/name과 native 배포 전략, dependency 보안 정합성 수정은 아직 수행하지 않았다. Phase 4의 실제 Registry 발행과 외부 파트너 설치·권한 회수도 미실행이다. `recanet-sdk-distribution`은 생성하지 않았다.

이관 baseline 검사 스크립트는 승인된 이번 스냅샷을 확인하는 도구다. 이후 기능 개발로 SDK를 의도적으로 변경하면 baseline의 의미와 갱신 범위를 검토해야 한다. API 변경을 자동으로 승인하거나 전체 의미적 호환성을 증명하는 도구로 사용하지 않는다.

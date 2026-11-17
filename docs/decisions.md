# Phase 2 이관 결정

2026-11-17 승인 범위는 기존 저장소를 변경하지 않고 Git 이력과 공개 API를 보존하는 Monorepo 이관이다.

1. 원본 main을 제품 기준으로 사용한다. telemetry는 legacy 브랜치로 보존하고 자동 병합하지 않는다.
2. 원본 SHA를 유지한다. 과거 모든 경로를 다시 쓰는 filter-repo 대신 prefix 이동 커밋과 unrelated-histories merge를 사용한다.
3. Java·TypeScript 각 전체 추적 파일, 실행 비트, resources, lockfile, 문서와 도구를 그대로 유지한다. SDK 하위 트리 SHA 일치로 확인한다.
4. 빌드는 독립 실행한다. 루트 Makefile은 기존 디렉터리에서 기존 명령을 호출한다. Java 실행 예제의 상대 경로도 유지한다.
5. 패키지명·좌표·버전·의존성을 유지한다. Maven 소문자 artifactId, npm scope 및 native 배포 전략은 Phase 3 이후 별도 결정이다.
6. 기존 Phase 1 문서를 프로젝트 docs에 포함한다. 공통 계약이나 새 실행 예제를 발명하지 않는다.
7. 내부 Private recanet-sdk의 생성과 소스 push는 Phase 2 결과 전달에 포함한다. distribution 저장소, Registry 발행, release CI, 원본 archive·설정 변경은 수행하지 않는다.

## Phase 3 범위

사용자는 언어별 CI와 릴리스 워크플로를 승인하고 실제 패키지 배포는 보류했다. 따라서 릴리스는 테스트·버전/출처 검증과 내부 Actions artifact 생성까지만 구성했다. Registry·GitHub Release·distribution 발행과 패키지명 변경을 포함하지 않았다. 구현과 실제 실행은 [Phase 3 기록](migration/phase3-ci.md)에 있다.

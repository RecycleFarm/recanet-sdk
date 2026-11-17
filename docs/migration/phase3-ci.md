# Phase 3 CI와 릴리스 준비 검증

2026-11-17 KST. 승인 범위는 recanet-sdk의 언어별 빌드·테스트 CI와 릴리스 워크플로 구성이다. 실제 패키지는 발행하지 않았다. 기존 두 원본 저장소와 SDK 소스·패키지 이름·버전·의존성을 변경하지 않았다.

## 구성 결과

- `.github/workflows/java-ci.yml`: Java 변경과 공통 변경을 감지해 Ubuntu24.04에서 JDK17/Node22.23.5로 검사한다.
- `.github/workflows/typescript-ci.yml`: TS 변경과 공통 변경을 감지해 Ubuntu24.04 x64, macOS15 ARM64에서 검사한다.
- `.github/workflows/java-release.yml`: Java tag 또는 수동 실행의 정확한 version·main 조상·테스트·API를 검증하고 Maven 경로의 내부 후보를 만든다.
- `.github/workflows/typescript-release.yml`: 같은 규칙으로 Linux x64용 npm tarball 후보를 만든다.
- 공통 toolchain action과 외부 action commit SHA 고정, contents:read 권한, timeout·concurrency, 내부 artifact 보관 기간을 설정했다.

PR/main push의 최종 `Java checks`, `TypeScript checks` job은 변경 파일에 관계없이 생성된다. 선택한 검사 실패를 성공으로 처리하지 않는다. 단, 현재 조직 요금제의 보호 규칙 제약 때문에 이 job을 플랫폼이 필수 병합 조건으로 강제한다고 주장하지 않는다.

## 실제 원격 실행

검증 revision: `b1f8f73f4d62c907a55213a536f67742257c4e2f`.

| 실행 | 결과 |
| --- | --- |
| [Java CI](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44016607813) | 성공. JUnit126개, worker8개, 예제 컴파일·로컬 WASM·JAR/POM·공개 API 통과 |
| [TypeScript CI](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44016607827) | Ubuntu/macOS 각각 본체267+worker14개와 tarball 소비자·타입 검사 통과 |
| [Java Release Candidate](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44016621384) | 수동 version=0.1.0-SNAPSHOT. 전체 검사 후 내부 후보 생성 성공 |
| [TypeScript Release Candidate](https://github.com/RecycleFarm/recanet-sdk/actions/runs/44016628198) | 수동 version=0.1.0. 전체 검사 후 내부 후보 생성 성공 |

Java CI에서 업로드한 JUnit XML14개를 내려받아 테스트126개/실패0/오류0/skip0을 확인했다. TS 두 runner의 본체267개와 worker14개는 각 실행 로그에서 실패0을 확인했다. Java66개 class entry의 public 선언과 TS59개 타입 선언파일도 기존 baseline과 동일하다.

로컬에서는 actionlint 문법 검사와 CI·릴리스 규칙 테스트16개를 통과했다. 잘못된 버전·다른 언어 태그·수동 입력 누락·main 외 commit·누락된 native 파일·메타데이터 불일치·후보 덮어쓰기 거부 등을 검사했다. 실제 태그를 생성해 시험한 것은 아니며 태그 해석·거부는 이 규칙 테스트로 검증했다.

두 원격 후보 artifact를 직접 내려받아 manifest의 source commit·version·published=false·publishReady=false와 SHA256SUMS의 모든 파일을 확인했다. Java의 JAR/source/javadoc/POM/module 구성과 TS tarball의 package metadata도 확인했다. 후보 manifest는 실제 빌드 플랫폼을 Linux x86_64/Node22.23.5로 기록했다. [구조화된 실행·체크섬 근거](phase3-ci-validation.json), [action 고정 revision](phase3-action-pins.json).

## 발행하지 않은 범위

워크플로에 npm publish, Gradle publish, Maven deploy, Registry 업로드, GitHub Release 생성이나 distribution 전달 step이 없다. packages:write/contents:write 권한·별도 토큰·배포 Secrets도 부여하지 않았다. 실제 태그를 만들지 않았고 release 후보는 Actions의 내부 artifact로만 저장했다.

Java 대문자 artifactId, TS private/scope/name, native 범용 배포 전략, 기존 의존성 보안 문제와 파트너 권한은 그대로 남아 있다. 외부 파트너 설치와 실제 Registry 발행은 별도 승인된 후속 단계다.

운영 방법과 후보 다운로드·체크섬 확인 절차는 [릴리스 가이드](../release-guide.md)를 따른다.

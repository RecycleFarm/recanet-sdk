# Phase 1 추가 검증 결과

확인일: 2026-11-17 KST. Phase 2는 진행하지 않았다. 기존 저장소의 코드·브랜치·설정 변경, 새 GitHub 저장소 생성, push, 패키지 배포는 모두 미실행이다. 분석 복제본과 별도 브랜치 소스 사본에서 검증하고 가이드만 갱신했다.

추가로 확인 가능한 항목은 Node22 실행, Java telemetry 브랜치, Java 외부 소비자, 제한된 언어 간 JSON 계약, Java 런타임 의존성 보안, 현재 브랜치 보호 상태다. 이후 사용자 승인으로 read:packages가 적용되어 패키지 API 접근도 성공했다. 현재 계정에서 Maven/npm과 두 SDK 연결 패키지는 모두0개였다. 승인 후 재확인은 아래5절에 기록했으며 [GitHub 접근 설정 안내](github-access-checklist.md)도 완료 상태로 갱신했다.

## 1. 추가로 완료한 실행 검증

기준 main/telemetry SHA는 원격 refs를 다시 조회했으며 최초 조사와 동일했다. Java main `37c78cf`, Java telemetry `0e8fcaf`, TS main `eb132e7`을 사용했다. macOS ARM64 / Java17.0.18 환경에서 실행했다.

| 항목 | 실행 범위와 결과 |
| --- | --- |
| Node22.23.5 전체 check | Node22와 해당 버전 공식 headers로 native를 다시 빌드. 본체267+worker14=281개 통과, 실패·skip0, 종료코드0 |
| Node22 패키지 검증 | 실제 tarball 설치, strict Node 타입 컴파일, ESM·native 실행, 동봉 문서 링크 검사 통과. 200파일/196,540bytes, 종료코드0 |
| Java telemetry 브랜치 | `test assemble` 성공. JUnit221개, 실패·오류·skip0. 원본 main에 병합하지 않음 |
| telemetry Greenfield worker | 별도 npm 설치 후 테스트12개 통과, 실패·skip0 |
| Java 외부 소비자 | SDK main JAR만 컴파일 경로에 두고 config/JSON/ownerHash를 사용하는 별도 Java17 예제 컴파일 성공. resolved runtime 의존성을 더한 실행도 성공 |
| Java 공개 시그니처 | `jdeps --api-only -verbose:class`에서 참조 대상은 SDK 자체와 java.base/java.net.http였다. 외부 라이브러리 타입 누출은 이 검사에서 발견되지 않음 |
| Java/TS 교차 JSON | 양쪽 main 구현을 직접 실행해 58개 입력 대조. 성공54개는 canonical bytes와 Keccak 해시 일치, 거부4개는 오류 코드 일치 |

교차 입력은 기존 escape fixture 9개, 별도 입력17개, 제어문자32개다. 중첩 객체·키 정렬·한국어/emoji·소수/지수·수치 경계·특수 키 등을 포함한다. 큰 정수 등 거부된 입력은 parse→bytes→hash 파이프라인 중 오류가 난 경우이며, 파서 자체가 반드시 거부했다는 뜻은 아니다. 언어별 예외 클래스명을 동일성 조건으로 삼지 않고 `INVALID_INPUT` 같은 오류 코드를 비교했다.

이 검증은 기존 Java 호환 canonicalizer끼리의 비교다. RFC8785/JCS 준수, 모든 입력·API·시간 경계·취소·오류·서명·validator 수용을 증명하지 않는다. 이번에 새 공통 contracts 구현이나 SDK 테스트 파일을 추가한 것은 아니며 분석용 probe만 사용했다. [58개 상세 결과](migration/cross-json-results.json).

외부 Java 소비자 검증은 원격 Maven 설치가 아니라 생성 JAR의 오프라인 컴파일/실행 검사다. telemetry의 OTLP exporter 또는 실서비스 연결은 실행하지 않았다. 기존 Node25 결과를 Node22 결과로 바꿔 적지 않고 별도 검증으로 구분했다.

## 2. Java 직접·전이 의존성 보안

Gradle이 실제 resolve한 main runtime 의존성13개와 telemetry에 추가된 OpenTelemetry 의존성3개를 이름·버전 기준으로 [OSV API](https://google.github.io/osv.dev/post-v1-query/)에 조회했다. pagination이 있는 경우 다음 페이지도 조회하는 방식으로 실행했고 withdrawn 표시는 없었다. 소스나 비밀값은 보내지 않고 외부 라이브러리 좌표와 버전만 조회했다.

main의 4개 구성요소에서 고유 보안 권고12건이 반환됐다. 중복 advisory ID를 제거한 심각도는 critical2 / high7 / moderate3이다. 패키지별 중복을 합산하면16건이므로 16개 서로 다른 취약점으로 보고하지 않는다. OpenTelemetry api/common/context 1.68.0의 추가3개는 조회 결과가 없었다. 이는 등록된 권고가 없다는 의미이며 무취약 증명은 아니다.

| 구성요소 | 버전 | 반환 권고 수 | 권고 ID |
| --- | --- | --- | --- |
| jackson-core | 2.22.1 | 2 | GHSA-7hhh-6rmp-j9qf, GHSA-p6pp-m3f8-5c89 |
| jackson-databind | 2.22.1 | 5 | GHSA-cxp5-3px4-pw24, GHSA-gx83-3vf8-gh7j, GHSA-q4xh-88c3-wmh7, GHSA-wjgm-6hv5-3cvf, GHSA-wv8q-qhhj-9h54 |
| bcprov-jdk15to18 | 1.83 | 4 | GHSA-574f-3g2m-x479, GHSA-9pwp-9qqc-pr26, GHSA-c3fc-8qff-9hwx, GHSA-qp49-qgx5-5m26 |
| bcprov-jdk18on | 1.80 | 5 | 위 BC4건과 GHSA-p93r-85wp-75v3 |

대표적으로 Jackson 공급자는 특정 JSON parser의 오류 토큰 길이 제한 누락을 공지하고 있다. Bouncy Castle 공급자도 1.85 보안 수정에 이름 제약 우회 등을 명시한다. [Jackson 공급자 권고](https://github.com/FasterXML/jackson-core/security/advisories/GHSA-7hhh-6rmp-j9qf), [Bouncy Castle 공급자 릴리스](https://www.bouncycastle.org/resources/new-release-bouncy-castle-java-1-85/).

보안 데이터베이스의 버전 매칭 결과이지 Recanet에서 실제 공격 가능한 경로가 확인됐다는 결론은 아니다. GOST·LDAP·인증서 처리·다형성 역직렬화 등 개별 조건의 사용 여부와 외부 입력 도달성을 따로 평가해야 한다. 자동 업그레이드·exclude·override·audit fix는 실행하지 않았다. Jackson 동일 버전 계열의 수정 범위와 BC 공급자 수정 버전을 검토하되, 실제 교체는 별도 승인된 코드 변경에서 회귀 검증해야 한다.

추가 구조 위험도 확인했다. Privy 전이 의존성은 `bcprov-jdk18on:1.80`을, SDK는 직접 `bcprov-jdk15to18:1.83`을 포함한다. artifactId가 달라 Gradle의 동일 모듈 버전 충돌 해소로 하나가 제거되지 않는다. 두 JAR의 `org/bouncycastle/` 아래 겹치는 class entry는 4,245개다. 현재 Gradle runtime 순서의 smoke에서 KeccakDigest는 jdk15to18 1.83에서 로드됐다. 다른 소비자의 classpath 순서까지 같은 결과를 보장하지 않으므로 버전과 artifact family 정합성 검토가 필요하다.

이전 Greenfield npm audit28건(high8 포함)은 별도 결과로 유지한다. npm 취약점 수와 OSV 고유 권고 수는 집계 방식이 달라 합산하지 않는다. [정리된 검사 근거](migration/phase1-additional-evidence.json).

## 3. 권한과 요금제 재확인

현재 인증 계정 `raddaslul`은 RecycleFarm의 active member이며, 두 저장소에서 admin 권한이 있다. 조직 요금제는 free다.

- 두 저장소 main 조회가 모두 `protected: false`를 반환했다. 브랜치 보호 여부 자체는 이제 미확인이 아니다.
- 상세 protection/rulesets 조회는 두 저장소 모두403이며 응답은 요금제 업그레이드를 안내했다. 관리자 권한을 더 주면 해결된다고 안내하지 않는다.
- 최초 Maven/npm 조직 패키지 조회는 read:packages 부족으로403이었다. 사용자 승인 후에는200으로 해소됐다. 자세한 결과는5절과 같다.

비공개 조직 저장소의 branch protection/rulesets는 Team/Enterprise 요금제에 해당한다. 현재 Free 조직의 기능 제약은 토큰 scope 추가와 구분한다. [보호 브랜치 공식 안내](https://docs.github.com/en/rest/branches/branch-protection), [rulesets 공식 안내](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).

## 4. 남은 항목과 필요한 조건

| 남은 항목 | 필요한 조건 | 이번 상태 |
| --- | --- | --- |
| 기존 Maven/npm 버전·연결 저장소·visibility | 조회할 기존 패키지 | 접근 성공, 현재 계정 목록과 두 SDK 연결 결과 모두0개. 개별 대상 없음 |
| npm 상속·개별 사용자/팀·Actions access 세부 설정 | 실제 npm 패키지 | 현재 대상 없음. 최초 발행 후 실제 상속/설치 검증은 후속 범위 |
| 보호 규칙 상세·강제 보호 | 조직 Team/Enterprise 검토 및 관리자 설정 | protected=false 확인, 실제 설정 미변경 |
| Linux/CPU/Windows 지원 검증 | 해당 실행 환경 | 현재 머신에 Docker/Podman/Colima/Lima/QEMU 실행 도구 없음. 실행하지 않음 |
| 외부 파트너 설치·권한 회수 | 외부 계정·실제 패키지·승인된 인증 | 후속 Registry 검증 범위, 미실행 |
| 전 API/오류/바이트 동등성·실서비스 수용 | 공통 승인 명세·벡터·환경·자격 증명 | 58개 로컬 JSON 입력까지 검증, 전체로 확대 해석하지 않음 |

현재 접근 가능한 자료 범위의 Phase 1 조사를 완료했다. 추가 플랫폼 검증에는 해당 실행 환경이 필요하고, 실제 패키지 상속·파트너 설치는 발행 대상과 외부 계정이 필요하다. 이관·배포를 해야만 확인 가능한 사항을 Phase 1 완료 항목으로 바꾸지 않는다.


## 5. 사용자 승인 후 패키지 접근과 잔여 조사

2026-11-17 사용자 승인 후 같은 계정의 scope에 read:packages가 추가됐음을 확인했다. 토큰 원문은 기록하지 않았다. 조직 목록은 pagination을 포함해 조회했고 첫 응답과 HTTP 상태도 확인했다.

| 조회 | 결과 |
| --- | --- |
| 조직 Maven 목록 | HTTP200, `[]` |
| 조직 npm 목록 | HTTP200, `[]` |
| recanet-java 연결 패키지(GraphQL) | viewerPermission=ADMIN, totalCount=0, nodes=[] |
| recanet-typescript 연결 패키지(GraphQL) | viewerPermission=ADMIN, totalCount=0, nodes=[] |

이전403은 해소됐다. 개별 버전·POM/manifest·연결 저장소·visibility·상속 권한을 조사할 기존 패키지는 발견되지 않았다. API는 호출자에게 읽기 가능한 조직 패키지만 반환하므로 “조직 전체에 절대 패키지가 없다” 또는 “선택한 새 패키지명이 Registry에서 확실히 사용 가능하다”고 단정하지 않는다. [공식 API 범위](https://docs.github.com/en/rest/packages/packages#list-packages-for-an-organization).

현재 저장소 소스의 원격 발행 설정 미구성과 Actions/태그/릴리스0개라는 앞선 결과에 더해, 두 SDK 연결 패키지도0개다. 따라서 이번 이관 설계는 확인된 기존 Registry 패키지를 옮기는 작업이 아니라 첫 발행을 준비하는 설계로 취급한다. 다만 다른 소유자/Registry 배포나 삭제된 과거 발행은 조사된 증거가 없으므로 소비자 경로 확인을 계속 전환 조건으로 남긴다.

기존 Actions 정책은 두 저장소 모두 아래와 같았다.

```json
{
  "enabled": true,
  "allowed_actions": "all",
  "sha_pinning_required": false,
  "default_workflow_permissions": "read",
  "can_approve_pull_request_reviews": false
}
```

Actions는 사용 가능하며 현재 workflow가 없다는 뜻이다. 기본 읽기 토큰과 향후 packages:write 발행 권한은 구분한다. SHA 고정은 플랫폼 설정에서 강제되지 않으므로 후속 CI 작성 시 코드에서 고정하도록 설계한다. 이번에 정책이나 workflow를 바꾸지는 않았다.

추가로 목표 저장소 이름 `RecycleFarm/recanet-sdk`와 `RecycleFarm/recanet-sdk-distribution`을 읽기 조회한 결과는 각각HTTP404였다. 현재 계정에서 발견되지 않았다는 뜻이며, 존재하지 않음과 권한으로 숨겨짐을 구분하지 못한다. 새 저장소 생성이나 이름 예약은 하지 않았다. Phase 2 승인 후 생성 전 조직 소유자가 같은 이름의 기존 저장소 여부를 확인해야 한다.

원격 main/telemetry SHA는 앞선 조사와 같았고 두 분석 복제본의 추적 파일 변경도 없었다. 재실행을 정당화할 코드 변경이 없어 앞서 통과한 빌드·테스트를 불필요하게 반복하지 않았다. 추가 권한 설정은 현재 필요하지 않다.

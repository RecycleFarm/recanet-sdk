> 2026-11-17: 공통 Contract 기준으로 TypeScript API와 동작을 Java에 정렬했다. 현재 불일치 해소·실행 검증은 [공통 Contract](../contracts/gaps.md), 현재 API 동결은 [Contract baseline](../contracts/public-api-baseline.json)을 따른다. 아래 Phase 2/3 내용은 당시 이관 기록이며 원본 baseline은 보존한다.

# SDK 호환성 현황

양언어의 목표 동작은 [Recanet SDK 공통 Contract](../contracts/recanet-sdk-contract.md)에 정의한다. 전체 public 메서드 대응과 현재 해소해야 할 차이는 [대응표](../contracts/api-map.md) 및 [준수 차이 목록](../contracts/gaps.md)을 따른다. 아래는 현재 구현/과거 검증 상태이며 공통 계약의 언어별 예외가 아니다.

이관 기준은 Java main `37c78cfa01d9892ca26de61bb74df827923917cf`, TypeScript main `eb132e7d03110d7238e14627b3f87be6cb7b8798`이다. Phase 2의 원본 import tree와 refs는 고정 이력으로 보존한다. 이후 사용자 승인에 따라 rc.1의 좌표·버전·보안 의존성·배포 구성을 바꿨으며 공개 API baseline은 유지한다. 기능 차이 자체를 해소하지 않았다.

| 항목 | Java | TypeScript |
| --- | --- | --- |
| 런타임 | JDK17 | Node22+, ESM |
| 버전 | 0.1.0-rc.2 | 0.1.0-rc.2 |
| 패키지 | com.youngminkim.recanet:recanet-sdk-java | @recyclefarm/recanet-sdk |
| 공개 경계 | com.youngminkim.recanet 및 dmrvn 공개 타입 | src/index.ts의 exports |
| PET v3 전용 factory | 없음, 일반/명시 schema 생성자 유지 | DeclaredMethodology.petV3 존재 |
| 영속 journal | Java 파일 잠금 | 배포 패키지에 Linux x64/macOS ARM64 Node-API v8 바이너리 포함 |
| Greenfield worker | 기존 Java main 버전 유지 | UTF-8 chunk 처리 수정된 TS 버전 유지 |
| telemetry | 별도 보존 브랜치에만 존재 | main의 진단 로그는 과거 revert됨 |

전체 API 대응과 숫자·오류·시간 경계 차이는 [설계 가이드](monorepo-migration-guide.md#4-공개-api와-기능-차이) 및 [원본 TS 비교 문서](../sdks/typescript/docs/java-parity.md)를 참조한다. API baseline은 Java class entry66개의 public 선언과 TS 선언파일59개를 비교한다. .d.ts는 내부 선언도 포함하는 더 강한 동일성 검사이며59개가 모두 직접 공개 진입점이라는 뜻은 아니다.

Phase 2 실행 증거는 macOS ARM64의 JDK17/Node22·Node25다. Phase 3 원격 CI에서는 Ubuntu24.04 x64의 Java/TS와 macOS15 ARM64의 TS 전체 검사를 추가로 통과했다. Linux ARM64·Windows와 기타 CPU는 이번 원격 CI에서 실행하지 않았다. [실행 근거](migration/phase3-ci.md). 단일 머신에서 생성한 native 바이너리를 범용 배포물로 취급하지 않는다.

보안 검사에서 Greenfield 의존성 npm28건과 Java OSV 고유 권고12건, Bouncy Castle artifact 중복을 확인했다. 실제 영향과 수정 정책은 별도 검토 대상이며 이번에는 버전을 바꾸지 않았다. [상세 결과](phase1-additional-validation.md).


현재 rc.1의 Java 지원 기준은 Linux x64·JDK17이며, TypeScript는 Linux x64 또는 macOS ARM64·Node22를 지원한다. TypeScript tarball은 두 플랫폼의 Node-API v8 바이너리를 포함하고 실행 시 해당 파일을 선택한다. 사용자 설치에는 C compiler나 Node headers가 필요 없으며, 소스 개발 빌드에서만 필요하다. npm os/cpu의 교차 조합인 Linux ARM64와 Intel Mac은 설치 스크립트에서 거부한다. TypeScript CI는 Ubuntu24.04 x64와 macOS15 ARM64에서 설치·전체 검사·tarball 소비자를 실행한다. 기존 보안 권고는 [수정과 재검증 기록](security/rc1-remediation.md)을 따른다.

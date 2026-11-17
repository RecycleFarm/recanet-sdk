# SDK 호환성 현황

이관 기준은 Java main `37c78cfa01d9892ca26de61bb74df827923917cf`, TypeScript main `eb132e7d03110d7238e14627b3f87be6cb7b8798`이다. Phase 2는 원본 소스 트리를 그대로 유지했다. 기능 차이를 해소하거나 두 SDK의 버전을 맞추지 않았다.

| 항목 | Java | TypeScript |
| --- | --- | --- |
| 런타임 | JDK17 | Node22+, ESM |
| 버전 | 0.1.0-SNAPSHOT | 0.1.0, private=true |
| 패키지 | com.youngminkim.recanet:RecanetJava | recanet-typescript |
| 공개 경계 | com.youngminkim.recanet 및 dmrvn 공개 타입 | src/index.ts의 exports |
| PET v3 전용 factory | 없음, 일반/명시 schema 생성자 유지 | DeclaredMethodology.petV3 존재 |
| 영속 journal | Java 파일 잠금 | macOS/Linux용 Node-API native 빌드 필요 |
| Greenfield worker | 기존 Java main 버전 유지 | UTF-8 chunk 처리 수정된 TS 버전 유지 |
| telemetry | 별도 보존 브랜치에만 존재 | main의 진단 로그는 과거 revert됨 |

전체 API 대응과 숫자·오류·시간 경계 차이는 [설계 가이드](monorepo-migration-guide.md#4-공개-api와-기능-차이) 및 [원본 TS 비교 문서](../sdks/typescript/docs/java-parity.md)를 참조한다. API baseline은 Java class entry66개의 public 선언과 TS 선언파일59개를 비교한다. .d.ts는 내부 선언도 포함하는 더 강한 동일성 검사이며59개가 모두 직접 공개 진입점이라는 뜻은 아니다.

Phase 2 실행 증거는 macOS ARM64의 JDK17/Node22·Node25다. Phase 3 원격 CI에서는 Ubuntu24.04 x64의 Java/TS와 macOS15 ARM64의 TS 전체 검사를 추가로 통과했다. Linux ARM64·Windows와 기타 CPU는 이번 원격 CI에서 실행하지 않았다. [실행 근거](migration/phase3-ci.md). 단일 머신에서 생성한 native 바이너리를 범용 배포물로 취급하지 않는다.

보안 검사에서 Greenfield 의존성 npm28건과 Java OSV 고유 권고12건, Bouncy Castle artifact 중복을 확인했다. 실제 영향과 수정 정책은 별도 검토 대상이며 이번에는 버전을 바꾸지 않았다. [상세 결과](phase1-additional-validation.md).

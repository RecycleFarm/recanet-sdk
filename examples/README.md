# 기존 실행 예제

- Java 예제: [sdks/java/src/examples/java](../sdks/java/src/examples/java). 실행 방법은 [Java README](../sdks/java/README.md)와 [DMRVN 문서](../sdks/java/docs/DMRVN.md)를 따른다.
- TypeScript 사용 예: [sdks/typescript/README.md](../sdks/typescript/README.md).

Java Gradle 실행 task와 Python 도구는 `sdks/java`를 작업 디렉터리로 사용한다. `tools/greenfield/worker.cjs` 같은 기존 상대 경로를 유지하기 위해 루트에서 예제 task를 직접 실행하지 않는다. 기본 CI는 실제 쓰기·전송을 수행하는 PET/live 예제를 실행하지 않는다. 이 예제는 실제 비용과 상태 변경을 발생시킬 수 있다. 과거 실행 결과는 [시점별 DMRVN 검증 기록](../sdks/java/docs/DMRVN_VALIDATION.md)에서 확인하며, 이를 현재 설정과 전체 운영 경로의 인수 완료로 해석하지 않는다.

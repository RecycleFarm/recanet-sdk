# 기존 실행 예제

- Java 예제: [sdks/java/src/examples/java](../sdks/java/src/examples/java). 실행 방법은 [Java README](../sdks/java/README.md)와 [DMRVN 문서](../sdks/java/docs/DMRVN.md)를 따른다.
- TypeScript 사용 예: [sdks/typescript/README.md](../sdks/typescript/README.md).

Java Gradle 실행 task와 Python 도구는 `sdks/java`를 작업 디렉터리로 사용한다. `tools/greenfield/worker.cjs` 같은 기존 상대 경로를 유지하기 위해 루트에서 예제 task를 직접 실행하지 않는다. PET/live 예제는 실제 쓰기나 비용이 발생할 수 있으며 이번 이관에서 실행하지 않았다.

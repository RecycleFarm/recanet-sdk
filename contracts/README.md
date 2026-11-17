# Recanet SDK 공통 Contract

Java를 기준 동작으로 삼아 Java·TypeScript가 동일하게 제공해야 하는 공통 계약이다. 언어별 현재 차이는 계약의 예외가 아니라 해소해야 할 항목으로 추적한다.

- [공통 Contract](recanet-sdk-contract.md): 기능·공통 불변 조건·재시도/복구 경계
- [상세 API 계약](api-reference.md): 전체 기능의 입력·출력·기본값·검증 순서·오류·부수 효과·재시도
- [전체 공개 메서드 대응표](api-map.md): 생성자·overload·상수·accessor·TS 추가 공개 기능 포함
- [기계 판독 대응표](api-map.json): 정확한 양언어 공개 시그니처와 각 항목의 계약 연결
- [불일치 해소·인수 기준](gaps.md): GAP-01~12 해소와 공통 검증 근거

```sh
# 저장소 루트. Java 빌드 산출물/TS 의존성이 필요하다.
make contract-check
make contract-test
make verify-api
```

`contract-check`는 공개 API 누락을 검사하고 `contract-test`는 실제 양쪽 구현의 값·오류·호출 순서·재시도를 비교한다. 유한한 테스트 통과는 모든 가능한 입력의 수학적 동등성 증명이나 실서비스 인수를 뜻하지 않는다. 기존 fixture는 각 SDK에 유지한다. 확인되지 않은 OpenAPI나 외부 Evidence/PET 운영 프로필을 새로 확정하지 않는다. [과거 58개 JSON 교차 실행](../docs/migration/cross-json-results.json)은 전체 계약 conformance suite와 별개다.

검토 후 `api-map.json`을 변경했다면 `python3 scripts/check-sdk-contract.py --render-map`으로 사람이 읽는 대응표를 재생성한다. 이 명령은 JSON baseline이나 SDK를 자동 변경하지 않는다. `make check`에도 동일 coverage 검사를 포함한다.

업무 메서드 명칭과 이관 방법은 [TypeScript API 변경 안내](typescript-migration.md)를 따른다. 현재 API 기준은 [별도 baseline](public-api-baseline.json)에 고정하며 과거 이관 baseline은 수정하지 않는다.

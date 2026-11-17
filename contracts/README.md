# 공통 계약 검증

Phase 2는 기존 SDK 소스와 동작을 그대로 옮기는 단계다. 기존 고정 벡터는 각 SDK의 테스트 디렉터리에 유지한다. 확인되지 않은 공통 OpenAPI 명세나 새 PET 운영 프로필을 만들지 않는다.

Phase 1의 58개 JSON 입력 교차 실행 결과는 [조사 기록](../docs/migration/cross-json-results.json)에 있다. 이는 전 API/오류/validator 동등성의 증거가 아니다. 공통 contract test 실행 체계는 후속 단계에서 별도로 구축한다.

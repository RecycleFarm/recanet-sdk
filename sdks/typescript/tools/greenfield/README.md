# 고정 Greenfield worker

설치와 오프라인 시험:

    npm ci --prefix tools/greenfield --ignore-scripts
    npm run test:greenfield

Node 22+를 사용한다. 이 worker는 한 프로세스에서 stdin JSON 한 건을 처리하고 stdout protocol JSON을
반환한다. 저장소 키는 GREENFIELD_STORAGE_PRIVATE_KEY 환경 하나로 받는다.
키를 CLI 인자·request JSON·파일에 넣지 않는다.

private create → simulate → broadcast, 원래 hash를 사용하는 upload와 bounded seal polling,
실제 객체 read, 원래 create transaction의 protobuf/hash/creator/object 확인을 제공한다.
validator 읽기 권한·feegrant·잔액을 자동으로 만들거나 공급자별 운영 정책을 선택하지 않는다.

SDK 본체의 NodeGreenfieldStorage가 기본 경로로 이 파일을 실행한다.
별도 설치한 패키지에서는 해당 패키지의 tools/greenfield 디렉터리에 의존성을 설치해야 한다.
독립적으로 설치하는 구조와 알려진 감사 결과는 [의존성 기록](../../docs/greenfield-dependencies.md)을 참고한다.
오프라인 시험 통과는 실제 Greenfield 생성·업로드·검증자 읽기 인수가 아니다.

# TypeScript 공통 API 변경 안내

업무 메서드는 Java 이름을 사용한다. getter/property, 생성자/options/factory, 동기 반환/Promise는 값·검증·부수 효과가 같은 언어 바인딩으로 허용한다. 패키지 버전과 비공개 배포 상태는 바꾸지 않았다.

| 이전 TypeScript 사용 | 현재 공통 API |
| --- | --- |
| PrivyClient.listBackendWallets | PrivyClient.listWalletsByAuthorizationKey |
| DmrvnJson | Json (parse/object/canonical/bytes/hash/copy; copy는 object만) |
| DeclaredMethodology.petV3 | 일반 명시 schema 생성자. 예: schema4/방법론2003 version3을 직접 전달. partner/input 추가 제한 없음 |
| DmrvnCrypto/Abi/Chain/Preflight/MemoryOperationJournal 및 internal helper root import | 제거. Java와 같은 공개 업무 API/adapter 사용 |
| ms 숫자로만 기간 전달 | 기존 ms options 또는 Duration.ofNanos/ofMillis/ofSeconds/ofMinutes. 큰 값은 bigint 사용 |
| Java Float/Double 숫자 타입 구분 필요 | Float32/Float64 사용. 정밀 decimal은 DmrvnDecimal 유지 |
| options에만 Privy 설정 보관 | PrivyClientConfig/PrivyTokenVerificationConfig 및 client.config()로 정규화 값 조회 |

BackendWalletKeyPair, Registration.fromEnvironment, ensureBackendWallet, exportWalletPrivateKeyAndLog와 Java 호환 Query/WalletCreateRequest runtime 생성자 및 deprecated config/client overload를 추가했다. 키를 출력하는 API는 Java와 같이 명시적으로 호출할 때 비밀 키를 로그에 출력한다.

Asset API의 주소/hash case는 원문을 보존한다. 없는 회원 signer는 상태 오류이며 malformed Privy 성공 응답은 INVALID_RESPONSE/status200이다. JWT decimal/exponent NumericDate는 Java Nimbus의 binary64 반올림을 거친 후 검증한다. 불필요한 TS 추가 snapshot/검증을 제거해 입력 소비와 오류 우선순위를 Java에 맞췄다.

전체 시그니처는 [대응표](api-map.md), 상세 동작과 오류·재시도는 [상세 계약](api-reference.md), 검증은 [해소 기록](gaps.md)을 따른다.

# 의사결정 대기 목록

이 문서는 채택 기록이 아니다. 미결 정책은 구현 편의로 확정하지 않는다.
원본: [추가 의사결정 사항 D-01–D-30](https://chatgpt.com/space/page_e02a6acd8cec8191809fd022e8f534b8).

| ID | 결정할 내용 | 현재 개발 처리 |
| --- | --- | --- |
| TS-01 | 배포 패키지명·npm scope·지원 Node 버전·CJS 제공 여부 | 임시 이름 recanet-typescript, private, Node 22+, ESM으로 로컬 개발 |
| TS-02 / D-06 | 잘못된 UTF-16 입력의 인코딩 정책 | 회원 ID 계산은 Java의 UTF-8 대체 바이트 `3f` 호환; 정식 정책 미채택 |
| TS-03 / D-07 | SDK 전체 오류·취소 모델 | 기능별 현재 명세를 유지, Java interrupt는 AbortSignal에 대응 |
| TS-04 | 밀리초 및 Retry-After 공개 자료형 | timeoutMs는 JS 안전 정수 범위만 수용(원본 int64 범위보다 작음), retryAfterMs는 bigint로 int64 초를 손실 없이 보존. 최종 API 채택은 대기 |
| TS-05 / D-09 | JWT 파서의 비표준 입력 수용·중복 claim·중첩 한도 | 원시 숫자를 보존하는 별도 파서 사용. 중복 key·128단계 초과 중첩·비정상 UTF-8·비 base64url compact 입력은 INVALID_TOKEN. Nimbus 비표준 허용 범위와 교차 검증 전 전체 파서 호환 선언 보류 |
| TS-06 | 인증 결과의 시각 표현 | `issuedAtMs`·`expiresAtMs`는 UTC epoch 밀리초 bigint. NumericDate 전체 범위는 JS Date 범위를 초과하므로 Date/number로 축소하지 않음. 최종 공개 API 채택 대기 |
| TS-07 / D-09 | JWKS 전송·키 선택 경계 | fetch의 header 대기와 각 body read에 timeout 적용. Java 소켓의 connect/read와 완전히 같은 시간 경계는 미검증. EC/P-256, kid/alg/use 기준 후보 선택; Nimbus의 모든 비표준 JWK 파싱·선택 규칙 교차 검증 대기. `now` 주입은 claim과 캐시/갱신 제한 시계 모두에 적용 |
| TS-08 / D-04 | 승인키 자동 출력·환경변수 기반 초기화 편의 기능 | 키 생성·명시적 입력만 구현. Java generateAndLog/ensureBackendWallet/exportAndLog의 비밀 자동 출력과 첫 지갑 선택 정책은 미채택·미구현. 소비자 비밀 저장소와 환경변수 매핑은 호출자 책임 |
| TS-09 / D-07 | 등록/목록 일반 전송 예외의 노출 | 직접 fetch 계층에서는 공통 sanitize 오류로 반환. Java 공식 SDK의 일부 일반 실행 예외 노출까지 복제하지 않음. 계약 통합 채택은 대기 |
| TS-10 / D-11 | Privy 승인 정규화의 기존 비표준 동작과 수치 표현 | Privy 0.59 경로를 별도 구현: 키 UTF-16 정렬·key escape 생략·Jackson 제어문자 escape. 정상 payload 3개 바이트/digest/DER 벡터 검증. 숫자는 JS JSON wire 표현을 사용하여 Java Double의 `1.0`·지수 표기까지 동일하다는 보장은 없음. 큰 정수는 10진 문자열 사용. malformed Unicode·임의 수치 표현의 최종 정책 및 외부 수용 범위는 결정 대기 |
| TS-11 / D-12 | chainId와 직접 서명자 입력 검증의 공개 타입 | chainId는 안전한 number 또는 bigint로 Java signed int64 범위 보존. 직접 signer는 양수·key blank·Quantity 문법을 추가 검사하지 않음. 회원 API는 별도 양수/key 검사를 유지할 예정. 반환 hash/signature는 문자열 반환이며 암호학적 검증은 상위 계층 책임 |
| TS-12 / D-11 | idempotency key의 HTTP 공백 처리 | native Fetch가 앞뒤 HTTP 공백을 제거하므로 동일하게 정규화한 실제 header 값으로 승인하고 전송. 교차 SDK의 공백 key 허용/거부 정책은 결정 대기. 연동 시 앞뒤 공백 없는 안정적 key 사용; 원본 body와 wire key를 함께 보존 |
| TS-13 / D-03·07 | 파트너 콜백 및 미발견 서명자 오류 | 콜백은 boolean 또는 Promise<boolean>을 명시적으로 지원하고 매 서명/전송에 재확인. 미발견은 회원 상세 Page의 UNAUTHORIZED_SIGNER로 구현(Java 일반 signerFor의 IllegalStateException과 차이). 콜백 자체 오류는 원문 그대로 호출자에게 전파. 최종 언어 공통 오류정책 결정 대기 |
| TS-14 / D-14 | EVM fetch 시간 경계·범위 | 요청 전체 30초, 연결 단계는 fetch header 반환까지 10초 상한. native Fetch가 소켓 연결 timeout을 직접 제공하지 않아 Java connect timeout과 같은 의미는 아님. 설정은 양의 안전 정수 밀리초, 1ms 미만은 거부(원본 Duration 소수 ms 차이). 정식 시간 계약 결정 대기 |
| TS-15 / D-17·30 | 체인 JSON의 언어별 숫자·중첩 경계 | 응답 숫자는 원문을 읽어 integer safe 범위/decimal 정확 왕복을 별도 검증. JS 입력 number는 double 경로로 JCS 숫자를 출력하고 bigint 입력은 safe 정수만 허용. Java의 입력 숫자 클래스 차이를 JS에서 완전히 복제하지 않음. 중첩 128단계 상한은 기존 lossless 파서 공유. key escape/제어문자 대문자는 Java 호환 경로이며 표준 JCS 정책은 미채택 |
| TS-16 / D-13 | ETH 전송 금액·복구 정보의 공개 API | 금액은 bigint wei만 받으며 string/number 자동 변환 없음. 현재 Java처럼 hash만 반환하고 완성 transaction·pending nonce를 별도 결과로 노출하지 않음. 같은 key의 transfer 재호출은 body가 달라질 수 있어 원래 전송 복구 계약은 결정 대기 |
| TS-17 / D-15 | 거래 조회의 수치·원본 응답 타입 | chain/block/confirmations·금액/가스/nonce는 bigint, transactionIndex는 int32 범위 number. 원본은 중첩 동결한 JSON snapshot이며 주입 RPC도 JSON 호환 값을 반환해야 함. 조회 오류는 TransactionQueryError. 합의 포함 증명/마지막 anchor 재확인 강화는 원본 D-15 결정 대기 |
| TS-18 / D-16 | 거래 cursor의 SDK 간 호환·변조 방지 | Java 발급 ASCII/Base64url 벡터와 일치하며 수신 시 padding·snapshot/index 정수의 부호/선행 0을 허용. cursor는 비서명·비암호화이며 권한 증명이 아님. 교차 언어 전체 비정규 파싱 호환 및 서버 변조 방지 정책은 결정 대기 |
| TS-19 / D-17·30 | DMRVN decimal 자료형과 암호 의존성 | ethers 6.17.0을 고정해 Keccak/secp256k1 연산에 사용하고 Java 입력 범위·low-s를 별도 검사. DMRVN JSON 소수는 DmrvnDecimal로 원문/BigDecimal 구분 유지하며 canonical/hash/copy에는 DmrvnJson 사용. 큰 decimal의 canonical 결과를 다시 파싱하면 거부되는 기존 경계 유지. 표준 JCS로 수정·일반 JSON 자료형으로 축소하는 정책은 결정 대기 |
| TS-20 / D-18 | ABI decode 엄격성·기준 selector 오류 | call은 전체 재인코딩 일치를 요구하지만 output/event는 재인코딩하지 않는 Java 경계 유지. uintN/address/bool/bytes1/bytes32/bytes/string/tuple/동적 배열만 codec 지원(예: bytes4는 signature 계산만 가능). Java Field.signature가 tuple[]를 문자 그대로 내보내는 executeBatch selector도 원본 벡터와 일치시키며 올바른 Solidity tuple[] signature로 조용히 교체하지 않음. 교정/지원 확대는 결정 대기 |
| TS-21 / D-02·19 | Evidence 버전과 registry 경계 | DeclaredMethodology에 명시적 schemaVersion 및 registry callback(boolean/Promise)을 주입. 버전 미지정은 Java 과거 생성자 3 호환값을 보관하되 requireExplicitEvidenceVersion에서 중단하여 신규 운영 계약으로 인정하지 않음. helper 자체는 partner long 입력을 유지하며 고수준 파트너 uint32 제약은 config 계층에서 적용 예정. 승인된 Evidence 버전/방법론 프로필/registry 원천은 결정 대기 |
| TS-22 / D-19·20 | 배포 설정의 숫자/URL 표현과 과거 배포 | config chainId·partnerId·confirmations는 검증된 number, maxRelayCostWei는 양의 bigint(원본처럼 uint256 상한 없음). rpcUrl은 검증 후 WHATWG URL 정규 표현으로 저장. 과거 direct 편의 설정은 읽기/복구용이며 requireWritable은 거부. 제공 testnet 스냅샷은 최신 운영 상태가 아닌 Java 고정 사본. owner/릴리스 변경 복구 정책은 D-20 결정 대기 |
| TS-23 / D-19 | 배포 실측 결과와 읽기 경계 | observedBlock/head/nonce는 bigint. 현재 Java처럼 block 응답 number를 대조하지 않고 마지막 raw hash와 첫 정규화 hash를 비교. 오류는 UNAPPROVED_IMPLEMENTATION 외에는 취소/RPC 오류도 DEPLOYMENT_NOT_READY로 변환. 강화·오류 정책 변경은 결정 대기 |
| TS-24 / D-19 | preflight API와 ready 의미 | 고수준 client 조합 전 읽기 전용 DmrvnPreflight.run으로 제공. Java처럼 zero balance 조회 성공·문자열 미시험 표식 제외한 check들만 ready에 반영하고 registry 일반 오류는 그대로 전파. GreenfieldStorage는 실제 객체 읽기/원래 create 거래 확인을 요구하는 async 경계로 정의. 외부 쓰기/validator 권한과 비용 충족 인수는 별도 결정 대기 |
| TS-25 / D-25 | async journal monitor와 영속 adapter | 메모리는 Java처럼 key와 무관한 단일 monitor·nested 재진입을 유지. AsyncLocalStorage와 소유 scope별 queue로 중첩 fan-out 잠금도 직렬화. callback은 모든 자식 비동기 작업을 await해야 하며 scope 밖 부작용을 보장하지 않음. store는 대기 전에 입력 snapshot 캡처. claim 검색 미지원 adapter는 JOURNAL_UNAVAILABLE. 영속 lock/fsync·분산 lease/fencing·포맷 호환은 별도 구현/결정 대기 |
| TS-26 / D-24 | 공개 객체 reader의 Fetch 경계 | endpoint는 query 금지·WHATWG URI 정규화, Java URLEncoder 규칙으로 bucket/각 object segment 인코딩. Fetch가 '.'/'..' segment를 다른 경로로 정규화하므로 해당 literal segment는 INVALID_INPUT으로 거부(Java reader와 명시적 차이). raw path 지원이 필요하면 전송 adapter/허용 정책 결정 필요. 30초 전체/10초 header 대기 기본과 주입 fetch·시험용 timeout 설정을 제공하며 실제 소켓 connect 경계는 TS-14와 같은 차이 |
| TS-27 / D-23·25 | 단계 API의 adapter 변경·재전송 오류 사실 | 저장소에 위치/bytes의 독립 사본을 전달해 adapter의 변경이 저장 상태를 오염시키지 않도록 함. 생성 intent 제거는 DmrvnError의 명시 definitelyNotBroadcast/definitelyRejected 사실만 허용하고 retryable/action만으로 재전송하지 않음. 상태 snapshot에는 재사용 가능한 서명이 있으므로 소비자가 접근/저장 권한을 통제. 공통 오류 fact의 외부 공급자 증명 기준과 영속 adapter는 결정 대기 |
| TS-28 / D-21 | 승인 요청의 만료·취소·재승인과 예약 해제 | 서명 전에 Claim nonce/deadline을 고정하고 서명 실패 후에도 원 요청과 beneficiary 예약 유지. 만료/nonce 충돌을 자동 갱신하지 않음. 이미 저장한 approved는 배포 재검증 후 그대로 반환하며 현재 유효성 보증이 아님. 취소·재승인·안전한 예약 해제 API는 정책 결정 대기 |
| TS-29 / D-22·23 | 제출 준비 후 반환 유실·서명 교체·취소 | Java처럼 직접 제출 calldata를 노출하기 전에 intent를 저장하고 이후 같은 거래 반환. SDK는 앱의 직접 전송 횟수를 제한할 수 없음. beneficiary 서명은 요청+서명 문자열 fingerprint로 고정해 같은 유효 서명의 다른 v 표현도 교체 금지. 직접/대납 mode 전환·intent 해제·서명 교체 및 원래 거래 확인 후 종료 정책은 결정 대기 |
| TS-30 / D-22·27 | DMRVN receipt/log 조회 일관성 | 현재 Java처럼 receipt blockHash는 raw 문자열 일치, txHash는 대소문자 무시. event 선택은 claim주소/topic/claimId 첫 일치, 로그 검색은 범위 차이≤100000을 1000블록 창으로 읽음. 개별 receipt log의 removed/block/tx 추가 결속·마지막 anchor 재검사·실패 receipt 종료 정책은 결정 대기 |
| TS-31 / D-22·23 | relay 거래·오류 종료·수수료 정책 | Java 규칙인 estimate×130/100 floor·legacy gasPrice·비용 상한·pending=latest nonce·pending 시뮬레이션 유지. 양의 gas/price 추가 검사·EIP-1559·replacement/fee bump는 채택하지 않음. 완성 거래와 intent를 send 전에 저장하고 send 이후 명백 거절 flags도 미확정으로 처리하며 자동 재전송하지 않음. RPC/서명자에는 거래 사본을 전달. 거절 증명 기반 종료·수수료 확장·재전송 정책은 결정 대기 |
| TS-32 / D-05·26 | 고수준 요청 생성 API와 시간 정밀도 | ActivityRequest는 TS options의 미지정 필드별 기본값 적용(원본 Java는 3인자 생성자만 기본값). 명시 null gas/time은 거부. Duration 대신 정수 밀리초 confirmationTimeoutMs/pollIntervalMs로 0..600000/1..10000 제한하며 sub-ms는 지원하지 않음. 요청 객체/inputs는 불변 snapshot. 최종 API·sub-ms 필요성·통합 오류 경계는 결정 대기 |
| TS-33 / D-05·26 | 고수준 오류 매핑·새 호출·확인 대기 | Java IllegalArgumentException은 TS TypeError/RangeError로 대응, 권한 거부 adapter는 DmrvnError(UNAUTHORIZED_SIGNER)를 사용. Privy 오류 특별 매핑 및 stage/intent 기반 outcome 유지. 호출마다 UUID·독립 관찰/기본 메모리, 명시 journal만 공유. timeout은 전송 결과 뒤 monotonic clock으로 측정하며 개별 RPC 총기한을 제한하지 않음. AbortSignal은 RPC/지갑/대기에 전달. 오류 경계 통합·source dedup/자동 재개·전체 실행 기한 정책은 결정 대기 |
| TS-34 / D-27·28 | 보고서 권한·metadata·계산 출력 신뢰 | 검증기는 성공한 승인 배포 v7 receipt를 권한 근거로 삼는 원본 계약 유지. coordinator/committee 역할·과거 정책·현재 deadline 독립 조회는 하지 않음. reportHash는 파일 hash가 아니며 추가 metadata는 독립 검증하지 않음. expectedFileHash가 있어도 metadataIndependentlyVerified=false. 출력은 정확한 value/unit/scale 형태와 hash를 검증하지만 단위 환산/scale 계산은 하지 않음. -0·큰 정수 문자열·VALID 빈 outputs 허용. 외부 commitment 신뢰·권한 registry·출력 프로필은 결정 대기 |

`DmrvnDecimal.toJSON()`은 검증한 수치로 외부 JSON wire를 구성한다. 원문 보존/소수와 정수의 구분이 필요한 해시·복사에는 계속 `DmrvnJson`을 사용한다.
| D-01·03·04 | 지갑 소유권 충돌·파트너 매핑·승인키 출력 | 구현 시 명시적 어댑터, 키 자동 출력 없음 |
| D-02·17·30 | Evidence wire 버전·숫자 정규화·제어문자 escape | 운영 기본 버전을 추정하지 않음 |
| D-05·08–16 | API 표면·회원 연결·외부 공급자·승인 서명·거래 정책 | 각 상세 구현 전 원본 계약 대조 |
| D-18–29 | 배포·권한·제출·저장·journal·대기·보고서 신뢰 | 원본의 개별 질문을 해소하기 전 운영 호환 선언 보류 |

실환경 인수에는 승인된 배포·방법론·권한·비용 범위 및 테스트 자격 증명 설정이 필요하다.

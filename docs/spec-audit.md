# 원본 개발 명세 대조 감사

확인일: 2026-11-09. 구현 기준 Java commit은 `37c78cfa01d9892ca26de61bb74df827923917cf`,
감사 대상 TypeScript 소스는 `fe3f09a`다. 이번 감사의 변경은 문서와 패키지 문서 포함 검사뿐이다.

원본 [Recanet SDK 개발](https://chatgpt.com/space/page_6aeadd6e8810819197fd76ba1f3b3923)의 현재 동작 명세를 기준으로
16개 기능군의 입력·wire·처리 순서·실패·재호출·반환 보장을 소스와 시험에 대응시켰다.
상위 Page의 마지막 갱신은 2026-11-05이며 상세 명세의 기준은 2026-11-04다.
Java 공개 API 이름의 대응만 확인한 [이전 감사](java-parity.md)와 별개의 확인이다.

판정에서 **대응**은 해당 구현 경로와 관련 로컬 시험이 있음을 뜻한다. 모든 입력·오류의 언어 간 동등성이나
실서비스 인수를 뜻하지 않는다. **차이**는 기존 결정 문서에 기록된 언어/전송 경계,
**보류**는 미채택 정책·미확정 계약, **미검증**은 현재 시험으로 증명하지 않은 범위다.
결정 기록을 구현 완료나 운영 승인으로 바꾸지 않는다.

## 1. 서버 API 인증과 통신 — C-02

[원본](https://chatgpt.com/space/page_405965fc2ed481919b42792fcbbc7bc7).
구현: `src/privy-client.ts`, `src/internal/http.ts`. 시험: `tests/privy-client.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| appId/secret·origin·loopback 입력, 생성 시 무통신, 미설정 token 검증은 구성 오류 | 대응 |
| UTF-8 Basic 인증·privy-app-id, GET users limit=1 진단, 빈 목록 성공 | 대응 |
| body 전체 기한·4MiB 정확 경계·취소·자동 재시도 없음·오류 원문 비노출 | 대응 |
| HTTP code/status/첫 Retry-After·날짜·int64 초 보존 | 대응; 밀리초 bigint 반환 |
| Java int64 밀리초 설정 전체 범위와 일반 실행 예외의 완전한 동일성 | 차이 TS-04·09; 전체 동등성 미검증 |

## 2. 사용자 access token — C-02

[원본](https://chatgpt.com/space/page_bf67fc040e1c819192a4624ca8ab74ae).
구현: `src/token-verifier.ts`, `src/internal/jwks.ts`, `src/internal/lossless-json.ts`.
시험: `tests/token-verifier.test.mjs`, `tests/jwks.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| raw/Bearer의 부재·길이·공백 검사 순서, ES256/typ/crit/kid | 대응 |
| issuer/audience/sub/sid/linked_accounts, NumericDate 원문·최댓값·선후 시간 검사 | 대응; 시각 bigint 표현은 TS-06 |
| SPKI P-256 고정 키 또는 명시 JWKS URL, jku 미사용·JWKS에 앱 비밀 미전송 | 대응 |
| 동시 32회 조회 공유·TTL·kid 회전·실패도 갱신 횟수 소비·만료 키 fallback 없음 | 대응 |
| Nimbus 비표준 파싱·전체 JWK 선택 조합과 실제 Privy 발급/회전 | 미검증 D-09/TS-05·07; 합성 서명 토큰 시험과 구분 |

## 3. 승인키와 운영 지갑 — C-01·03

[원본](https://chatgpt.com/space/page_5dd5a54ea93c81919f914173db0eafd2).
구현: `src/backend-wallet.ts`, `src/internal/wallets.ts`, `src/internal/wallet-export.ts`.
시험: `tests/wallets.test.mjs`, `tests/wallet-export.test.mjs`, `tests/java-utf8.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| P-256 SPKI/PKCS8 PEM·개인키 redaction·생성 무통신 | 대응 |
| 고정 등록 chain enum·공개키 owner·blank 선택 필드 생략·개인키 미전송 | 대응 |
| 승인키별 전체 페이지 목록과 별도 public_key 문자열 비교의 기존 의미 | 대응; 운영 목록에 반복 cursor 방어를 임의 추가하지 않음(D-08) |
| 요청별 임시 수신 키·SPKI DER·고정 HPKE suite·빈 info/AAD·전체 UTF-8 평문 반환 | 대응; Java BC1.83 벡터 및 malformed UTF-8 corpus 시험 있음 |
| fromEnvironment·ensureBackendWallet·generateAndLog·exportAndLog | 미구현·보류 TS-08/D-04; 구현 완료 항목으로 계산하지 않음 |
| 실제 Privy export와 일반 등록의 전체 체인별 수용 | 미검증 D-10/C-12 |

## 4. 회원 지갑 — C-01

[원본](https://chatgpt.com/space/page_a52f393e2834819182ad9534f7cf86c6).
구현: `src/member-identity.ts`, `src/internal/wallets.ts`.
시험: `tests/member-identity.test.mjs`, `tests/wallets.test.mjs`, `tests/member-signer.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| namespace/partner 범위·Java blank·무정규화, SHA-256/NUL/Base64url·접두사 분리 | 대응; 잘못된 UTF-16은 Java 치환 경로(TS-02) |
| external_id/authorization_key/include_archived=false/limit/cursor 조회 | 대응 |
| 빈 페이지 계속 조회·전 페이지 중복·다른 연결/체인·반복 cursor 거부 | 대응 |
| 부재 때 한 번 생성·409에서 한 번 재조회·그 외 무재전송 | 대응 |
| signerFor는 자동 생성 없음·승인키 목록 권한·파트너 callback 매 서명 재검사 | 대응 |
| 실제 tenant/파트너 매핑·동의·키 교체·이관·App A/B 격리 | 서비스 책임·정책 보류 또는 실환경 미검증(D-01·03) |

## 5. 지갑 서명과 거래 제출 — C-03

[원본](https://chatgpt.com/space/page_9f9f2311e1908191b2bf7c34844ee292).
구현: `src/internal/authorization.ts`, `src/internal/privy-signer.ts`.
시험: `tests/authorization.test.mjs`, `tests/privy-signer.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| 정확한 wallet ID/ethereum 권한으로 signer 확보, export 미사용 | 대응 |
| 실제 URL/body/header 결속·P-256 DER/Base64·expiry 자동 추가 없음 | 대응; 서명 바이트 자체가 아닌 payload와 서명 검증을 비교 |
| personal_sign은 UTF-8 문자열, typed data 필드 순서/primary_type·큰 정수 문자열 보존 | 대응 |
| send의 signer from·caip2/chain_id·legacy gas 필드·null 생략·무재시도 | 대응 |
| 승인 숫자/특수 키 정규화 및 공백 idempotency key | 차이 TS-10·12; provider 경계 전체 수용은 미검증 |

## 6. ETH 잔액과 전송 — C-04

[원본](https://chatgpt.com/space/page_9a2be5963e848191a17af5bc4f898dbe).
구현: `src/asset-client.ts`. 시험: `tests/asset-client.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| Arbitrum Sepolia/정수 wei/주소 원문·최소 quantity·uint256 범위 | 대응 |
| chain→estimate→gasPrice→pending nonce→한 번 signer 호출·gas 보정 없음 | 대응 |
| signer 이전 실패와 이후 SUBMISSION_UNRESOLVED·잘못된 hash·무재전송 | 대응 |
| 공유 nonce 관리·완성 거래 복구 API·다른 자산 | 서비스 책임 또는 D-13 보류; ERC-20/발행은 원래 자동 포함 범위 아님 |

## 7. EVM JSON-RPC — C-04

[원본](https://chatgpt.com/space/page_dfed429c037081919e56fa4b6b941aec).
구현: `src/evm-rpc.ts`, `src/internal/chain-json.ts`. 시험: `tests/evm-rpc.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| URI 조건·인스턴스별 증가 id·JSON POST·앱 비밀 없음 | 대응 |
| 엄격 JSON·200·jsonrpc/id·error 필드 존재 우선·result null | 대응 |
| 4MiB/body 완료 기한·취소·method별 오류·외부 원문 미노출 | 대응 |
| Java socket connect/read와 Fetch header/body 시간 의미·소수 밀리초 | 차이 TS-14; 완전히 같은 연결 경계라는 주장 없음 |

## 8. 거래 상세·상태·발신 목록 — C-04

[원본](https://chatgpt.com/space/page_c55ec674a8288191b489407073f1f2b8).
구현: `src/evm-transaction-client.ts`, `src/internal/transaction-data.ts`, `src/internal/transaction-cursor.ts`.
시험: `tests/transaction-detail.test.mjs`, `tests/transaction-list.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| NOT_FOUND/PENDING/MINED/SUCCEEDED/REVERTED·원본 중첩 snapshot·수수료/quantity 보존 | 대응 |
| tx/receipt/블록 결속과 WRONG_CHAIN/CHAIN_CHANGED/INVALID_RESPONSE 구분 | 대응 |
| from 기준 역순·100블록 상한·빈 페이지 cursor·genesis·upper 고정·마지막 anchor | 대응 |
| 범위 query 및 limit/cursor 편의 호출·cursor bytes/수신 경계 | 대응; 전체 비정규 파서 상호 호환은 TS-18 미검증 |
| 입금/내부 호출/pending 전체 목록·독립 합의 포함 증명 | 원본 범위 밖; 추가 기능 누락으로 계산하지 않음 |

## 9. DMRVN 데이터·방법론·Evidence — C-05

[원본](https://chatgpt.com/space/page_81c81f4ee55c8191ad47d246703f5ac7).
구현: `src/dmrvn-json.ts`, `src/internal/chain-json.ts`, `src/declared-methodology.ts`.
시험: `tests/dmrvn-crypto.test.mjs`, `tests/declared-methodology.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| JSON 중복/Unicode/정수/소수 원문·UTF-16 정렬·escape·-0 및 기존 비왕복 decimal | 대응; Java와 모든 입력 교차실행은 미검증 TS-15·19 |
| manifest canonical hash·WASM raw hash·uint32·명시 registry callback | 대응; WASM 실행/도메인 입력 해석은 원본 SDK 책임 아님 |
| 정확한 본문 7키·source.ownerHash·inputs 복사·본문 1MiB | 대응 |
| 명시 Evidence 버전 미설정 시 고수준 중단·과거 3/시험999를 운영 기본값으로 사용하지 않음 | 대응 |
| 승인된 새 wire·입력 프로필·registry 원천·validator 수용·표준 JCS 전환 | 보류 D-02·17·19·30; 임의 버전으로 대체하지 않음 |

## 10. DMRVN 해시·서명·ABI — C-05

[원본](https://chatgpt.com/space/page_83a8e7f96320819197e1dd6bd881b033).
구현: `src/dmrvn-crypto.ts`, `src/dmrvn-protocol.ts`, `src/dmrvn-abi.ts`.
시험: `tests/dmrvn-crypto.test.mjs`, `tests/dmrvn-protocol.test.mjs`, `tests/dmrvn-abi.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| Keccak/secp256k1/r-s-v·low-s·personal-message UTF-8 길이·출처 approver 결속 | 대응 |
| 6개 EIP-712 타입·중첩 EvidenceLocation·domain 7/1·digest·typed data | 대응 |
| 동봉 ABI·tuple/offset/배열/지원 폭·call 재인코딩·event topic | 대응; 원본 executeBatch selector 결함과 제한은 TS-20 |
| committee 순서·report signer 정렬/중복·프로토콜 hash와 파일 hash 분리 | 대응 |
| 전체 Solidity ABI·모든 malformed decode·암호 입력 공간의 Java 동등성 | 범위 밖 또는 미검증; 고정 벡터 통과와 구분 |

## 11. 배포 설정과 준비 확인 — C-06

[원본](https://chatgpt.com/space/page_99a087c4081081918b9630dcbeda9b28).
구현: `src/dmrvn-config.ts`, `src/dmrvn-deployment.ts`, `src/dmrvn-chain.ts`, `src/dmrvn-preflight.ts`.
시험: `tests/dmrvn-config.test.mjs`, `tests/dmrvn-chain.test.mjs`, `tests/dmrvn-preflight.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| raw proxy/direct/정규 manifest·주소/영값·release 충돌·config identity·objectName 범위 | 대응 |
| pinned block·runtime hash·implementation/admin slot·release/version/owner/domain·reorg | 대응; 응답 number/최종 raw hash 경계는 원본 유지(TS-23) |
| 역할/방법론/명시 버전/잔액과 NOT_TESTED·validator 표식·ready 의미 | 대응 |
| direct 읽기/복구·신규 쓰기 거부·저장 배포 호환/ready 초기화 | 대응 |
| 현재 승인 배포·실제 역할/registry·저장소 권한·충분한 잔액 | C-12 미검증; testnet snapshot/preflight가 대신 증명하지 않음 |

## 12. Evidence 저장·생성 거래 복구 — C-07

[원본](https://chatgpt.com/space/page_fb3c15c66d1c8191b4fa45537e2f21a6).
구현: `src/internal/evidence.ts`, `src/node-greenfield-storage.ts`, `tools/greenfield/worker.cjs`.
시험: `tests/evidence.test.mjs`, `tests/node-greenfield-storage.test.mjs`, `tests/greenfield-bundle.test.mjs`, worker 시험.

| 확인 항목 | 결과 |
| --- | --- |
| 잠금 전 입력 복사/검증·claim/source 예약·정확 fingerprint·배포 재검증 | 대응 |
| 원본 서명 재사용·provenance 포함 1MiB·createIntent/hash 저장 경계 | 대응 |
| 모호한 create 무재호출·명백 오류 플래그만 intent 제거·원래 거래 복구 | 대응 |
| SEALED 및 원시 bytes 일치·기존 sealed 재사용·업로드는 원래 hash | 대응 |
| 전용 키 환경·stderr 폐기·5연산 protocol·stdout/시간/취소·실제 고정 SDK/RS 모듈 | 대응; worker UTF-8 수정과 시간 의미 차이 TS-38·41 |
| 실제 Greenfield/SP 생성·upload·validator private read·원래 거래 발견 | 미검증/운영 책임 D-23·24/C-12 |

## 13. Claim 승인·직접 납부·대납 — C-09

[원본](https://chatgpt.com/space/page_25b3cc8d6bcc819186d4f8a86d948094).
구현: `src/internal/claim-approval.ts`, `src/internal/submission-preparation.ts`,
`src/internal/sponsored-submission.ts`, `src/internal/submission-resolution.ts`, `src/internal/activity-submission.ts`.
시험: 같은 주제의 `claim-approval`, `submission-preparation`, `sponsored-submission`, `submission-resolution`, `activity-submission` 시험.

| 확인 항목 | 결과 |
| --- | --- |
| 승인 전 실제 Evidence·역할·활성·nonce/deadline·서명 전 요청 저장/재사용 | 대응 |
| ForwardRequest gas 고정·nonce·domain·사용자 서명 fingerprint·mode 충돌 | 대응 |
| relay 비용/잔액/pending=latest·130% floor·시뮬레이션·send 전 intent·한 번 전송 | 대응 |
| prepareSelfPaid는 calldata 반환 전 intent 저장·사용자가 직접 전송 | 대응; SDK의 새 직접 전송 함수가 빠진 것이 아님 |
| Claim/receipt/tx/calldata/sender/event 결속·성공한 자기 nonce 예약만 해제 | 대응; 실패 종료·추가 로그/anchor 강화는 D-22 보류 |
| intent 이후 만료·철회에도 새 승인/서명/send 대신 원래 거래 조회 | 대응 |
| 두 납부 경로의 실제 receipt·중단 복구 | C-12 미검증; 향후 인수 계획의 직접 납부 누락을 이번에 보완 |

## 14. journal과 실패 복구 — C-08

[원본](https://chatgpt.com/space/page_f13d7948d7b88191a8f4e3e3f07eaadf).
구현: `src/internal/dmrvn-state.ts`, `src/operation-journal.ts`, `src/memory-operation-journal.ts`,
`src/file-operation-journal.ts`, `native/posix-lock.c`.
시험: `tests/memory-journal.test.mjs`, `tests/file-operation-journal.test.mjs`, `tests/posix-lock.test.mjs`와 각 단계의 장애 시험.

| 확인 항목 | 결과 |
| --- | --- |
| 독립 snapshot·observations 후 durable save·required/fingerprint·배포 전체 claim 검색 | 대응 |
| activity/operation/claim/source/beneficiary/relay 잠금·예약·자기 nonce만 해제 | 대응 |
| 저장 단계 전후 실패·create/send intent 미확정 유지·서명/요청 재사용 | 대응; 모든 장애에서 서명 호출 1회라는 보장은 아님 |
| 메모리 monitor·nested async, 파일 realpath/권한/Keccak 이름·OFD 잠금·fsync/원자 교체 | 대응; 실제 프로세스/worker/Java FileChannel/강제 종료 시험 있음 |
| 전원 차단·NFS·분산 fencing·포맷 마이그레이션·취소/예약 수동 해제 | 미검증 또는 보류 D-21·25/TS-36·37; 기본 파일 구현의 보장으로 표시하지 않음 |

## 15. 고수준 활동 제출 — C-10

[원본](https://chatgpt.com/space/page_fca4ab0533e881919bc91d5415cc39b5).
구현: `src/activity-request.ts`, `src/internal/user-activity-submission.ts`, `src/activity-outcome.ts`.
시험: `tests/activity-request.test.mjs`, `tests/user-activity-submission.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| 불변 inputs·명시/기본값·gas/시간 범위·null 경계 | 대응; options/정수 밀리초 표현 차이는 TS-32 |
| 새 UUID/claimId/경로·선택 journal 전달·권한 signer→Evidence→대납 조합 | 대응 |
| 전송 반환 뒤 확인 대기·timeout=0 첫 조회·unresolved만 polling·send 오류 무poll | 대응 |
| 상태/intent 기반 FAILED·UNKNOWN·CONFIRMED와 errorCode·서명 비노출 | 대응 |
| confirmed 식별자는 요청/생성값, 추가 필드는 관찰 조건별·requested는 존재 증거 아님 | 코드 대응; README의 불완전한 설명을 이번에 보완 |
| sourceEventId 자동 dedup·journal 없는 자동 재개·전체 호출 deadline | 원본 보장 아님 또는 D-05·26 보류 |

## 16. 최종 보고서 조회·검증 — C-11

[원본](https://chatgpt.com/space/page_ad32a4b21f0c8191a2d5e5a236ed90f1).
구현: `src/dmrvn-reader.ts`, `src/internal/report-verifier.ts`, `src/internal/result-observation.ts`, `src/greenfield-public-reader.ts`.
시험: `tests/dmrvn-reader.test.mjs`, `tests/report-verifier.test.mjs`, `tests/result-observation.test.mjs`, `tests/greenfield-reader.test.mjs`.

| 확인 항목 | 결과 |
| --- | --- |
| confirmedHead·Claim 0..4·PENDING timeout 표식·REVOKED 무보고서·task UNKNOWN | 대응 |
| 보고 이벤트 검색·receipt/tx·기본 v4 resolver·4MiB 원시 파일·읽기 전용 오류 보존 | 대응 |
| onReport 엄격 decode·committee/threshold/membership·coordinator/관찰 서명·reportHash | 대응 |
| source/Claim 결속·VALID/INVALID 출력·정확 3키/value/unit/scale·추가 metadata 경계 | 대응; 출력 의미/권한 이력은 D-27·28 보류 |
| report/output/file hash 분리·선택 expectedFileHash·metadataIndependentlyVerified=false | 대응; 외부 hash 공급·신뢰는 미결 |
| 공개 reader의 Java URL 인코딩·무인증 raw bytes·timeout/권한 오류 | 대응; dot segment/Fetch 경계 차이 TS-26 |
| private Evidence provenance·journal 관찰 저장·제출 확인/nonce 해제와 분리 | 대응; 작업 readResult가 expectedFileHash=null을 전달하는 원본 경계 유지 |
| 실제 coordinator/validator 보고서·독립 commitment 신뢰·과거 철회 이력 | 미검증 또는 D-27~29 보류 |

## 통합 제안과 증거 문서의 위치

[통합 검토](https://chatgpt.com/space/page_0c8b295884908191b1e7674c78d4d83b),
[요구사항 대조표](https://chatgpt.com/space/page_ff579a75da688191a2754713aa18a6fe),
[M-01~09](https://chatgpt.com/space/page_f0792a736f848191bdc7754f46af8007),
[통합 작업 순서](https://chatgpt.com/space/page_31bf670279ec819196a7250e97d307ea)는 현재 동작과 목표 계약을 구분한다.
App 기반 기본 연결·callback 선택화·지갑/승인키 이관·새 wire·journal 없는 UNKNOWN 조사 계약은
채택된 의무 기능으로 확정돼 있지 않다. 기존 callback·단계별 복구를 삭제하거나 새 계약을 임의 구현하지 않았다.
실제 Privy App A/B 격리, 직접 납부/대납, Coordinator·Attestor·Aggregator 공동 처리는 별도 인수 대상이다.

[기능 지도](https://chatgpt.com/space/page_0c103e7348888191abb8163731e173c4)와
[구현 순서](https://chatgpt.com/space/page_913701b784108191b9a2a356c47bb2cf)의 책임 경계를 적용했다.
로그인 UI·OTP·refresh 발급·실시간 철회·범용 ERC-20·토큰 발행·WASM 계산·노드 합의는 자동 포함 범위가 아니다.

[전체 적합성 점검](https://chatgpt.com/space/page_edd021506c1081918f30a44fea9a999c),
[분석 근거](https://chatgpt.com/space/page_6785812ae048819187490f9c42cff8ea),
[대조 자료](https://chatgpt.com/space/page_8b8a57b3db048191b2f715cd81e00413),
[Java 사본 안내](https://chatgpt.com/space/page_73cb23765e3081918e5a7a55a54ed9b9)는 과거 증거의 범위를 설명하는 자료로 다뤘다.
문서용 시나리오를 실제 네트워크 캡처로, 원본 문서의 check_docs.py를 SDK 시험으로 계산하지 않았다.
이 감사는 원본 문서 전체 묶음/첨부 64개 사본의 checksum을 재검증한 작업이 아니다.

## 발견 사항과 조치

| ID | 발견한 공백 | 조치 |
| --- | --- | --- |
| A-01 | README confirmed 설명이 생성 식별자와 실제 관찰의 차이를 생략 | 항상 포함되는 ID와 단계별 추가 필드·존재 증거의 한계를 명시 |
| A-02 | C-12 계획에 대납만 있고 직접 납부 순서·비용·거래 증거가 빠짐 | 두 mode를 별도 작업으로 인수하는 미래 절차를 추가. 실제 실행/승인은 하지 않음 |
| A-03 | C-08의 메모리 journal 시험 이름이 실제 파일과 다름 | acceptance 문서에서 memory-journal로 정정 |

위 문서 공백 외에 검토한 현재 동작 명세의 주요 기능·불변식에 대한 새로운 코드 누락은 발견하지 못했다.
TS-08의 미구현 편의 API와 TS-42의 미제공 설정 조회, 기존 의도적 차이·정책 보류는 남아 있다.
이 결론은 모든 문장/모든 분기의 형식 증명이나 전체 입력의 Java 동등성을 뜻하지 않는다.

## 현재 검증과 남은 인수

- macOS ARM64/Node25.5.0에서 전체 시험을 다시 실행: 본체253 + worker14 = 267, 실패0·skip0.
- 새 보고서를 동봉한 실제 tarball 소비자의 strict Node 타입·ESM/native 실행과 모든 동봉 Markdown 링크 검사 통과.
- Linux ARM64/Node22의 기존 기록은 이전263개 시험 기준이며 이번에 재실행하지 않았다.
- 새 wire 공통 정상/거부 벡터·전체 JWT/JWKS 비정규 입력·임의 수치/서명의 Java 교차 실행은 미검증이다.
- C-12는 2026-11-09 사용자가 명시한 추후 결정 상태를 유지한다. 필요한 승인 설정과 두 제출 mode의 인수 순서는 [인수 문서](acceptance.md)에 있다.
- 로컬267개 통과를 전체 호환·제품 출시·실서비스 인수 완료의 근거로 대체하지 않는다.

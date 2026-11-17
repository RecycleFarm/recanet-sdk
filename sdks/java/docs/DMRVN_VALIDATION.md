# DMRVN 검증 기록

## 2026-11-04 파트너 단일 요청 계약: 오프라인 검증 PASS

기준 명세: `RecycleFarm/specifications@6da7d029ca9a9dad71e5b2928de0f3c06cc5b499`. 검증 대상은 현재 Java 작업 트리이며 기존 미커밋 회원 지갑/활동 처리 기능을 포함한다.

- `./gradlew build compileExamplesJava`: PASS. JUnit **126개**, failures=0/errors=0/skipped=0. 라이브 태그는 기본 시험에서 제외된다. Javadoc은 생성되며 누락된 문서 주석 경고는 남아 있다.
- `DmrvnActivityTest` 13개: journal 없는 단일 요청, 수혜자 signer 준비, Evidence 생성·봉인·승인·자동 서명·Relay receipt/Claim 확인, 임의 중첩 입력/다른 방법론, ownerHash 결속, 운영 지갑 불일치, 권한 거부, 봉인 후 실패, 저장·전송 응답 유실, receipt 발신자 변조, optional journal 장애와 신규 요청의 격리 검증.
- `UserWalletClientTest` 9개: 로컬 HTTP 기반 Privy 어댑터 시험. 회원 지갑 조회·생성/서명, 생성 충돌, 파트너별 동일 회원 ID 분리, 다른 파트너 거부, 서명 직전 동의 철회, 기존 비파트너 매핑과의 분리를 검증한다.
- 역사적 Evidence/Claim/Forwarder fixture 및 보고서/직접 납부 회귀 시험은 원래 bytes/hash를 유지한다. 새 입력의 소수 JCS 직렬화 및 정밀도 손실 거부도 확인한다.

실제 Privy 계정·Greenfield·EVM 쓰기/가스 사용·DMRVN 노드는 이번 변경에서 실행하지 않았다. 새 계약의 실환경 및 TC-C10 공동 인수는 **NOT_RUN/BLOCKED**다. 명세가 미결로 둔 새 Evidence wire 버전·공통 필드/직렬화 지원, 파트너 자격/권한 정책과 Privy 매핑은 운영자와 확정해야 한다. 신규 API는 버전을 명시하지 않으면 `EVIDENCE_CONTRACT_UNCONFIGURED`로 중단한다. 합성 버전 999와 로컬 signer/RPC를 쓴 시험은 배포된 버전/권한 모델의 증거가 아니다. 아래 과거 E2E 기록은 이전 계약의 증거로 보존한다.

## 2026-10-12 신규 Proxy PET 대납 E2E: PASS

사용자의 실환경 재시험 요청에 따라 `DMRVN_LIVE_RUN_ID=proxy-20261012-1104 DMRVN_LIVE_WAIT_MINUTES=45 python3 tools/run-dmrvn-live-test.py`를 실행했다. 이전 direct Claim을 재사용하지 않고 새 sourceEventId·원본·Claim으로 시험했다. 실제 Greenfield 저장, 테스트 사용자 EIP-712 서명, 실제 Privy Relay 제출, 최종 DMRVN 보고서까지 통과했다. 아래 명세 반영 단계에서 NOT_RUN이었던 **신규 proxy 대납 경로**의 후속 검증이다.

| 항목 | 결과 |
| --- | --- |
| JUnit | 실환경 테스트 1개, failures=0/errors=0/skipped=0, 약 3분 23초 |
| operationId | `sdk-java-pet-live-af356c06-a4fd-4022-a5ef-3ba6c7ffd2f8` |
| claimId | `0x93d5da3087f667121d7f213fe569d1afa693e69657e8fd1bc706075295bd957a` |
| 테스트 beneficiary | `0x0a5579dbb85516fb21f9c3d5aa4f19fedee70a7c` |
| Claim proxy / ForwardRequest.to | `0x5984B6C7773031497AcA9BF0C7C1155bdeAEd24e` |
| 구현 / 버전 | `0x9433EA187E38f9c7328cCDc2c229ED12E8746776` / `1.0.1` |
| 준비 검증 | 블록 `318265844`, 승인 manifest/ERC1967/code hash/domain/역할 확인 통과 |
| 입력 | PET `1003 / 2003v1`, `petBottleCount=3` |
| Greenfield CreateObject | `9F17454DF7995F506B14189782F2A62B2CD34134A42D4671DBA2F0EDA8D2749C` |
| evidenceHash | `0x4f96ea967f4610517e59b25119db85cc9578220c8055ed9cf8b5c547de478a57` |
| Claim 제출 거래 | [0x42500517…7dd95e8](https://sepolia.arbiscan.io/tx/0x425005179f827752874362082bee3dfe89599bd67eaf405b24e07ef1d7dd95e8) |
| 제출 블록 / receipt | `318266078` / status `1` |
| Claim nonce | `0` (proxy의 별도 nonce) |
| 등록 시각 | 2026-10-12 11:05:26 KST |
| 최종 확정 시각 | 2026-10-12 11:07:30 KST, 등록 후 124초 |
| 최종 상태 | `VALID`, `reportVerified=true`, `provenanceVerified=true` |
| 최종 출력 | `estimated_co2e={"value":"60","unit":"gCO2e","scale":0}` |
| 보고서 거래 | [0x9c90e49d…1b53e4](https://sepolia.arbiscan.io/tx/0x9c90e49d6096a544e56811550961a1fc006fccb891232dfabc1bbf00f51b53e4) |
| 보고서 블록 / receipt | `318266571` / status `1` |
| reportHash | `0x3e52a815efd3fee8bee1dcd98f0312eae3dd9f615cdc925c41b9f69090d2625a` |
| outputHash | `0xe3996e6b72ad8fd7c3e669be50216ed0bdfe3ab2e68ae1464f3083ef1b9a6545` |
| 다운로드 fileHash | `0x6519e718a9f4d8414670a6d2c41fd53fbba8869aad9cf44bc8d654dbb46da226` |
| 사용자 ETH / 사용자 거래 전송 | 시작·종료 잔액 `0`, 전송 호출 `0` |
| Relay 가스 | gasUsed `443135`, effectiveGasPrice `22504000 wei`, 비용 `9972310040000 wei` |

원본은 Greenfield `5600`, bucket `dmrvn`, `partners/101/activities/1003/sdk-java-pet-live-af356c06-a4fd-4022-a5ef-3ba6c7ffd2f8/evidence.json`에 private로 저장했다. SEALED 및 업로더 인증 재조회 bytes 일치를 확인했다. Claim 승인과 대납 사용자 서명은 같은 proxy에 결속되며, 실제 거래의 바깥 `to`는 재사용 Forwarder `0x8A5CF02d9c8855d8dcdBb75b8ABd6d3e0C4e6c7c`, 내부 `ForwardRequest.to`는 위 proxy다. Relay sender는 설정된 Privy 지갑 `0xf288EC9EcC516a7E4C6780b417f3a247fE20cC77`이다.

실환경 테스트에 proxy readiness/대상 주소 확인, `recordSponsoredSignature` 영속화 및 기존 서명 재사용, 최종 `sdk.readResult`의 원본 provenance 검증, 최초 deployment snapshot 보존 assertion을 추가했다. SDK가 성공 receipt, Claim/원본/보고서 결속, Coordinator 및 위원 3명의 서명, 다운로드한 실제 보고서의 reportHash/outputHash를 검증했다. 최종 관측 블록은 `318266619`다. 별도 fileHash 기준값은 주입하지 않았으므로 `fileHashVerification=DOWNLOAD_CHECKSUM_ONLY`다.

실행 근거는 `build/test-results/dmrvnPetLiveTest/TEST-com.youngminkim.recanet.dmrvn.DmrvnPetLiveTest.xml`과 비공개 journal의 `live-test:pet-result:<operationId>`에 있다. 같은 run ID 재실행은 기존 거래를 조회하며 새로 제출하지 않는다. 실제 테스트 사용자 키와 서명 전체는 문서에 기록하지 않는다.

이번 PASS는 신규 proxy **대납** 경로다. 직접 납부, 실제 upgrade/역할 변경, 운영 DB 분산 adapter 시험은 여전히 NOT_RUN이며 테스트를 위해 권한·컨트랙트 배포를 변경하지 않았다. PET은 신고 입력 방법론으로 실제 물리적 재활용 증명을 뜻하지 않는다.

## 2026-10-12 Proxy 명세 반영

- 명세: [RecycleFarm/specifications `341809a6255786b225317a60017173abcfe7b531`](https://github.com/RecycleFarm/specifications/tree/341809a6255786b225317a60017173abcfe7b531/dmrvn/backend-sdk). 열린 Issue/PR 없음 확인.
- 제품 기준: `52c6b1b76363ab3b192f88ce7642ea495e8c42b7` + 작업 시작 시 존재하던 미커밋 DMRVN/Privy 구현. 아래 결과는 이번 로컬 작업 변경에 대한 검증이다.
- 신규 기본 대상 proxy `0x5984B6C7773031497AcA9BF0C7C1155bdeAEd24e`, 현재 구현 `1.0.1`. Claim ABI와 공개 배포 manifest를 명세 사본으로 갱신했다. 과거 직접 배포 manifest와 고정 서명/보고서 fixture는 보존했다.

| 항목 | 결과 |
| --- | --- |
| `./gradlew test compileExamplesJava --offline` | Java 테스트 81개 통과, 예제 컴파일 성공 |
| `node --test tools/greenfield/worker.test.cjs tools/greenfield/pet-wasm-test.cjs` | worker 8개 및 PET WASM 시험 통과 |
| 실제 proxy 준비 검증 | 블록 `318264442`, hash `0x7085a5e5d129de9defe75875b9534bbead94810c492660326e1b170daff54cb5`에서 승인 manifest와 일치 |
| 실제 proxy PET 결과 독립 조회 | `VALID`, `reportVerified=true`, `estimated_co2e=60 gCO2e` |
| 과거 direct PET 결과 독립 조회 | 원래 주소에서 `VALID`, `reportVerified=true`, `estimated_co2e=60 gCO2e` |
| 새로운 proxy Privy 제출·실제 upgrade·역할 변경 시험 | NOT_RUN. 이번 작업은 새 거래/권한 변경/배포를 실행하지 않음 |

실제 proxy 조회에서 implementation `0x9433EA187E38f9c7328cCDc2c229ED12E8746776`, hash `0x4c52da3726d8dd045c20e0c5e5cffbad869bf9958b94facf3be550cd2dfb283d`, `contractVersion=1.0.1`, domain `7/1`을 확인했다. ERC1967 두 slot, proxy/Forwarder/ProxyAdmin/구현 code hash, ProxyAdmin owner, trusted Forwarder가 모두 일치했다. 설정된 승인자의 현재 role 및 공개 PET manifest/WASM hash도 확인했다. 실시간 Registry ACTIVE와 검증자 private 읽기 권한은 별도 운영 확인 대상이다.

조회한 기존 결과의 근거:

| 배포 | claimId | reportTxHash | 다운로드 fileHash |
| --- | --- | --- | --- |
| Proxy (명세의 공개 PET QA) | `0xbcc6f99931a306daa13d9755eed16a53da10e9a620eb603310b1879cafee6879` | `0xfbe13733875ca890726d033a2413727230a03def315522319086bd965c1d402d` | `0x690ce9f91812e2c35e39a449623527ad2ab3d08de5ff06311189fb6ad358d2f8` |
| Direct (10월 8일 제품 SDK QA) | `0x1a113abfb07d04a7a54f9b07e664a4b152fd4b769ca4061a36e522424daa7b34` | `0xfab29e1fd9d474bc577eed86a7b57ec97bfcbc30271db2cc20ff19a3292e7335` | `0x74834f16c891b607724a4f564a0f8dead2f9fb113d6c0ab51b0fe6ae577656e0` |

두 건 모두 저장 보고서를 다시 내려받아 성공 receipt/onReport 서명·quorum·Claim·source 위치·reportHash/outputHash를 검증했다. SDK에서 새 Claim을 제출한 증거가 아니다. 외부 fileHash를 강제하는 인자는 생략했으므로 `fileHashVerification=DOWNLOAD_CHECKSUM_ONLY`이며 위 값은 명세/기존 기록과 별도로 대조했다.

| 추가 인수 항목 | 이번 제품 코드 검증 |
| --- | --- |
| TC-37 | Claim domain·직접 `to`·ForwardRequest.to가 proxy. 구현/관리자 주소와 잘못된 manifest 차단 |
| TC-38 | 동일 블록 검증 및 chain/code/slot/owner/version/domain/trusted Forwarder/RPC/reorg 불일치 20개 변형 차단. 현재 proxy 실제 읽기 통과 |
| TC-39 | PENDING Claim에서 승인 upgrade 후 최초 snapshot 보존·현재 metadata 갱신, 대기 초과가 VALID로 바뀌지 않음을 mock 검증 |
| TC-40 | 재시작·승인 upgrade 후 저장된 정확한 승인/사용자 서명·digest 재사용 및 업로드/서명 1회 유지. 만료·nonce 소비·권한 회수 차단 |
| TC-41 | direct version getter 미지원(null/false), 원래 결과 실조회, 이전 index 없는 operation 및 다른 배포 예약과의 claimId 충돌 차단 |
| TC-42 | 미승인 구현 차단, 이전 verifiedMetadata 제거, 최초 snapshot·원본·승인 보존, 승인 상태 복구 후 재개 |
| TC-43 | 제출 전 현재 역할 확인. 생성 후 저장 approver와 provenance를 비교하여 역할 회수 후에도 복구·조회 가능, 다른 signer 변조 차단 |

TC-39/40/42/43의 실제 온체인 upgrade·역할 변경과 새로운 proxy Privy 제출은 NOT_RUN이다. 참조 QA의 6/6 PASS를 제품 SDK 인수 결과로 옮기지 않는다. 운영 DB의 분산 잠금/fencing과 `findOperationsByClaimId` adapter 인수도 미실행이다.

## 2026-10-08 Direct v7 과거 검증

검증일: 2026-10-08. 사용자 제공 handoff의 Claim v7 및 PET(1003/2003/1) 기준. 신규 재시험에서 Greenfield 원본 저장, 테스트 사용자 서명, 실제 Privy Relay의 Claim 등록, DMRVN 최종 보고서 검증까지 대납 경로 E2E를 통과했다. Claim은 14:28:44 KST에 VALID로 확정됐으며 PET 3개의 최종 결과는 60 gCO2e다. 등록부터 확정까지 34분 29초가 걸렸다.

## 로컬 검증

| 검증 | 결과 |
| --- | --- |
| `./gradlew test compileExamplesJava --offline` | Java 테스트 70개 통과, 예제 컴파일 성공 |
| `node --test tools/greenfield/worker.test.cjs` | 8개 통과 |
| 승인된 PET WASM 테스트 실행 | 입력 1→20, 3→60, 100000→2000000 gCO2e 통과; production SDK 계산 경로는 아님 |
| 프로토콜 참조 벡터 | JCS, EIP-712, location/report/committee hash 및 서명 검증 통과 |
| 모의 RPC/저장소 | 중복 제출, 응답 유실, nonce 예약, 원본 변경, 결과 검증 실패 및 명시적 CheckTx 거절 후 재시도 검증 |
| `python3 tools/run-dmrvn-live-test.py` (최초 이벤트) | 원본 저장·사용자 서명·Privy Relay 제출·Claim receipt 검증 성공. 10분 후 PENDING으로 로컬 대기 시간 초과 |
| `DMRVN_LIVE_RUN_ID=retest-20261008-1353 DMRVN_LIVE_WAIT_MINUTES=30 python3 tools/run-dmrvn-live-test.py` (신규 이벤트 재개) | 실환경 JUnit 1개 통과, failures=0/errors=0. 동일 Claim 재조회 후 VALID·reportVerified=true·60 gCO2e 검증 완료 |

## 실서비스 읽기 및 서명

- Arbitrum Sepolia 421614의 Claim runtime hash와 trusted Forwarder가 지정 배포와 일치.
- 설정한 승인자의 Claim role 확인. Relay 잔액 조회 시 0.5 ETH.
- 실제 Privy EIP-191 및 만료된 진단 Claim의 EIP-712 서명을 복구해 설정 주소와 일치 확인. 진단 서명으로 EVM 거래를 전송하지 않음.
- 공개 PET manifest와 WASM bytes를 받아 지정 hash와 일치 확인. 현재 Registry ACTIVE 여부는 별도 공개 API가 제공되지 않아 handoff의 2026-10-07 ACTIVE 스냅샷을 사용함.

기존 역사적 Claim을 새 SDK로 독립 조회한 결과:

| 상태 | claimId | reportTxHash | 결과 |
| --- | --- | --- | --- |
| VALID | `0x07885d023cfb8a2a2af8096aa2117d60cf0bedfa83a8c8bb18f198404b19af1e` | `0x906f54c7c30dca2713910431efecb544b4956a89906638098b0a97463a156968` | reportVerified=true, PET 3개 → 60 gCO2e |
| INVALID | `0xa18f549fe5ccb55649f88220d029a541495e7c98bab80f6131faa29fb7ddcca9` | `0x99e4dfad5fbbb06c190c9272cf80e509d925b25019cc8e6b04288d645bab675c` | reportVerified=true, outputs={} |

두 건은 새 제출의 결과가 아니다. 체인 상태·receipt·onReport calldata·서명·Greenfield 보고서 bytes를 대조한 조회 검증이다.

## 새 PET 원본 저장: 성공

- operationId: `sdk-java-pet-sponsored-a764279b-28d5-4abe-a726-b28c055a6e5e`
- 예정 claimId: `0xe3f1c98254cce5f75f23547b918fcda259304381f0c0bf2b912cb6f359ee796f`
- beneficiary: `0xeA9ecC2F4D32E075e961Afffd522bbf88BBA40a9`
- 입력: `petBottleCount=3`
- Greenfield chain: `5600`, bucket: `dmrvn`
- objectName: `partners/101/activities/1003/sdk-java-pet-sponsored-a764279b-28d5-4abe-a726-b28c055a6e5e/evidence.json`
- evidenceHash: `0xfdaff63d0669f039adaa0f20eec413f461601b2d94abe83606f82e5247f9b47d`
- CreateObject txHash: `613850E8C86B9D072054597D3F3DF90B1A730A12B1B66000A771B1F0CF0345B5`
- 확인 블록: `36018371`, transaction code: `0`
- private 객체 업로드, SEALED, 인증 재조회한 bytes와 원본의 완전 일치 확인.

확정된 거래 protobuf를 공개 RPC에서 다시 읽어 다음을 확인했다:

| 필드 | 값 |
| --- | --- |
| creator | `0xf288EC9EcC516a7E4C6780b417f3a247fE20cC77` |
| fee.payer | creator와 같은 체크섬 주소 |
| fee.granter | `0x812EA1e3fb2EFA004AE1308ed27EcEd0b05Cae66` |
| signerInfos 개수 | 1 |
| signatures 개수 | 1 |
| 거래 수수료 | 6000000000000 BNB 기본 단위 = 0.000006 BNB, Feegrant 사용 |
| 거래 후 업로더 잔액 | 0 BNB |

## CreateObject 오류 원인 및 수정

관측한 CheckTx 오류 원문:

```text
Broadcasting transaction failed with code 4 (codespace: sdk).
Log: wrong number of signers; expected 2, got 1: unauthorized
```

이는 버킷 쓰기 권한 부족을 뜻하는 오류가 아니었다. creator/payer를 같은 소문자 주소로 넣은 서명 거래는 위 오류를 재현했고, 두 필드를 같은 EIP-55 체크섬 주소로 통일한 서명 거래는 통과했다. Feegrant granter는 별도 설정된 후원자이며 이 거래에 두 번째 서명을 붙이지 않았다.

방송 함수를 차단한 진단에서 동일 원본의 서명 바이트를 시뮬레이션해 비교했다:

| 주소 설정 | 서명 개수 | 결과 |
| --- | --- | --- |
| creator/payer 소문자 | 1 | expected 2, got 1 재현 |
| creator/payer 체크섬 | 1 | PASS, gasUsed=1200 |
| creator 체크섬, payer 기본값 | 1 | PASS, gasUsed=1200 |

실제 수정은 creator/payer/granter를 체크섬 주소로 통일하는 방식이다. storage key의 선택적인 `0x` 접두사도 공식 SDK 입력 형식으로 정규화했다. 서명 검증 오류를 `SIGNATURE_INVALID`로 분리했고, typed CheckTx 거절과 연결 단절을 구분한다. 확실한 거절만 같은 원본으로 재시도하며 전송 결과가 불명확하면 의도를 유지한다. 기존 실패 건은 관측한 CheckTx 거절 근거를 journal에 기록하고 동일 operation/원본/경로로 재시도했다.

## 테스트 사용자 서명으로 실제 Claim 등록: 성공

`DmrvnPetLiveTest`가 테스트 전용 사용자 지갑으로 EIP-712 서명을 생성해 백엔드 SDK에 전달한다. 승인자·Relay는 실제 Privy, 원본 저장은 실제 Greenfield다. 제품 SDK에는 사용자 개인키/사용자 서명 기능을 추가하지 않았다. 기존 beneficiary의 키를 사용한 시험이 아니므로 새 원본 및 고유 이벤트로 수행했다.

- 테스트 beneficiary: `0x0a5579dbb85516fb21f9c3d5aa4f19fedee70a7c`
- operationId: `sdk-java-pet-live-dec883ef-4f69-4c12-bb9e-d8a7311fce0e`
- claimId: `0xfca5e62172d026e64c0d033ab3a793e3fa5d3bab42e7b156874f070733a4472b`
- Greenfield CreateObject txHash: `6EE652B838F93C631449EC6BDA7715B71BCB7238AC40645CE39055C5D5C41DCC`
- 원본 경로: `dmrvn/partners/101/activities/1003/sdk-java-pet-live-dec883ef-4f69-4c12-bb9e-d8a7311fce0e/evidence.json`
- evidenceHash: `0x780174abdaa9d058234e7acacf19a3aca03775d43bd249597aba443860617c2f`
- Claim 제출 거래: [0x368880fe…988b3bc](https://sepolia.arbiscan.io/tx/0x368880fe80b1f0ecb2f475de823dd4d2ad6bb20a5fec74ac935fb0a02988b3bc)
- Arbitrum Sepolia 블록: `316920528`, receipt status: `1`
- Relay sender: `0xf288EC9EcC516a7E4C6780b417f3a247fE20cC77`; target: 지정 Forwarder.
- gasUsed: `449117`, effectiveGasPrice: `97626000 wei`, 실제 Relay 비용: `43845496242000 wei`.
- 제출 당시 사용자 ETH: `0`. 사용자 테스트 signer의 거래 전송 호출: `0`.
- SDK receipt 검증: sender/to/calldata, Claim 이벤트/nonce/원본 결속, Forwarder 사용자 signer/nonce/success 일치.

2026-10-08 12:19 KST 기준 10분 관찰 결과 `chainStatus=PENDING`, `taskStatus=UNKNOWN`, `observationStatus=LOCAL_WAIT_TIMEOUT`, `reportVerified=false`다. 최종 계산 outputs와 reportTxHash가 아직 없다. 이는 로컬 대기 시간 초과이며 네트워크 Task의 NO_QUORUM/EXPIRED나 검증 실패로 해석하지 않는다. 공개 Greenfield 권한 조회에서는 업로더와 버킷 소유자의 이 원본 GET_OBJECT가 모두 ALLOW였다. 실제 Coordinator/Attestor/Aggregator가 사용하는 읽기 계정과 프로세스 실행 상태는 운영 로그 확인이 필요하다.

재실행은 같은 Claim을 조회하며 중복 제출하지 않는다. 확정된 보고서가 도착해야 `VALID`, 실제 보고서 hash·quorum 서명, `60 gCO2e` assertion을 통과한다. 현재 60은 방법론의 예상값이며 이 Claim에서 관측한 최종값이 아니다.

최초 Relay API 호출은 HTTP 400 `invalid_data`로 거절됐다: `params.transaction.chain_id`의 문자열은 `0x`로 시작해야 한다. `PrivyEvmSigner`의 문자열 `421614`를 `0x66eee`로 수정하고 HTTP mock 테스트에 실제 형식과 idempotency 헤더 검증을 추가했다. 원래 요청의 응답을 같은 idempotency key로 복구해 명시적 거절을 확인한 뒤 같은 Claim/사용자 서명을 유지했다. 수정된 HTTP 본문에는 새 key를 사용하고 journal에 근거를 기록했다. [Privy idempotency 규칙](https://docs.privy.io/api-reference/idempotency-keys)에 따라 본문이 바뀌면 같은 key를 재사용하지 않는다.

## 2026-10-08 13:54 KST 신규 이벤트 재시험

명령: `DMRVN_LIVE_RUN_ID=retest-20261008-1353 python3 tools/run-dmrvn-live-test.py`

기존 Claim을 재전송하지 않고 동일한 테스트 사용자로 별도 sourceEventId·원본·Claim을 생성했다. 같은 run ID로 다시 실행하면 이 재시험 기록을 이어서 조회한다.

| 항목 | 값 |
| --- | --- |
| operationId | `sdk-java-pet-live-f590fff2-1993-4637-9bdf-4e1c0ab6f231` |
| claimId | `0x1a113abfb07d04a7a54f9b07e664a4b152fd4b769ca4061a36e522424daa7b34` |
| Greenfield CreateObject txHash | `4334C7D8C97517337062D2DDEA274FC53159BFEDA25B44983A968EB09D16472D` |
| evidenceHash | `0x2534b7bd14aa7fbb29087635e51401140358b9d8dbaf25125e0cd9431f4ac481` |
| Claim 등록 txHash | `0x4298b9f21e6e6d12da2bf8240291229bb88dd5ea1ed15f3b7dba8a064cce9f48` |
| 등록 블록 | `316945731` |
| 사용자 Claim nonce | `1` |
| 원본·등록 검증 | SEALED, 동일 bytes 재조회 및 CONFIRMED receipt 검증 통과 |

14:04 KST까지 10분간 조회한 결과 PENDING이었다. 사용자에게 DMRVN 검증 요청이 많아 지연될 수 있다는 운영 상황을 전달받아, 14:05 KST에 같은 run ID와 `DMRVN_LIVE_WAIT_MINUTES=30`으로 조회를 재개했다. 원본 업로드나 Claim 거래를 새로 보내지 않았으며, 저장된 CreateObject 및 Claim 거래 hash가 그대로 유지되는 것을 확인했다. 로컬 대기 시간 초과는 DMRVN 검증 실패를 의미하지 않는다. 이전 Claim `0xfca5…4472b`는 14:24 KST 별도 재조회에서도 PENDING이었다.

### 신규 이벤트 최종 결과: PASS

| 항목 | 값 |
| --- | --- |
| 등록 시각 (컨트랙트 requestedAt) | 2026-10-08 13:54:15 KST |
| 확정 시각 (컨트랙트 finalizedAt) | 2026-10-08 14:28:44 KST |
| 등록부터 확정까지 | 2,069초 = 34분 29초 |
| SDK 검증 완료 | 14:28:56 KST, 관측 블록 `316954036` |
| 최종 상태 | `chainStatus=VALID`, `observationStatus=FINALIZED`, `reportVerified=true` |
| 최종 결과 | `estimated_co2e={"value":"60","unit":"gCO2e","scale":0}` |
| 보고서 등록 txHash | `0xfab29e1fd9d474bc577eed86a7b57ec97bfcbc30271db2cc20ff19a3292e7335` |
| 보고서 등록 블록 / receipt status | `316954012` / `1` |
| reportHash | `0x98fee8b10e1e27b08bd10a87d9a4cacee510a053c845410b868b3c0bd8bfd057` |
| outputHash | `0xe3996e6b72ad8fd7c3e669be50216ed0bdfe3ab2e68ae1464f3083ef1b9a6545` |
| 내려받은 보고서 fileHash | `0x74834f16c891b607724a4f564a0f8dead2f9fb113d6c0ab51b0fe6ae577656e0` |
| Task ID | `0xecae72566c58ee95c21e162274d55979a583c956c28d1b11580dea82eac4fed8` |
| onReport quorum | committeeSize=5, threshold=3, committee 5개, observation 서명 3개 |

공개 RPC의 실제 `onReport` calldata에서 위원 수 및 threshold를 확인했다. SDK는 성공 receipt, Coordinator 서명, 서로 다른 위원 3명의 EIP-712 서명, 원본·방법론·출력 결속, Greenfield 최종 보고서 bytes의 reportHash와 outputHash를 검증했다. 보고서 경로는 `dmrvn/dmrvn/v4/reports/98fee8b10e1e27b08bd10a87d9a4cacee510a053c845410b868b3c0bd8bfd057.json`이다.

사용자 ETH 잔액 0 및 사용자 signer의 거래 전송 호출 0 assertion도 통과했다. 최종 JUnit XML은 `build/test-results/dmrvnPetLiveTest/TEST-com.youngminkim.recanet.dmrvn.DmrvnPetLiveTest.xml`에 기록됐다. 60 gCO2e는 이제 이 신규 Claim의 실제 확정 결과다. 방법론은 `DECLARED_INPUTS_V1`이며 물리적 재활용 증명은 포함하지 않는다. 별도 fileHash 기준값이 없으므로 `fileHashVerification=DOWNLOAD_CHECKSUM_ONLY`, 설명 metadata는 `metadataIndependentlyVerified=false`로 유지한다.

## 남은 실환경 검증

- 별도 operation으로 사용자 직접 납부 제출 및 결과 확인.
- 현재 Registry ACTIVE의 실시간 조회, 검증자별 private 원본 읽기 권한 및 5개 노드의 독립 운영 로그 확인. 이번 시험의 온체인 3-of-5 quorum 및 실제 Final Report 검증은 완료했다.
- 운영용 공유 DB journal의 분산 잠금/fencing과 로컬 EVM 실제 revert 변형 검증.

이번 성공은 신규 재시험의 대납 경로에 해당한다. 이전 Claim의 상태나 별도 직접 납부 경로의 완료로 확대하지 않는다.

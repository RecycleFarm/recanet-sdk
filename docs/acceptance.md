# 인수 현황과 실환경 실행 조건

기준 Java commit: 37c78cfa01d9892ca26de61bb74df827923917cf.
원본 인수 기준은 [SDK 구현 안내](https://chatgpt.com/space/page_e0d0b65f86e4819187dae9da1f64a4b8)의 C-01~C-12다.
이 문서는 구현 시험과 실제 서비스 수용을 구분한다. 전체 운영 호환·실환경 인수 완료를 선언하지 않는다.
미결 정책은 사용자의 요청에 따라 [의사결정 목록](decisions.md)에 보존한다.

| ID | 현재 증거 | 아직 증명하지 않은 범위 |
| --- | --- | --- |
| C-01 | member-identity, wallets, member-signer 시험: 고정 벡터·pagination·경쟁 생성·권한 철회 | 실제 tenant/파트너 매핑·Privy 생성 경쟁 |
| C-02 | privy-client, token-verifier, jwks 시험: 생성 서명·시각·캐시/회전·로컬 HTTP 오류 | 실제 Privy token/JWKS·앱 권한 |
| C-03 | authorization, privy-signer, wallet-export 시험: DER·wire·BC1.83 HPKE 벡터 | 실제 provider 서명/export 수용 |
| C-04 | asset-client, transaction-detail/list, evm-rpc 시험: 큰 정수·nonce·cursor/reorg | 실제 EVM 전송·provider 일관성 |
| C-05 | dmrvn-crypto/abi/protocol, declared-methodology, java-utf8 시험 | 모든 수치/암호 사례의 Java 프로세스 교차 실행·새 Evidence 계약 승인 |
| C-06 | dmrvn-config/chain/preflight 시험: pinned block·proxy/slot/code/domain·불일치 | 승인 배포의 현재 실측·준비 상태 |
| C-07 | evidence, node-greenfield-storage, 공식 worker 시험: 동일 bytes·seal·원래 create hash·protobuf | 실제 SP 생성/업로드/seal·validator private read |
| C-08 | memory/file-operation-journal, posix-lock, sponsored-submission 시험: 실제 프로세스·fsync·강제 종료·intent | 전원 차단·Linux 실행·NFS/분산 환경 |
| C-09 | claim-approval, submission-preparation/resolution 시험: 서명·calldata·sender·receipt/event·Claim 결속 | 실제 승인 배포의 접수 거래 |
| C-10 | activity-request/submission, user-activity-submission 시험: 새 ID·대기·관찰 사실·UNKNOWN | 실제 회원 지갑·저장소·relay 통합 실행 |
| C-11 | report-verifier, dmrvn-reader, result-observation 시험: quorum·변조·상태/fileHash 경계 | 실제 coordinator/validator 보고서와 독립 파일 수용 |
| C-12 | 아직 없음 | 승인된 provider·배포·권한·방법론·validator 계약의 실제 수용 |

시험 파일은 tests 디렉터리의 해당 이름에 .test.mjs를 붙인다.
공식 worker 시험은 tools/greenfield/worker.test.cjs다.
현재 npm run check는 본체 249개와 worker 14개를 실행한다.
Node 22.12와 25.5의 macOS ARM64 실행, Java17 FileChannel과의 실제 잠금 충돌,
BC1.83 생성 HPKE 벡터 및 Java17 UTF-8 1,197,480개 corpus 비교를 수행했다.
패키지는 npm run check:package로 별도 소비자 설치·strict 타입·ESM·ABI·native journal을 검증한다.

## C-12 실행에 필요한 승인 입력

저장소의 testnet manifest나 과거 PET fixture를 현재 승인 계약으로 간주하지 않는다.
아래 값은 운영 담당자가 지정한 출처와 함께 제공해야 한다.
실제 비밀 값은 대화·문서·Git에 넣지 않고 로컬 환경 또는 서비스의 비밀 저장소에서 주입한다.

| 입력 | 확인할 내용 | 관련 결정 |
| --- | --- | --- |
| 배포 manifest와 RPC | chainId·proxy·forwarder·admin·owner·승인 implementation/release/code hash와 현재 수용 출처 | D-19·20 |
| Evidence 계약 | 승인 schemaVersion·파트너 입력 프로필·manifest/WASM/hash·실제 registry 조회 adapter | D-02·17·19·30 |
| Privy 앱·지갑·승인키 | 테스트 앱 권한·JWT 검증 원천·operator wallet ID/주소·파트너/회원 동의·서명 직전 철회 정책 | D-01·03·09·10·11 |
| Greenfield | network/RPC/SP·기존 bucket/prefix·storage signer·feegrant·validator private-object 읽기 권한 | D-24 |
| 테스트 예산 | 허용 네트워크·대상 계정·relay 및 storage 비용 상한·잔액·실제 쓰기 허용 범위 | D-22·23·24 |
| 보고서 신뢰 | coordinator/committee 권한 근거·quorum policy·report resolver/reader·선택 외부 file commitment 출처 | D-27·28·29 |
| 배포 방식 | SDK package명/라이선스·지원 OS/arch·native build/prebuild·worker 설치·취약점 처리 | TS-01·36·39 |

Greenfield 고정 의존성 감사 결과와 업그레이드/override 선택은
[별도 기록](greenfield-dependencies.md)을 확인한다. 시험 통과를 해당 위험의 승인으로 해석하지 않는다.
현재 승인 입력이 세션에 지정되지 않았으므로 실제 생성·전송·export·보고서 조회 인수는 실행하지 않았다.

## 승인 환경에서의 인수 순서

1. 승인 설정/의존성/실행 runtime과 SDK commit을 고정한다. 비밀 저장·서명 권한을 확인한다.
2. 앱 자격 증명·지갑 매핑·JWT와 읽기 전용 배포/preflight를 확인한다.
   preflight ready는 충분한 비용·private 읽기·validator 수용의 증거가 아니다.
3. 승인된 입력으로 Evidence를 만들고 실제 private create·upload·SEALED 및 raw bytes 재읽기를 확인한다.
   validator 계정에서도 해당 객체를 읽을 수 있어야 한다.
4. Claim 승인·beneficiary 서명·relay 비용/nonce/시뮬레이션을 확인해 허용 예산 안에서 한 번 제출한다.
   동일 operationId와 저장된 요청·서명·거래를 보존한다.
5. 원래 거래의 receipt·sender·target·calldata·이벤트·저장 Claim을 대조해 접수를 확인한다.
6. 실제 최종 보고서·quorum·출력/report/file commitment를 검증한다.
   접수 CONFIRMED를 VALID 또는 reportVerified와 혼동하지 않는다.
7. 승인된 실패 주입 범위에서 응답 유실/중단/재시작을 시험한다.
   UNKNOWN이면 새 ID·새 서명·재전송으로 대체하지 말고 원래 거래/생성을 먼저 확인한다.

## 남겨야 할 인수 증거

- SDK commit, Node/OS/arch, dependency lockfile hash, 실행 시각과 승인 계약의 참조
- deploymentId·승인 release·실측 블록/hash, methodologyHash·승인 Evidence 버전
- operationId/claimId·object 위치/hash·원래 create/relay/report 거래 hash
- 단계별 실제 관찰, raw bytes 비교 결과, receipt/Claim/report 검증 결과와 부작용 호출 수
- 실패 주입 지점, 동일 작업 재개 결과, 미실행 항목과 정리된 오류 code

개인키·토큰·appSecret·private Evidence 본문·전체 서명 snapshot·민감한 provider 응답을 인수 보고서에 넣지 않는다.
보고서의 식별자도 요청/관찰 사실과 실제 체인 존재 증거를 구분한다.

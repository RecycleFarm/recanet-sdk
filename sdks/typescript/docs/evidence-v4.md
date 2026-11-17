# Evidence v4 / PET 방법론 v3

계약 근거는 [상위 개발 Page](https://chatgpt.com/space/page_6aeadd6e8810819197fd76ba1f3b3923)의
2026-11-05 댓글이다. 댓글 thread ID는 `16e15dee-c609-5513-9724-32b25c0d4ec2`,
message ID는 `00907233-00fd-52c9-801c-c08a4befe633`이다.
2026-11-09 다시 조회했으며 상위 1개 댓글과 직접 연결된 하위 28개 Page의 댓글(모두 없음)을 확인했다.
본문의 2026-11-04 미결 표시는 이 후속 기록을 포함하지 않았다.

## 확정된 범위

- Evidence.schemaVersion=4, partnerId=101, activityId=1003, methodology={id:2003,version:3}.
- 본문 7키: schemaVersion,sourceEventId,partnerId,activityId,methodology,source:{ownerHash},inputs:{petBottleCount}.
- bodyHash는 provenance 객체 전체를 제외한 본문의 canonical UTF-8 Keccak-256.
- sourceSignature는 `DMRVN v4 source:` + 소문자 0x bodyHash 문자열에 대한 EIP-191 signMessage.
- 저장 bytes와 evidenceHash는 provenance/signature를 포함한 전체 Evidence의 동일 canonical UTF-8과 Keccak-256.
- 중첩 객체 키는 정렬하고 배열 순서는 보존한다. SDK와 DMRVN의 bytes는 같아야 한다.

## 사용 경로

`DeclaredMethodology.petV3(manifestBytes, wasmBytes, expectedMethodologyHash, registry)`로 명시적으로 선택한다.
이 factory는 manifest/WASM/hash를 기존 방식으로 검증하고 activityId=1003·방법론2003/3을 요구한다.
Evidence 버전을 4로 지정하며, 생성/검증 시 partner101·정확한 petBottleCount 입력 키와 수치 metadata를 검사한다.
client/preflight도 초기화 시 프로필의 파트너와 config.partnerId 일치를 확인해 회원 지갑 생성 전에 잘못된 설정을 거부한다.
일반 생성자의 과거 버전 및 다른 방법론 경로를 전역 변경하지 않는다.

승인된 PET v3 manifest/WASM/hash는 호출자가 공급해야 한다. 기존 PET_HASH와 과거 PET fixture는 v3 승인값으로 사용하지 않는다.
registry callback의 활성 결과도 실제 승인 registry에 연결해야 하며, factory 성공은 운영 채택 증명이 아니다.

## 아직 정하지 않은 범위

- petBottleCount 자료형·정수 여부·0/음수/상한·소수/단위 규칙. 현재는 JSON 호환 값인지와 키 구조만 검사한다.
- 제어 문자 escape·특수 수치의 정확한 cross-runtime bytes: 댓글은 일치를 요구하지만 Java 호환 규칙과 표준 JCS 중 하나를 지정하지 않았다.
  현재 Java 호환 canonicalizer를 유지하며 D-17·30을 해결한 것으로 표시하지 않는다.
- 승인된 PET v3 manifest/WASM/hash·registry 원천·validator 공통 golden bytes/hash 및 정상/거부 벡터.
- 실제 Greenfield/Privy/DMRVN 수용은 C-12 보류를 유지한다.

## 시험 자료

`tests/fixtures/evidence-v4-pet-v3.json`은 고정 공개 시험키와 수작업 정렬 JSON에서 만든 로컬 합성 벡터다.
SDK canonicalizer로 기대 바이트를 생성하지 않았지만 해시/서명은 ethers를 사용했으므로 완전 독립 암호 구현의 증거는 아니다.
빈 WASM과 합성 manifest는 운영 PET 패키지가 아니다. 역사 fixture를 덮어쓰지 않고 별도 보관한다.

`tests/evidence-v4-workflow.test.mjs`는 새 프로필로 고정 전체 bytes의 저장/재읽기, 직접 납부와 대납 calldata/Claim/receipt 결속,
고수준 회원 제출, 파일 journal을 다시 연 생성 응답 유실 복구를 검증한다.
외부 저장소·RPC·회원 지갑은 합성 adapter다. 직접/대납 거래 확인 자료도 합성이며 실제 전송 인수 결과가 아니다.

`tests/evidence-v4-reader.test.mjs`는 독립 reader의 새 Evidence 출처/본문 변조 검사, journal 관찰과 접수 확인의 분리,
새 Evidence hash·방법론3을 담아 다시 서명한 합성 INVALID 보고서의 quorum/Claim 결속을 확인한다.
보고서가 검증돼도 실제 PET 계산·검증자 판정·metadata 독립 인증의 증거로 사용하지 않는다.

## 구현과 검증 상태

프로필·본문/서명/전체 hash·잘못된 설정의 사전 거부·저장/직접 납부/대납/고수준/영속 복구·독립 reader의 로컬 반영은 완료했다.
기존 Java 호환 생성자와 과거 fixture는 유지했다. 미결 값 규칙이나 실제 배포용 패키지를 새 기본값으로 발명하지 않았다.
최종 전체 시험은 본체267+worker14=281개이며 macOS ARM64/Node25.5에서 실패0·skip0이다.
실제 tarball의 PET factory 실행·strict Node 타입·ESM/native와 모든 동봉 문서 링크 검사도 통과했다.
Node22/Linux의 과거263개 기록을 이번 추가 시험의 실행 증거로 사용하지 않는다.

# Linux 검증 기록

2026-11-09에 SDK source commit 4aedbfa의 별도 사본을 Linux ARM64에서 검증했다.
원본 작업 트리의 macOS 바이너리를 재사용하지 않고 Linux에서 native 잠금을 직접 컴파일했다.

| 항목 | 실행값 |
| --- | --- |
| 이미지 | node:22-bookworm |
| 고정 index digest | sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f |
| Node / npm | 22.23.4 / 10.9.9 |
| Java | OpenJDK 17.0.21+9-1-deb12u1 |
| OS/arch | Debian bookworm container, Linux kernel 6.8.0-117-generic, arm64 |
| 전체 시험 | SDK 249 + worker 14 = 263 pass, fail 0, skip 0 |
| native/복구 | 실제 Java FileChannel 상호 배제·worker·다중 프로세스·SIGKILL·영속 파일 재개 통과 |
| 패키지 | 실제 tarball 설치·Node 전용 strict 타입·ESM/ABI·native journal 재개 통과 |

동일 환경의 재현 Dockerfile 빌드도 통과했다.
검증 이미지 ID는 sha256:b15f510d0be0aa337e8f24e88b620f2acb7d204d798fa6e8ce736084da3b51b8다.
이미지 ID는 기록이며, 이후 source/apt 패키지에 따라 빌드 결과가 달라질 수 있다.
고정한 것은 Node base index이며 Debian apt 저장소 전체를 snapshot으로 고정한 것은 아니다.

재현:

    docker build -f tools/ci/Dockerfile -t recanet-sdk-linux-verification .

Dockerfile은 JDK17과 고정 npm 의존성을 설치한 뒤 npm run check와 npm run check:package를 실행한다.
빌드에는 npm/Debian registry 접근이 필요하지만 Privy·Greenfield·EVM 서비스 자격 증명이나 실제 거래를 사용하지 않는다.
.dockerignore는 소스·시험·빌드 스크립트만 허용하며 .git, node_modules, dist, .env 파일을 제외한다.

최초 수동 소비자 검증은 새 npm ci 캐시로 오프라인 모드를 요청해 ENOTCACHED로 실패했다.
npm ci의 tarball 캐시만으로는 설치할 registry metadata까지 보장되지 않는다.
정상 온라인 설치 모드로 재실행해 통과했으며, 재현 Dockerfile도 온라인 기본 모드를 사용한다.
오프라인 옵션은 metadata까지 준비된 캐시에 한해 사용하고 자동 온라인 fallback은 하지 않는다.

호스트에서는 검증 전용 Colima 프로필을 생성하고 별도 Git 사본 한 경로만 마운트했다.
기본 Docker context는 colima로 유지했고 SSH config/agent를 공유하지 않았다.
검증 뒤 전용 프로필·컨테이너 데이터·작업 사본을 삭제했고 기본 context 유지와 전용 context 제거를 확인했다.
이 검증은 Linux ARM64 실행 증거이며 x64·Windows·NFS/분산 저장·전원 차단 인수를 뜻하지 않는다.
C-12 실제 provider·배포·권한·계약 수용은 별도의 승인 환경과 실행이 필요하다.

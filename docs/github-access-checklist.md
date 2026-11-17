# Phase 1 GitHub 접근 설정 안내

확인일: 2026-11-17 KST. Phase 1 조사 재개에 필요한 읽기 권한과 향후 운영 설정을 구분한다. 이번 조사에서는 인증·요금제·저장소·패키지 설정을 직접 변경하지 않았다.

현재 인증 계정은 `raddaslul`이다. RecycleFarm에서는 일반 member이며 두 기존 저장소의 admin 권한이 있다. 따라서 저장소 Read나 Admin을 새로 부여할 필요는 없다. 사용자 승인 후 현재 CLI 인증에 read:packages가 추가됐고 Maven/npm 목록 API가 각각HTTP200으로 성공했다. 기존의 read:packages 부족403은 해소됐다.

## 1. 완료한 설정: 기존 CLI에 패키지 읽기 범위 추가

아래 범위 추가와 브라우저 승인은 이미 완료했고 적용까지 재확인했다. 같은 명령을 다시 실행할 필요는 없다. 이후 재인증 때 참고할 절차만 남긴다.

```sh
gh auth refresh --hostname github.com --scopes read:packages
```

이 명령은 기존 로그인에 범위를 추가한다. 이번 목표는 패키지 목록·버전·연결 저장소의 읽기 조사이며 `write:packages`, `delete:packages`, `admin:org`를 추가할 필요는 없다. 토큰 문자열을 채팅에 보내거나 문서에 붙일 필요도 없다.

GitHub의 조직 패키지 목록 REST API는 read:packages를 가진 OAuth app token과 classic PAT를 지원한다고 명시한다. 현재 CLI가 OAuth 로그인이라서 우선 이 경로를 제시한다. 이 사실을 Registry 자체의 설치/발행 인증까지 OAuth 토큰으로 가능하다는 의미로 확대하지 않는다. 실제 Maven/npm 설치 인증은 별도 검증 대상이며 일반 외부 인증으로 classic PAT를 사용한다. [조직 패키지 목록 API](https://docs.github.com/en/rest/packages/packages#list-packages-for-an-organization), [CLI 범위 갱신 안내](https://cli.github.com/manual/gh_auth_refresh), [Registry 인증 안내](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages).

승인 후에는 다음 읽기 명령으로 확인할 수 있다. 토큰 원문을 출력하는 명령은 사용하지 않는다.

```sh
gh auth status --hostname github.com
gh api --paginate '/orgs/RecycleFarm/packages?package_type=maven&per_page=100' --jq '.[] | {name, visibility, repository: .repository.full_name}'
gh api --paginate '/orgs/RecycleFarm/packages?package_type=npm&per_page=100' --jq '.[] | {name, visibility, repository: .repository.full_name}'
```

승인 후 재확인 결과, 현재 계정의 Maven/npm 조직 목록과 두 SDK 저장소 연결 패키지는 모두0개였다. 개별 설정을 추가 조사할 기존 패키지는 발견되지 않았다. 이 설정은 Monorepo 생성이나 배포 승인이 아니다.

### 읽기 범위를 추가해도 실패하거나 일부 패키지만 보이는 경우

1. 현재 활성 계정이 여전히 raddaslul인지와 scope 적용 여부를 확인한다.
2. 기존 패키지 관리자가 raddaslul의 해당 패키지 Read 권한을 확인한다. 저장소 상속 Maven은 연결 저장소 Read, granular npm은 상속 설정 또는 패키지별 사용자/팀 권한을 확인한다. 이미 접근 가능한 두 저장소를 넘어 다른 연결 저장소가 있을 수 있다.
3. 조직이 OAuth 앱 접근을 제한한다면 조직 소유자가 GitHub CLI의 조직 접근 승인 여부를 확인한다. 실제 적용 여부는 아직 확인되지 않았다.
4. classic PAT로 대체할 경우 개인 Settings → Developer settings → Personal access tokens → Tokens (classic)에서 만료일과 read:packages를 지정한다. 비공개 Maven 메타데이터 REST 조회에는 repository-scoped 특성 때문에 repo scope도 필요하다. classic repo scope는 읽기 전용으로 세분화되지 않으므로 현재 CLI OAuth 읽기 범위 추가를 우선한다. [REST 인증 범위](https://docs.github.com/en/rest/packages/packages#about-github-packages).
5. classic PAT를 쓰는데 조직 정책이 이를 차단하면 조직 소유자가 허용 정책을 검토한다. SAML SSO가 적용된 조직이라면 토큰의 Configure SSO로 해당 조직 승인이 필요하다. RecycleFarm에 그 정책이나 SSO가 적용됐다고 확인한 것은 아니다. [PAT 정책](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [SSO 승인](https://docs.github.com/en/enterprise-cloud%40latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on).

패키지 목록은 호출자가 읽을 수 있는 항목만 반환한다. 목록이 비어도 조직 전체 패키지가 전혀 없다고 확정하지 않는다. npm의 상세 상속/Actions access 설정을 읽으려면 해당 package 관리자에게 설정 열람을 요청할 수 있으며, 모든 조사에 조직 Owner 권한을 부여할 필요는 없다.

## 2. 브랜치 보호의 403: 토큰보다 조직 요금제 문제

두 main 조회는 protected=false였고, protection/rulesets 상세 API는 요금제 업그레이드 안내와403을 반환했다. 현재 계정은 두 저장소 admin이고 조직은 Free다. 비공개 조직 저장소 보호 기능의 가용 요금제와 일치하는 응답이다. [보호 브랜치](https://docs.github.com/en/rest/branches/branch-protection), [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).

Phase 1 보고를 마치기 위해 지금 결제하거나 규칙을 생성할 필요는 없다. 현재 제약을 확인한 상태로 설계에 반영한다. 향후 비공개 조직 저장소에 필수 CI/리뷰를 강제하려면 조직 소유자 또는 billing manager가 **RecycleFarm 조직의 Team/Enterprise 요금제**를 검토해야 한다. 개인 계정을 Pro로 바꿔도 이 조직의 요금제는 바뀌지 않는다.

GitHub UI에서는 RecycleFarm → Settings → Billing and licensing → Licensing의 Current plan/Upgrade to Team에서 조직 요금제를 확인할 수 있다. 실제 변경은 유료이며 이번 작업에 포함하지 않는다. [조직 요금제 안내](https://docs.github.com/en/enterprise-cloud%40latest/billing/how-tos/manage-plan-and-licenses/upgrade-plan).

요금제와 Phase 2 이후 구현이 승인되면 main 대상 PR/리뷰·상태 검사, force push/삭제 제한, 우회 권한을 설계한다. 현재 Actions가 없으므로 아직 존재하지 않는 검사명을 임의로 필수 지정하지 않는다. 파트너용 저장소를 유료 플랜으로 운영하면 외부 협업자 계정 수에 따른 라이선스 비용도 함께 검토한다.

## 3. 지금 설정할 필요가 없는 항목

- 새 recanet-sdk/distribution 저장소나 CI Secrets, GitHub App, publish token을 만들지 않는다.
- 파트너를 개발 저장소에 초대하거나 package Write/Admin을 부여하지 않는다.
- 실환경 Privy/Greenfield/RPC 자격 증명을 제공할 필요가 없다. 실제 쓰기 검증은 별도 후속 범위다.
- Linux/Windows 검증은 토큰 문제가 아니다. 해당 실행 환경이 있어야 하며 이번 머신에는 컨테이너/가상머신 도구가 없다. 현재 Phase 1을 위해 기존 저장소 Actions를 새로 구성하지 않는다.

현재 필요한 추가 사용자 권한 설정은 없다. read:packages 추가와 API 접근 재확인은 완료됐다. 보호 기능 요금제 전환과 Registry 발행 설정은 후속 단계 결정으로 남긴다.

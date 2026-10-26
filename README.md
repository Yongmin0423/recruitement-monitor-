# 채용 레이더

개인용 채용공고 모니터의 초기 구현입니다. Next.js 16 화면과 Cloudflare Worker 수집기로 구성됩니다. 현재 **사람인 한 곳**의 목록 카드 수집과 검색 조건 저장, 읽음·저장·숨김 처리를 구현했습니다. 잡코리아·리멤버·원티드·링크드인 수집기, 새 공고 푸시 알림, 실제 배포는 아직 진행 전입니다.

## 구성

- `apps/web`: Next.js 화면과 비밀번호 로그인. Vercel에 올릴 수 있습니다.
- `apps/collector`: Cloudflare Worker, Browser Run, D1, Cron.
- `docs/plan.md`: 전체 기획과 비용 가정.
- `docs/feasibility.md`: 다섯 사이트의 수집 가능성 시험 기록.

## 지금 확인 가능한 것

- 사람인 공개 검색 결과에서 공고 ID, 제목, 회사, 지역 등 목록 카드 데이터 파싱
- 검색어·지역·제외 키워드 조건, 등록일 최신순 검색
- 첫 수집은 최근 30일 등록 공고를 페이지별로 채워 기준 데이터로 저장하고, 이후 처음 보인 공고를 새 공고로 구분
- 평일 08:00, 09:00~17:00 매시간, 19:00·21:00 / 주말 10:00·16:00·22:00 (한국 시간)
- 초기 30일 수집은 3페이지씩 이어서 처리하고 등록일 경계까지 진행; 이후 매번 기존 공고와 겹치는 지점까지 최대 3페이지
- 최근 31일 Browser Run 추정 사용량이 8시간에 도달하면 자동 중단
- 화면에 들어올 때 마지막 성공 수집이 30분 이상 지난 조건만 백그라운드 확인
- 수동 최신 확인은 같은 조건을 5분 이내에 다시 실행하지 않음; 같은 조건의 동시 실행도 잠금으로 방지
- 목록에 최초 등록일이 있는 공고만 포함; 수정일만 보이는 카드는 날짜 확인이 불가능해 제외
- 목록에 표시된 마감일이 지난 공고는 제외하고, 마감일이 없는 채용시·상시채용 공고는 사이트 검색 상태에 의존

## 로컬 실행

Node.js 22 이상이 필요합니다. 먼저 프로젝트 폴더에서 한 번만 설치합니다.

```powershell
npm --prefix apps/collector install
npm --prefix apps/web install
npm run setup:local
```

마지막 명령은 개인용 로그인 비밀번호를 입력받아 `apps/web/.env.local`과 `apps/collector/.dev.vars`를 만듭니다. 두 파일은 Git에서 제외됩니다. 비밀번호는 해시로 저장합니다. 이미 만들어진 설정을 유지하려면 `setup:local`을 다시 실행하지 않아도 됩니다.

터미널 두 개에서 각각 실행합니다.

```powershell
# 터미널 1: 로컬 D1 마이그레이션 후 수집기 실행
npm run dev:collector

# 터미널 2: Next.js 화면 실행
npm run dev:web
```

`http://localhost:3000`에서 로그인합니다. 화면은 `http://localhost:8787`의 로컬 수집기에 연결됩니다. 3000번 포트를 다른 앱이 사용 중이면 `npm --prefix apps/web run dev -- -p 3002`로 실행하고 `http://localhost:3002`를 엽니다. **두 서버가 모두 실행 중이어야** 검색 조건·공고·상태 API가 응답합니다. 로컬 수집기는 Browser Run `quickAction`이 제공되지 않을 때 사람인 공개 검색 HTML을 직접 읽습니다. 로컬 D1 데이터는 `apps/collector/.wrangler`에 보존되며, Cloudflare 계정 로그인이나 원격 D1 생성 없이 로컬 화면을 확인할 수 있습니다. 로컬 수집에 Browser Run 사용 요금은 발생하지 않습니다.
## 배포 전 체크

1. 사람인 자동 수집 정책과 요청 빈도를 확인합니다.
2. D1 ID와 Worker 비밀값 `APP_API_TOKEN`을 설정합니다.
3. D1 원격 마이그레이션을 적용하고 Worker를 배포합니다.
4. Vercel 프로젝트 루트를 `apps/web`으로 설정합니다.
5. Vercel 환경 변수에 `PERSONAL_PASSWORD_HASH`, `SESSION_SECRET`, `COLLECTOR_URL`, `COLLECTOR_API_TOKEN`을 넣습니다. 수집기 토큰 값은 Worker의 `APP_API_TOKEN`과 같아야 합니다.
6. 테스트 검색 조건 1개로 수동 수집을 확인한 후 Cron 활성화와 사용량을 확인합니다.

현재 수집기는 30분마다 Cron이 호출되어도 위 시간표에서만 실제 검색을 수행합니다. 새 공고 알림은 아직 구현하지 않았으므로 웹 화면 새로고침으로 확인합니다.

## 점검

```powershell
npm test
npm run typecheck
npm run build
npm --prefix apps/collector run deploy:dry-run
```

## 비용 메모

Cloudflare Workers Paid 월 기본요금은 별도입니다. Browser Run 사용량은 페이지마다 걸린 브라우저 시간으로 정해지며, 이 코드의 표시값은 응답 헤더 또는 경과 시간에 따른 추정치입니다. 실제 청구 금액은 Cloudflare 대시보드에서 확인해야 합니다. 초기 30일 백필은 검색 조건당 여러 페이지를 한 번 더 읽습니다(현재 프론트엔드 예시 34페이지). 로컬 직접 HTML 수집은 Browser Run 시간을 사용하지 않습니다. 계획의 계산 근거는 `docs/plan.md`를 참고하세요.

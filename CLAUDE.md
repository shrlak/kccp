# KCCP — project memory

> **이 저장소는 `kccp-attendance`와 `ppt`를 합친 것이다.** 두 저장소의 git
> 히스토리가 모두 들어 있다 (`ppt`는 `vendor/ppt/` 서브트리). 아래 출석 관련
> 규칙은 전부 그대로 유효하고, 합치면서 생긴 규칙이 먼저 온다.

## 합치기 — 자격이 영역을 준다

앱은 이제 영역 둘을 담는다: **출석**(지금까지의 관리자 패널)과 **슬라이드**
(ppt에서 들어온 예배 슬라이드). 무엇을 볼 수 있는지는 역할이 아니라 **자격**이
정하고, 규칙은 두 문장이다:

> **비밀번호는 언제나 출석뿐이다. 슬라이드는 구글 계정으로만 열린다.**

주일 화면에 나가는 일과 AI 무료 한도를 쓰는 일은, 회수할 수 있고 로그인 기록이
남는 자격 뒤에 있어야 하기 때문이다. 공용 비밀번호는 바꾸는 순간 그걸 쓰던
모두가 막히지만, 계정은 한 사람만 끊을 수 있다.

- `Area = 'attend' | 'slides' | 'praise'`, `Role.areas: Area[]` (`auth.ts`).
- `PASSWORD_GRANTS`의 셋(`kccpadmin`/`kccpwelcome`/`kccpadults`)은 전부
  `areas: ['attend']`. **슬라이드를 여는 비밀번호는 만들지 않는다.**
- `MEDIA_ACCOUNTS` — 부서 미디어팀의 **역할 계정**. 기본값은
  `kccpmedia@gmail.com`(장년부) · `kccp.bitjulove.media@gmail.com`(대학·청년부),
  `KCCP_MEDIA_ACCOUNTS` 환경 변수로 덮어쓴다. **members 행이 없고, 있어서도
  안 된다** — 만드는 순간 그 이름이 출석부와 키오스크 명단에 나타난다.
  (미디어팀을 `team_members.role`에 두면 안 되는 것과 같은 이유다: 역할이
  데이터 모델을 잘못 고르면 그 오류는 화면에서 *없어야 할 이름*으로 드러난다.)
- `OWNER_EMAIL` — `KCCP_OWNER_EMAIL`, 기본값 `spencerkim1235@gmail.com`.
  **소유자는 신원을 대체하지 않고 영역만 넓힌다.** 처음에는 members 조회보다
  먼저 가로채게 짰다가 기존 테스트가 깨졌고, 이유가 옳았다: 그 이메일은 이미
  `CROSS_PARTITION_EMAILS`의 기본값이고 실제 members 행을 가진 사람이다.
  가로채면 `memberId`가 사라지는데, 로그인 기록의 이름도 로그인 기록 열람
  권한(`LOGIN_LOG_VIEWER_MEMBER_ID`)도 그 UUID에 걸려 있다. 그래서
  `resolveMemberLogin()`을 갈라내고 소유자는 그 결과를 **감싼다.**

### 막는 것은 화면이 아니라 서버다

탭을 숨기는 것은 UI일 뿐이다. 비밀번호도 구글 토큰도 bearer 자격이라, 서버가
막지 않으면 `curl` 한 번에 뚫린다.

- `resolveAdmin()`이 라우트마다 영역을 요구한다. **굳은 라우트가 전부 이 함수를
  지나므로 호출부는 한 줄도 고치지 않았다.**
- `areaOf(path)`의 기본값은 `'attend'`다. 규칙을 빠뜨린 새 라우트는 *더 좁은*
  쪽으로 떨어져 슬라이드 계정이 거부된다 — **열리는 것이 아니라 막히는 쪽으로
  실패한다.** 새 영역을 더할 때 `ROUTE_AREA`에 접두사를 넣는 것을 잊지 마라.
- `resolveIdentity()`는 영역 검사를 **하지 않는** 짝이다. 오직
  `/api/admin/verify`가 쓴다 — 그 경로가 `/api/admin/` 아래라 검사를 걸면
  슬라이드 계정은 로그인조차 못 한다. 다른 데서 쓰면 그 라우트는 뚫린 것이다.

### 화면 쪽

- `/` = **관리자 로그인**(`AdminShell`). 옛 공개 체크인 화면은 `/checkin`으로
  내려왔고 지우지 않았다. `/admin`도 같은 화면으로 그대로 산다.
- `AdminShell`이 영역으로 갈라진다. 영역이 하나면 묻지 않고 곧장, 둘 이상이면
  `AreaChoice` 한 번. **영역 판정이 부(部) 고르기보다 먼저** 온다 — 부 고르기는
  출석 영역 *안의* 물음이라 슬라이드로 가는 사람에게는 뜻이 없다.
- `web/src/lib/api.ts`의 `AdminRole`은 `auth.ts`의 것을 **미러**한다
  (`partition.ts`가 부 모델을 미러하는 것과 같은 규칙). 어긋나면 화면이 서버가
  실제로 내려주는 역할을 모르는 채 분기한다.
- `areasOf()`는 `areas` 없는 응답(옛 엣지 함수)을 `['attend']`로 읽는다.

### 폴더

`web/src/features/` → **`web/src/areas/`**. 합쳐진 앱은 출석 앱이 아니라 영역을
가진 앱이라, 폴더가 출석 모양이면 그 모양대로 자란다.

    areas/attend/   admin · checkin · dongsan · kiosk · share  (옛 features/)
    areas/slides/   lib/pptx · lib/utils · lib/additionalFiles · bible · __fixtures__
    areas/AreaChoice.tsx

### 슬라이드 라이브러리 — 옮긴 것과 남은 것

`vendor/ppt/src/lib`에서 **백엔드를 모르는 것들**만 `git mv`로 건너왔다:
`lib/pptx/`(1,942줄) · `lib/utils/`(1,416줄) · `lib/additionalFiles/`(154줄) ·
`bible/`(635줄). 테스트와 픽스처도 함께 왔고, 이 저장소 관행대로 **소스 옆에**
붙였다 (`__fixtures__/`는 슬라이드 영역 뿌리에 한 벌).

**이동 커밋에서는 내용을 고치지 않는다.** 이동과 수정을 한 커밋에 담으면 rename
감지가 실패하고, 그 순간 `git blame`이 끊겨 두 저장소의 히스토리를 애써 합쳐 온
것이 반쯤 무의미해진다. 재배선은 그 다음 커밋에서.

옮기면서 드러난 것: 순수한 줄 알았던 셋이 Worker 라이브러리를 물고 있었다.
`normalizeTitle`(→ `lib/utils/titles.ts`)과 `inspectDeckBytes`(→
`lib/pptx/deckInspect.ts`) — 둘 다 순수 함수인데 Worker 옆에 살고 있었을 뿐이라
새 집을 주었다. `storage/`는 Supabase Storage로 다시 지어질 것이므로 거기가
최종 집이다. **`npx tsc -b --noEmit`이 이 종류의 오류를 잡는 자리다.**

아직 `vendor/ppt/`에 남은 것: `lib/storage/`·`lib/learning/`(Worker에 묶여
있어 옮기는 게 아니라 **다시 짜야** 한다), `lib/ai/`·`lib/lyrics/`의 Worker
의존 부분, `components/`(4,890줄 — 마법사), 그리고 **성경 본문 27 MB**
(`public/bible-text/`). `vendor/ppt/worker/`는 옮기지 않는다. Supabase 엣지
함수(`ai-proxy`)로 다시 짓는다.

### 슬라이드 정적 자산

`web/public/slides/` — pptx 템플릿 넷(7.3 MB). **`back-slides.pptx`는 저장소에
없다**: `web/assets/pptx/back-slides/*.b64`로 쪼개져 있고
`scripts/assemble-pptx-assets.mjs`가 sha256을 대조해 복원한다. `package.json`의
`predev`/`prebuild`/`pretest`에 걸려 있으니 **테스트 전에도 돌아야 한다** —
없으면 pptx 병합 테스트가 ENOENT로 죽는다.

pdf.js는 CID 글꼴(스캔한 콘티의 Adobe-Korea1) 때문에 `cmaps/`가, base-14 대체
글꼴 때문에 `standard_fonts/`가 필요하다. `vite-plugin-static-copy`로 복사하는데
**`rename: { stripBase: true }`가 없으면** 이 플러그인(v4)이 매치된 경로를 dest
아래에 그대로 재현해서 `dist/cmaps/node_modules/pdfjs-dist/cmaps/`로 들어간다 —
빌드는 초록으로 끝나고 런타임에만 404가 난다.

**이 자산들은 전부 선캐시에서 뺐다** (`globIgnores`에 `slides/**` ·
`bible-text/**` · `cmaps/**` · `standard_fonts/**` · `pdf.worker*`). 들어가면
그 무게를 배포마다 사용자 폰이 받는다 — 출석만 쓰는 사람까지. `sw.ts`가 첫
사용에 런타임 캐시(`kccp-slide-assets-v1`, CacheFirst)에 담는다.

### `ai-proxy` — 슬라이드의 AI 프록시

`supabase/functions/ai-proxy/`. Worker가 존재한 이유의 절반이었다: 정적 사이트에는
백엔드가 없어 Gemini·OpenRouter 키를 숨길 곳이 없었다.

    POST /api/slides/ai/gemini/:model   → Gemini generateContent (키는 함수 시크릿)
    POST /api/slides/ai/openrouter      → OpenRouter (카탈로그에 있는 모델만)
    GET  /api/slides/ai/usage           → 오늘의 무료 한도 사용량
    GET/POST /api/slides/ai/settings    → 공유 모델 풀·제외 곡 목록 (쓰기는 최고관리자·소유자)

**여기서 버그가 아니라 기능이 하나 생겼다.** 지금까지는 배포된 ppt 앱을 연 누구나
교회의 AI 무료 한도를 쓸 수 있었다. 이제 `areas`에 `'slides'`를 가진 계정만 쓴다 —
경로가 `/api/slides/` 아래라 `areaOf()`가 그렇게 판정하고, 그 판정을 위해 코드를
한 줄도 더 쓰지 않았다. `ai-proxy/routes.test.ts`가 그 접두사를 붙잡는다: 경로가
한 칸만 벗어나면 `'attend'`로 떨어지고, **이 함수에서는 그것이 열리는 실패다.**

- **별개의 함수인 이유**: 상류 모델을 기다리는 요청이 `/api/roster`(15초마다 모두가
  부르는 뜨거운 길)와 같은 아이솔레이트를 붙들지 않게. 자격 판정은 **같은
  `auth.ts`**를 부른다 — 규칙이 두 벌이 되면 한쪽이 뒤처지고, 뒤처진 쪽이 열려 있는
  쪽이 된다. 클라이언트도 같은 이유로 `api()`와 `apiAt()`이 한 몸이다.
- **카탈로그가 지갑의 경계다** (`catalog.ts`). OpenRouter로 나가는 모든 경로는
  `:free`로 끝나고, 카탈로그 밖의 모델은 다른 것으로 바꾸는 게 아니라 **거절한다** —
  조용히 바꾸면 아무도 요청하지 않은 모델에 공용 키를 쓰고, 정확도를 엉뚱한 모델의
  것으로 기록한다. 저장할 때도 씻으므로 오래된 화면이 유료 모델을 설정에 심을 수 없다.
- **OpenRouter 무료 엔드포인트는 입력 이미지와 출력이 공급자에 기록될 수 있다.**
  ppt의 README에 적혀 있던 경고이고, 옮겨도 그대로다 — **민감한 악보에는 쓰지
  않는다**는 규칙이 코드가 아니라 사람 쪽에 남아 있다.
- **`public.ai_usage`와 `config.slides_ai_settings`는 부(部)를 모른다.** 무료 한도는
  키 하나에 붙어 있어서 부마다 카운터를 두면 그 합이 실제 한도를 넘겨도 아무도
  모른다. adult 스키마에 짝이 없는 것이 의도다. 대가: 둘 다 대학·청년부 백업 줄기에
  실리므로, 대학·청년부를 복원하면 그날의 카운터와 공유 설정이 백업 시점으로 돌아간다.
- 세는 것은 **`record_ai_usage()` 한 번의 왕복**이다. 읽고-더하고-쓰면 동시에 들어온
  두 인식 요청이 서로의 증가를 덮어쓰고, 한도 카운터에서 그 손실은 넘긴 뒤에야 드러난다.
- **날짜 칸은 공급자마다 다른 시간대에서 센다** (Gemini는 태평양, OpenRouter는 UTC).
  서버 시간으로 한 번에 자르면 둘 중 하나는 반드시 틀린 칸에 들어가고, 그 어긋남은
  자정 언저리에만 나타난다.
- 함수 시크릿: `GEMINI_API_KEY` · `OPENROUTER_API_KEY` (선택: `GEMINI_DAILY_REQUEST_LIMIT`
  · `OPENROUTER_DAILY_REQUEST_LIMIT`). **저장소에 두지 않는다.**
- `deploy.yml`이 두 함수를 **따로** 배포한다 — 한 줄에 나열하면 어느 쪽이 막았는지
  로그에 남지 않는다.

### 파일은 Storage로 — 조각내기가 사라진 자리

Worker가 존재한 이유의 나머지 절반. ppt에서 파일은 Durable Object 안에 **1 MiB
조각으로 쪼개져** 살았고(큰 값을 넣을 수 없어서), 업로드는 조각마다 라우트를
왕복했다. 이제 버킷 셋이다 — `kccp-conti` · `kccp-sheets` · `kccp-decks`, **전부
비공개.**

- **바이트는 엣지 함수를 지나가지 않는다.** 함수는 자격을 확인하고 **서명된 URL만
  발급**하며, 파일은 브라우저와 Storage 사이에서 곧장 오간다. 조각내기가 없어진
  이유가 그것이다 (`attendance-api/slides.ts` · `areas/slides/lib/setlists.ts`).
- **서명 URL은 짧게 산다** (읽기 5분). 자격 없이도 열리는 링크라 화면·로그·카톡으로
  옮겨진다. 받아 두고 주중에 돌려 쓰라고 주는 것이 아니다.
- **객체 키는 `날짜/setlistId/이름`.** 가운데가 UUID인 것이 핵심이다 — 팀·예배
  이름으로 지으면 이름을 고치는 순간 옛 파일이 미아가 된다. 이름은
  `safeObjectName()`이 **경로가 아니라 이름으로** 만든다(마지막 조각만, 앞의 점과
  제어문자는 제거). 저장된 키도 서명 전에 `keyBelongsTo()`로 다시 확인한다.
- 함께 사라진 것: **"이 브라우저의 사본"**. ppt에는 로그인이 없어
  localStorage/IndexedDB에 두고 서버와 병합했다. 계정이 생기면 사본은 하나다.

### 콘티를 앱 안으로 — services · teams · team_services · setlists

이 합치기의 **원래 목적**이다. 지금 미디어팀은 찬양팀이 카톡으로 보낸 콘티 PDF를
다시 받아 올린다. 이 표들이 생기면 마법사의 첫 단계가 「업로드」에서 「고르기」로
바뀐다.

- **여기서는 부(部)가 스키마가 아니라 컬럼이다.** 출석에서 부의 경계는 *사람의
  경계*라 스키마로 갈랐다 — 다른 부의 명단은 한 행도 보여서는 안 된다. 여기서 부는
  *예배의 속성*이고, 1·2·3부가 한 화면에 나란히 보이는 것이 정상이다. 스키마로
  가르면 "이번 주 예배 목록"을 두 번 읽어 합쳐야 하고, **그 합치는 코드가 곧 새는
  자리**가 된다. 범위는 `partition` 컬럼 + `canTouchService()`로 좁힌다.
- **`UNIQUE (team_id, service_id, service_date)` — `service_id`를 빼면 안 된다.**
  팀·날짜만으로 잡으면 헵시바의 1부와 2부가 한 줄을 두고 서로 덮어쓴다(두 예배의
  곡이 다르다). 그리고 그 덮어쓰기는 **예배 중 화면에** 나타난다.
- **한 예배에서 슬라이드를 이끄는 팀은 최대 하나** (`team_services_one_leader`,
  부분 유니크 인덱스). 2부에는 콘티가 둘 오고(헵시바 찬양팀 · 찬양대) 그중 어느
  쪽이 슬라이드가 되는지를 `leads_ppt`가 정한다 — 기본은 헵시바. 둘이면 마법사가
  어느 콘티를 열지 모르고, 그 판단이 주일 아침으로 밀린다.
- **찬양대는 장년부에만** (`teams_choir_is_adult`). 데이터베이스가 아는 사실이라
  데이터베이스가 지킨다 — 화면에서만 막으면 다음에 시드를 넣는 사람이 조용히 어긴다.
- **매주 일요일 오후 5시 전체 삭제(cron)는 `archived_at`으로 바뀌었다.** 지운 이유가
  Durable Object 용량이었다면 Storage로 옮긴 뒤에는 그 이유가 없다. 지난 주 콘티를
  다시 찾는 일은 실제로 생기고, **지우는 것과 목록에서 안 보이는 것은 다른 일**이다.
  보관 비용이 실제로 문제가 되면 그때 `pg_cron`으로 오래된 것부터 정리한다 — 지금
  넣지 않는 이유는, 그것이 *문제가 되기 전에 데이터를 지우는 유일한 코드*가 되기
  때문이다.

### 번들 예산

합치기가 실패한다면 번들에서 실패한다. 슬라이드가 끌고 올 무게(pdfjs ~1MB, 성경
본문 번역본당 수 MB)는 출석 쪽과 자릿수가 다르다. **기준선을 옮기기 전에 재 뒀다:
precache 1063 KiB** (영역 구조 도입 후, 슬라이드 코드가 들어오기 전). 슬라이드
영역은 반드시 lazy로 유지하고, 이 숫자가 크게 움직이면 무언가 랜딩으로 샌 것이다.

---

# (이하 kccp-attendance에서 이어짐)

# KCCP Attendance — project memory

Korean church (한국중앙교회 피츠버그) attendance system, serving **two departments out of one
app**: 대학·청년부 and 장년부. The active app is a **React + Vite + TS** SPA in `web/`; the legacy
single-file `index.html` was removed at cutover (recoverable from git history). **Production is
live** at https://shrlak.github.io/kccp/ (옛 주소 `/kccp-attendance/`는 죽었다 — 아래 배포 항목).

## Stack & layout
- `web/` — React + Vite + TypeScript, Tailwind v4 (`@theme` in `web/src/index.css`), Zustand,
  TanStack Query, react-i18next (ko/en in `web/src/i18n/*.json`), React Router, Vitest + RTL.
  Fonts: Jua (display) + Gowun Dodum (body) — rounded/cute Korean.
- `supabase/functions/attendance-api/index.ts` — single Deno edge function (the API gateway,
  uses the **service-role key** → bypasses RLS). `auth.ts` has `verifyAdmin`/`scopeFilter`/
  `inScope` and owns the 부(partition) model. `web/src/lib/partition.ts` is its client mirror —
  keep the two in step, or the UI will offer 부서 the server then rejects.
- `supabase/migrations/` — schema. Prod project ref: `loovulhchmmwagtvjnhc`.

## Auth / data model (post-cutover)
- **부(部) = the partition, and the boundary is the Postgres SCHEMA.** 대학·청년부 (`'youth'`)
  lives in `public`, 장년부 (`'adult'`) in `adult` (migration `20260807`) — separate tables,
  separate sequences, separate backups. Reading `public.members` with no filter at all returns
  zero 장년부 people, because they are not in that table. Two departments, one screen, one
  edge function, one Supabase project; **two databases in every way that matters.**
  - `auth.ts` `dbOf(sb, partition)` is **the one place a 부 becomes a database handle.** In the
    request handler that shows up as `adb` (set by `auth()`), and **every authenticated route
    must use `adb.from(...)`, never `sb.from(...)`, for the six tables a department owns**:
    members · devices · attendance_log · member_roles · config · audit_log. `sb.from(...)` in a
    hardened route is a bug — it writes 장년부 data into 대학·청년부's tables.
  - Shared/global tables stay on plain `sb`: `login_log` + `ip_geo`/`gps_geo` (system-wide
    sign-in trail, readable only by the designated viewer), and the legacy `events` /
    `pending_registrations`. The legacy unauthenticated routes (`/api/export/*`,
    `/api/report/html`, `/api/backup`) read `public` and are therefore 대학·청년부-only for free.
  - `scopeFilter()`/`inScope()` still exist and still matter, but for a **different** job now:
    the 동산/셀 scoping a 리더 needs *inside* their own department, plus belt-and-braces on the
    부서. `inScopeGroup()` is the 부서-only twin for write *destinations* ("register a 새가족
    into this 부서"), which must not demand a 동산 the leader hasn't assigned yet.
  - Settings need no `_adult` suffix scheme: **each schema has its own `config` row (id=1)**
    with ordinary column names. Same for `audit_log` — each 부's admin tab reads its own table
    with no filter. The one deliberate cross-schema read is the card-scan quota
    (`cardScanUsage` sums both), because that limit belongs to a single shared API key.
- **Admin auth = a shared team password (works from ANY device)**: **셋뿐이다** — `kccpadmin` →
  `super_admin` panel, `kccpwelcome` → `welcoming` dashboard (**대학·청년부 전용**, 장년부에는
  이 역할로 들어오는 비밀번호가 없다), **`kccpadults` → the 장년부 panel** (`super_admin` inside
  the adult partition — that department runs itself end to end, so it gets settings/동산/관리자
  for its own people and nothing else). **리더 공용 비밀번호(`kccpleaders`)는 없앴다**: 리더의
  권한 범위는 자기 동산인데 공용 비밀번호는 사람을 가리키지 못해 그 범위를 짚을 수 없었고,
  그래서 그 비밀번호로 들어온 리더는 실제로는 대학·청년부 명단 전체를 보고 있었다. 리더는 구글
  로그인으로 들어온다 (members 행이 잡히므로 `scopeFilter`가 자기 동산으로 좁힌다). 지금 그 값은
  다른 틀린 비밀번호와 똑같이 거절된다. In `auth.ts` `SUPER_PASSWORD` / `WELCOMING_PASSWORD` /
  `ADULT_PASSWORD`, or env overrides; `passwordGrant()` maps password→{role, partition}. All are
  break-glass logins covering their own 부's roster; a password typed on a personal device linked
  to a roled member keeps that member's scope instead — **but only when the grant is in the same
  partition as the password**, so the 장년부 password on a 청년부 리더's phone falls back to
  break-glass rather than handing over the 청년부 scope. No email/Supabase Auth.
- `members` (UUID identity) ⟵ `devices.member_id` / `attendance_log.member_id`; roles in
  `member_roles` (super_admin / leader / pastor / welcoming). Leaders are scoped by group+동산
  (summer mode: KM leaders span 대학부+청년부 = 합동). Pastor is read-only.
- **학기 일정 = 2년치 롤링 목록** (`config.semester_schedule`, `[{year,season,start,end}]` with
  real dates): the 설정 탭 edits the 6 terms that haven't finished (2 academic years). A term that
  ends leaves that window and a fresh one is appended at the back (`rollSchedule`, run on every
  `/api/roster`); finished terms stay stored (last 12) because the archives need the dates the term
  actually ran on. `config.semester_dates` is now just the recurring MM-DD **fallback template** for
  years the list doesn't cover, re-derived from the list on save (`scheduleToDates`). Every date
  helper resolves a term through `termRange(year, season, calendar)` — web `lib/semester.ts`
  (`calendarOf`/`TermCalendar`, fed by `api.ts` `configCalendar(cfg)`), server `term.ts`.
- **여름 모드 is derived, not a toggle**: `term.ts` `isSummerTerm(오늘, config.semester_dates)` —
  on for exactly the 여름학기, off the day after. `config.summer_mode` is dead (never read/written);
  the 설정 탭 shows the state, not a switch.
- **학기 종료 롤오버** (`rolloverDongsan`, runs on the first `/api/roster` after a term ends, once
  per term via `config.dongsan_reset_term`): freezes that term's 동산 편성 into
  `config.dongsan_history` (`{term:{endedAt,subgroups,names,leaders}}`, last 12 terms), then clears
  every member's/device's 동산 + `dongsan_names` + `dongsan_leaders`. `attendance_log.subgroup` is
  left alone (it's that Sunday's record). A NULL `dongsan_reset_term` only seeds the marker — no
  retroactive wipe. The roster returns the (scoped) history so 지난 학기 출석부 keeps its 동산 blocks.
- **A finished 학기 is frozen, roster and 동산 both** (`archive.ts`). Where a term has a snapshot
  it is that term's *only* 동산 source (`archiveGroupBy` no longer falls back to `m.subgroup`) —
  someone the snapshot skips was 동산 미지정 back then, so a later reassignment can't add a block
  to a finished sheet, and re-downloading a term always yields the same workbook. Each period
  also gets its own roster (`periodRoster`): attendance inside the period or a place in that
  term's snapshot proves membership, otherwise `registration_date` — or, when that's blank, the
  member's **first check-in ever** (`firstSeenByName`) — must fall on or before the period's end.
  So a later joiner starts at the term they actually joined, and a 학년도/역년 workbook applies
  all of this per term sheet. The Full Log's 합계 is scored over the union of those rosters.
- `/api/config`는 무인증 경로(랜딩도 부른다)라 신원을 풀지 않고 두 부의 블록을 함께 내려준다
  (`{...youth, adult:{...}}`); 웹은 `useAppConfig()`에서 한 번만 고른다 — 화면 코드는 예전처럼
  `cfg?.summerMode` / `configCalendar(cfg)`를 쓰면 자기 부의 값을 보게 된다. 담긴 것은 날짜와
  색뿐이라 사람 정보가 아니다.
- **장년부는 하위 단위를 "셀"이라 부르고, 셀 이름은 고정이다.** 데이터는 같은 칸
  (`members.subgroup`)이고 이름만 다르다: 대학·청년부는 동산·동산지기·부동산지기, 장년부는
  셀·셀장·부셀장. 화면 문구는 **i18next context**가 맡는다 — `usePartitionT()`가 `t(key,
  {context: partition})`를 걸어 주므로 번역 파일에는 실제로 달라지는 키만 `_adult`로 덧붙이면
  되고(`dongsanNames_adult` …), 없는 키는 원래 문구로 되돌아간다. 번역 파일 밖에서 조립되는
  라벨(엑셀·PDF·출석부 이미지의 언어별 문자열 표)은 `lib/partition.ts` `unitTerms()`를 쓴다.
  **학기 종료 롤오버는 장년부 셀을 초기화하지 않는다** (`RESETS_SUBGROUPS_EACH_TERM`는
  `['youth']`): 스냅숏만 떠서 지난 학기 출석부를 고정하고, 이름·셀장·멤버 배정은 그대로 둔다 —
  바뀌는 것은 셀장·부셀장뿐이기 때문. 웹 쪽 짝은 `subgroupsResetEachTerm()`.
- **장년부 명단은 교회 스프레드시트에서 그대로 옮겨 왔다** (184세대 → 322명, prod
  `adult.members`). 원본이 세대 단위(한 줄에 부부, 전화 D/E·생일 G/H·세례여부 I가 남/여 자리)
  라 사람 단위로 가르기만 하고 **값은 한 글자도 다듬지 않았다** — 전화 표기, 주소 한 줄,
  '집사/권사' 같은 세례여부 문구, 이름에 붙은 `(이사)`까지 원문 그대로다. 어느 사람 것인지
  확실하지 않은 값은 넣지 않고 `notes`에 원문을 남겼고, 가른 뒤에도 되돌릴 수 있도록 그 세대의
  **원본 행 전체가 `adult.members.source_row`(jsonb, `20260809`)** 에 들어 있다. 한 세대는
  `household_id`로 묶인다. 셀 19개와 셀장·부셀장은 교회의 셀 편성표에서 왔고 `adult.config`의
  `dongsan_names`/`dongsan_leaders`에 산다 (`20260810`은 첫 설정만 장년부 것으로 바로잡고,
  이미 편성이 들어 있으면 손대지 않는다). 셀 탭의 `DongsanLeadersEditor`가 그 편집기다 —
  드롭다운은 그 셀 사람들에 **이미 지기로 적혀 있는 바깥 사람을 더한 것**(`leaderOptions`)이라,
  명단과 편성표가 어긋나도 이름이 조용히 지워지지 않는다.
- **여름 합동은 대학·청년부만의 장치**라 장년부에는 존재하지 않는다 (`summerNow(cfg,'adult')`은
  언제나 false, `scopeFilter`도 장년부는 합동으로 승격하지 않는다). 학기 종료 롤오버도 부서별로
  따로 돌며, 편성을 비울 때 자기 부 멤버/기기만 건드린다.
- **RLS is deny-all** on every table in **both** schemas (no anon/authenticated policies); the
  edge function (service-role) is the only data path. The `adult` schema is exposed to PostgREST
  (the migration appends it to `authenticator`'s `pgrst.db_schemas` — appends, never overwrites,
  or Supabase's own `graphql_public` disappears) so `.schema('adult')` can reach it at all.
- 동산지기/부동산지기 are a **display-badge** system (`config.dongsan_leaders`), distinct from the
  `leader` admin role.
- **중복 등록은 자동 병합**: `/api/admin/kiosk-new-member` · `/api/share/new-member` find an existing
  member with the same name + 부서 (and no conflicting phone/생년월일) and update it with the newer
  values instead of inserting a second row — device and attendance history carry over, 등록일자 keeps
  the earlier date so the sheet doesn't blank out past Sundays. Audited as `new-member-merge`.
- **카드 인식은 빈 칸이 있어도 등록한다 — 두 부 모두** (`features/admin/cardRegistration.ts`).
  종이는 사람이 손으로 채우는 것이라 이름이 안 읽히거나 소속 네모가 안 찍힌 카드가 늘 있는데,
  그때 `CardScanDialog`가 등록을 거절하면 그 사람은 어디에도 남지 않고 종이는 곧 사라진다 —
  빈 칸은 나중에 멤버 탭에서 언제든 채운다. 그래서 예전의 두 관문(이름 필수 · 소속 필수)을
  없애고 대신 **우리가 채운 칸을 등록 버튼 위에 적어 준다** (조용히 지어낸 값은 나중에 아무도
  못 찾는다). 채우는 규칙 둘:
  - **이름이 비면 `이름 미기재 08-17 14:23:05`** (Eastern, 초까지). 이름은 이 시스템의 신원이라
    (출석부·키오스크·시트 연동이 이름으로 사람을 찾는다) 빈 이름을 넣을 수 없고, **시각이
    붙는 이유는 유일성**이다 — 서버의 중복 병합은 이름+부서로 찾으므로 자리표가 같으면 연락처
    없는 빈 카드 두 장이 한 줄로 합쳐진다 (등록을 막지 않으려던 것이 사람을 잃는 것으로
    돌아온다). 화면 언어와 무관하게 한글 하나로 둔다 — 저장되는 것은 UI 문구가 아니다.
  - **소속이 비면 부서는 `적는 사람의 부서 → 청년부`** 순. 리더는 자기 부서 밖으로 등록할 수
    없으므로(서버 `inScopeGroup`) 늘 청년부로 떨어뜨리면 대학부 리더에게는 403이 되고, 빈 칸
    때문에 등록이 막히는 일이 그대로 남는다. 장년부 카드에는 그 물음 자체가 없다.
  서버(`name and group required`)는 그대로 둔다 — 화면이 언제나 둘을 채워 보내므로 이 길에서는
  걸리지 않고, 다른 경로가 실수로 빈 이름을 보내는 것은 계속 막아야 하기 때문.
- **멤버 삭제는 출석 기록을 지우지 않는다**: 단일 `/api/admin/member/delete`와 다중
  `/api/admin/members/delete` 모두 `members` 행만 지운다. 연결 기기·권한은 CASCADE로 없어지고,
  `attendance_log.member_id`는 `ON DELETE SET NULL`이 되지만 이름·날짜·당시 부서/동산이 담긴
  출석 행은 그대로 남는다. 다중 삭제는 요청한 전원이 관리자 범위 안일 때만 한 번에 처리한다.
- **상태 표기 = a list per member** (`members.status_marks` `[{note,start,end}]`; the old single
  `status_note/start/end` trio is still mirrored by the server and read as a one-entry fallback).
  `web/src/lib/status.ts` is the single reader: 귀국/이주 hides the member from the **출석부**
  (when the mark covers the whole shown stretch — a mid-term departure keeps its earlier O/X) and
  from the **키오스크** (along with 방학, `hiddenFromKiosk`); 방학 also drops out of the 통계
  denominator. Other notes (돌아옴 …) just grey out their dates.
- **Login history is 김호연-only**: `/api/admin/login-log` (login_log + `ip_geo` IP→place
  cache, filled from ipwho.is) is gated by `canViewLoginLog` in `auth.ts` — requires
  super_admin **and** memberId == `LOGIN_LOG_VIEWER_MEMBER_ID` (김호연's UUID, env-overridable),
  so a bare shared password never qualifies. `/api/admin/verify` returns the flag; the web
  Admins tab hides the section for everyone else. **Precise location**: the web verify call
  sends the browser's GPS via `X-Geo-Lat/Lon/Acc` (best-effort `getLoginPosition()`; prompts
  once, null if denied) → stored on login_log (`20260726` migration) → reverse-geocoded to a
  street address at read time via Nominatim, cached in `gps_geo`. Falls back to the ip_geo
  city estimate when GPS wasn't granted; the viewer shows a 정확/대략 (precise/approx) badge.
  **두 부 모두에서 보인다** — login_log는 부서를 가리지 않는 공용 표라 어느 패널에서 보든 같은
  목록이고, 아래의 부 건너가기를 해도 memberId는 그대로라 권한이 따라간다. 다만 **목록 자체는
  부를 넘지 않는다**: `/api/admin/login-log`가 `partition.eq.<내 부>` + `partition.is.null`로
  걸러서, 대학·청년부 비밀번호로 들어온 로그인은 대학·청년부 패널에서만, 장년부 비밀번호로
  들어온 것은 장년부 패널에서만 보인다 (저쪽을 보려면 부를 건너간다). 남는 두 묶음은 **부서별로
  갈라서** 보여준다 (`admins.ts` `groupLoginsByPartition`, 순서는 대학·청년부 → 장년부 →
  부 미기록으로 **고정** — 부는 닫힌 집합이라 자리가 움직이면 매번 찾게 된다). 그러려면 로그인
  마다 그때 들어간 부가 남아야 하므로 `login_log.partition` (`20260814`): 사람의 소속에서
  유도할 수 있는 값이 **아니다** — 유도하면 두 부를 오가는 사람의 장년부 로그인이 전부
  대학·청년부로 읽힌다. 같은 이유로 1시간 중복 제거 키에도 부가 들어간다. 지난 기록은
  `member_id`가 어느 스키마에 있느냐로 되살렸고, 공용 비밀번호 로그인은 **역할로** 가렸다
  (`20260815`): 비밀번호마다 주는 역할이 다르고 역할은 기록돼 있다 — `leader`(당시의
  kccpleaders, 지금은 없앤 비밀번호) · `welcoming`(kccpwelcome) · 레거시 `staff`는 대학·청년부
  에만 있던 비밀번호다. `super_admin`만
  둘(kccpadmin/kccpadults)이 겹치는데, kccpadults는 **2026-08-10 03:14 EDT(#222 배포)에 처음
  생겼으므로** 그 전 것은 kccpadmin일 수밖에 없다. 그래서 남는 진짜 미상은 그 뒤의 super_admin
  공용 로그인 몇 건뿐 → '부 미기록'. 그 NULL 줄들은 **양쪽 패널에 다 남긴다**: 한쪽에 몰면
  있지도 않은 사실을 주장하는 것이고, 한쪽에서 지우면 어디에서도 볼 수 없게 된다.
- **한 계정만 두 부를 다 본다** (`auth.ts` `CROSS_PARTITION_EMAILS`, 기본 `spencerkim1235@
  gmail.com` = 김호연, env override 가능). 보통 부는 고르는 것이 아니라 **이메일이 어느 스키마의
  members에서 나오느냐**로 정해지는데(그 길 하나뿐이다), 이 이메일만은 로그인 뒤 어느 부의
  패널로 들어갈지 **고른다** — `PartitionChoice` 화면, 그 뒤로는 헤더의 전환 버튼(건너갈 쪽의
  이름이 적혀 있다)으로 오간다. 장년부 members에 행을 하나 더 만들어 주는 방법은 쓰지 않았다:
  그러면 명단·출석부·통계·백업이 전부 교인이 아닌 사람을 한 명 세게 된다.
  - 고른 값은 `X-Partition` 헤더로 매 요청 실려 나간다. **요청이지 권한이 아니다** —
    `resolveAdmin`이 그대로 `verifyAdminJwt`에 넘기고, 거기서 `canCrossPartitions(email)`인
    로그인에만 적용된다. 비밀번호 경로는 아예 읽지 않는다 (비밀번호가 이미 부를 뜻한다).
  - 건너간 쪽에는 그 사람의 members 행이 없다. 그래서 그 부의 `super_admin`이 되되 **부서·동산은
    비우고** 간다 (저쪽 부의 자리 이름이라 여기서는 뜻이 없고, 남기면 scopeFilter가 있지도 않은
    동산으로 명단을 좁힌다). `memberId`는 그대로 들고 가고 새 필드 `Role.memberPartition`이 그
    행이 **실제로 사는** 스키마를 가리킨다 — 로그인 기록의 이름을 거기서 찾는다.
  - 웹 쪽: `lib/partition.ts`의 `ADMIN_PARTITION_KEY`/`readStoredPartition()`을 **api 계층과
    인증 스토어가 각자 읽는다** (한쪽이 다른 쪽 로드를 기다리면 첫 요청의 헤더와 첫 렌더가
    엇갈린다). 부를 바꾸면 `queryClient.clear()` + 스냅숏 폐기가 먼저다 — 화면에 남은 명단은
    전부 저쪽 부의 것이다. 로그아웃하면 선택도 지워져 다음 로그인은 다시 고르는 데서 시작한다.

## 새가족 카톡 추가 (`features/admin/contactQr.ts` · `KakaoQrDialog.tsx`)
- **카톡 아이디로 친구를 추가하는 링크는 없다.** 공개된 링크 규칙은 카카오톡 채널
  (`pf.kakao.com/_난수`)뿐이고 그건 업체 채널이지 사람이 아니며, 카톡 앱의 친구 QR은 그
  계정에서 카카오가 만들어 주는 것이라 (그래서 그 QR로 추가할 때 상대의 아이디는 보이지도
  않는다) 우리가 적어 둔 아이디로는 만들 수 없다. **아이디를 그대로 QR에 넣으면 찍어도 글자만
  나온다** — 되는 것처럼 보이는 죽은 QR이라 없는 것보다 나쁘다. 그래서 QR이 담는 것은 카톡
  링크가 아니라 **연락처(MECARD)** 다: 찍으면 연락처로 저장되고, 카카오톡이 **전화번호로** 그
  사람을 친구 목록에 올린다 — 카톡이 친구를 붙이는 진짜 열쇠도 아이디가 아니라 전화번호다
  (올해 새가족 60명 중 전화 50 · 아이디 35, 아이디만 있는 사람은 2명).
- **`kakao_id` 칸에는 아이디가 아닌 것이 자주 들어온다.** 운영 명단에 `+82 10-2744-1580`,
  `010 3220 9178`, `charles9901@naver.com`, `KSW829207 @Naver`가 실제로 있다 — 종이 카드의
  자유 기입 칸이라 사람마다 다르게 채운다. `classifyKakaoId`가 id/phone/email로 갈라서 전화는
  연락처의 번호로(전화 칸이 비어 있으면 **이 값이 유일한 연결 고리다**), 이메일은 EMAIL 칸으로
  보낸다. 아이디로 취급해 두면 아이디로 검색해도 안 나오는 값을 계속 검색하게 된다.
  `KSW829207 @Naver`는 TLD가 없어 이메일이 아니다 — 아이디로 두고 **원문 그대로** 보여준다.
- **번호가 없어 못 찍는 사람은 감추지 않는다.** QR 격자 아래 경고 블록에 이름과 아이디를
  남긴다 — 안 보이면 "이 사람은 왜 없지"가 되고 결국 명단을 다시 뒤진다.
- 아이디는 **여태 쓰기 전용이었다**: 세 곳에서 저장하는데 나오는 곳이 없어 보려면 사람마다
  편집 창을 열어야 했다. 이제 새가족 카드 타일(탭하면 복사, **고정폭** — 아이디는 사전이 없어
  `l/I/1`·`O/0`을 눈으로만 가른다), 엑셀의 '이메일/카톡아이디' 열, 목록 복사로 나온다.

## 새가족 엑셀 내보내기 (`exports.ts` `newFamilySheets` · `AdminNewFamily.tsx`)
- **교회가 실제로 쓰는 '대청 새가족 리스트' 스프레드시트를 그대로 옮긴 것이다.** 쓰임이
  "내보낸 줄을 그 시트에 이어 붙이기"라 열 하나만 어긋나도 사람이 손으로 옮겨 적게 된다:
  열 열 개(이름·등록일·성별·생년월일·전화번호·**이메일/카톡아이디**·학교/직장 학과·세례·
  목사님 심방·노트)가 그 순서 그대로 나가고, 줄은 **등록일 오름차순**(새로 온 사람이 아래,
  탭 화면의 최신순과 반대)이며, 색도 그 시트의 것이다 — 머리줄 파랑 `6FA8DC`(굵게),
  성별 칸 남 `CFE2F3` / 여 `F4CCCC`, 모든 칸 가운데 정렬. 색 값과 칠할 칸은
  `NEW_FAMILY_FILL`/`genderFill`이 정하고 `newFamilySheets(...).fills`로 나온다.
- 시트와 앱이 칸을 다르게 세는 자리가 셋: **이메일과 카톡 아이디가 한 칸**이라 종이 카드의
  그 칸을 갈라 담지 않고 적힌 그대로 옮기고(비어 있을 때만 `members.email`), **세례 칸은
  세례여부 + 신앙기간을 '; '로 잇는다**("세례; 5년 이상" — `faith_duration`이 나가는 자리는
  여기뿐이다). **주소/동네와 동산 참여 열은 없앴다** — 시트에 없고, 주소는 앱이 모은 적도 없어
  늘 빈 칸이었다. 그래서 부서마다 달라지는 칸이 사라져 머리줄에 부(部)가 들어가지 않는다.
- 부서(`group_name`)마다 시트 하나로 갈리는 것은 그대로다 — 사진 한 장으로는 그 스프레드시트의
  탭 구성을 알 수 없으므로 이미 있던 구성을 건드리지 않았다.
- QR 인코더(`qrEncode.ts` → `qrcode-generator`, 20kB)는 SheetJS·Chart.js와 같은 규칙으로
  **창을 열 때만** 지연 로드된다. 이름이 한글이라 `stringToBytes`를 UTF-8(`TextEncoder`)로
  갈아 끼운다 — **기본값은 latin1이라 한글이 통째로 깨진다**. QR은 테마와 무관하게 언제나
  **흰 바탕 검은 칸**이다 (뒤집으면 못 읽는 리더가 많다).

## 통계 탭의 새가족 블록 (`analytics.ts` 아래쪽 · `AdminAnalytics.tsx` `NewFamilySection`)
- 위쪽 통계가 전체를 세는 자리라면 그 아래부터는 **새가족만** 센다: 숫자 타일(전체 · 이번 학기
  등록 · 최근 4주 출석 · 새가족 교육 이수), 그래프 둘(월별 등록 막대 · 주일별 새가족 출석 선),
  월별 표(등록 · 출석 인원 · 비중). 입력은 위와 **같은** members + log이라 부서/동산 필터가
  그대로 걸리고, 숨긴 멤버도 그대로 빠진다.
- **여기서 새가족은 `members.is_new_member` 하나다** — 새가족 탭의 `visibleNewFamily`가 아니다.
  그쪽은 "지금 새가족팀이 챙길 사람"이라 숨김 표기가 걸린 사람과 2026년 이전 등록을 걷어내는데,
  **추이는 지나간 사실**이라 그 사람이 그 달에서 사라지면 이번 주에 지난달 숫자가 바뀐다.
- **등록일이 없는 새가족은 어느 달에도 놓을 수 없어** 그래프·월별 표에서 빠진다. 그래서 그
  인원수를 블록 머리에 적어 둔다 (`nfUndated`) — 안 적으면 타일의 총계와 그래프의 합이 어긋나
  보인다. 같은 이유로 등록이 없던 달도 0으로 채운다 (`monthsBetween`): 건너뛰면 x축이 붙어
  "그 달에도 왔다"로 읽힌다.
- 출석 줄이 새가족의 것인지는 **`memberId`가 열쇠**고(동명이인이 갈린다), 그것이 없는 옛 줄·
  손님 줄만 이름으로 되짚는다. 그날 전체 출석도 같이 세어 두는 이유는 **비중이 새가족 숫자
  만으로는 나오지 않기** 때문 — 점을 누르면 `n / 전체 (%)`가 나온다.
- **출석 추이는 새가족 교육 단계로 갈라 볼 수 있다** — 그래프 위의 칩(전체 · 수강 완료 ·
  1주차만 · 2주차만 · 미수강)이 `newFamilyTrend(members, log, edu)`에 그대로 넘어가고, 갈래와
  문구는 새가족 교육 탭의 `matchesEduFilter` · `eduFilter.*`를 **그대로 쓴다** (같은 네 갈래를
  두 화면이 다르게 부르면 "1주차만"이 어디서는 다른 뜻인가 싶어진다). 한 단계를 고르면 그 뒤에
  **새가족 전체가 흐린 점선으로 깔린다** — 미수강 3명은 새가족이 4명일 때와 40명일 때가 다른
  사실이라 고른 선만으로는 읽을 수 없다. 선이 둘일 때만 범례가 켜진다.
  - **갈래는 언제나 *지금* 상태다**: `new_member_edu_week1/2`는 날짜 없는 참/거짓이라, 지난달에
    아직 미수강이던 사람도 이번 주에 이수를 찍으면 그 달까지 '수강 완료'로 그려진다. 교육을 마친
    사람들이 요즘 어떻게 오고 있나를 보는 선이지, 그때 그 사람의 단계가 아니다.
  - 갈래 판정은 `newFamilyMatcher`를 거친 뒤에 걸리므로 **교육 칸이 비어 있는 일반 멤버가
    '미수강'으로 딸려 들어오지 않는다** (단계는 새가족 안에서만 뜻이 있다).
- 장년부에는 **새가족 교육 타일도 단계 칩도 없고**(그 부에 교육이 없다) "이번 학기"가
  "이번 반기"다 (`nfThisTerm_adult`, `usePartitionT`). 학기 경계는 통계가 정하지 않고
  `newFamily.ts` `semesterBounds`에서 받아 온다 — 부마다 한 해를 나누는 방식이 다르기 때문.

## 새가족 목록에서 사람을 내리는 열쇠 (`newFamily.ts` `visibleNewFamily`)
- **새가족 표시(`is_new_member`)를 해제하는 것 하나뿐이다.** 학기도, 새가족 교육 이수도 목록에서
  사람을 내리지 않는다 — 새가족 탭과 새가족 교육 탭이 같은 이 함수를 읽는다.
- 예전에는 "지난 학기에 등록한 사람은 교육 두 주를 다 마치면 목록에서 빠진다"였는데, 그러면
  **이수한 사람을 확인할 방법이 교육 탭에 없었다**: 마치는 순간 목록 밖으로 나가므로 '수강 완료'로
  걸러도 아무도 안 나온다. 이수 여부를 적는 탭이 이수한 사람을 못 보여주는 것이라, 그 규칙을
  없앴다. 넘어온 학기 머리줄의 '교육 미완료' 배지도 같이 없앴다 (더는 그 묶음의 사실이 아니다).
- 남은 필터는 셋이다: 새가족 표시가 있을 것 · 숨김 표기(귀국·이주·졸업 …)가 없을 것 ·
  등록일이 2026-01-01 이후일 것(옛 시트에서 옮겨온 기록은 올리지 않는다). 그래서 함수는
  오늘 날짜도 학기 일정도 받지 않는다 — `visibleNewFamily(members)` 하나다.
- `isActiveNewFamily`는 남아 있지만 이제 **출석부 엑셀의 새가족 표시**(`exports.ts`, 등록 전
  주일 칸에 붙는 메모) 전용이다. 그쪽은 "아직 새내기인가"를 묻는 자리라 이수가 답을 바꾼다.

## 동산 출석 구글 시트 연동 (`scripts/sheet-sync/`)
- **출석 한 줄에 종류가 붙는다**: `attendance_log.kind` = `worship`(주일예배, 기본값·기존 행 전부)
  또는 `dongsan`(동산/셀 모임). 동산이 쓰는 시트는 한 주일에 두 칸을 적고 그 둘은 같은 사실이
  아니다 — 동산모임엔 왔지만 예배엔 못 온 줄이 실제로 있다. **`/api/roster`가 갈라서 내려준다**:
  `log`은 예전과 똑같이 예배만, `dongsanLog`이 동산모임. 그래서 `log`을 읽는 화면(출석부·오늘·
  통계·아카이브·엑셀)은 손대지 않아도 계속 맞는다. **예배 출석을 묻는 서버 쿼리에는
  `.eq("kind","worship")`이 걸려 있다** — 새 경로를 쓸 때 빠뜨리면 동산모임이 예배로 세어진다.
  백업/복원만은 두 종류를 다 싣는다 (덤프는 완전해야 한다).
- **파싱은 서버가 한다.** 서버가 공개 CSV(`export?format=csv`)를 직접 읽어 `sheetSync.ts`로
  해석한다. 스크립트에 파서를 두면 규칙을 고칠 때마다 시트마다 다시 붙여넣어야 하고 버전이
  갈린다. **시트를 고쳐도 되지만 파서를 고칠 때 시트를 손댈 일은 없다.**
- **동기화는 서버가 스스로 당긴다** (`maybeSheetPull`/`scheduleSheetPull`, `20260819`): Apps
  Script를 붙이지 않아도 돈다. `/api/roster`(앱이 15초마다 부르는 그 길)에 얹되 **쿨다운마다
  한 번만** 실제로 읽는다 — 청구권은 자동 백업과 똑같이 조건부 UPDATE 하나
  (`config.last_sheet_sync_at`, `SHEET_PULL_COOLDOWN_MIN` 기본 10분). 응답은 기다리지 않고
  (`EdgeRuntime.waitUntil`) 읽은 결과는 다음 요청에 실려 온다. 시트가 하나도 없는 부에서는
  문장 하나도 나가지 않고, 읽다가 실패해도 청구권은 이미 잡혀 있어 쿨다운만큼 쉬었다 다시
  시도한다 (망가진 시트를 두드리지 않는다). **아무도 앱을 열지 않는 동안에는 당기지 않는다** —
  그때는 볼 사람도 없고, 다음에 누가 열면 그 자리에서 따라온다. 이 길은 GET이라 자동 백업의
  그물(비-GET)에 안 걸리므로, 실제로 뭔가 바뀐 실행만 `maybeAutoBackup`을 직접 부른다.
  `Code.gs`(Apps Script)는 **선택 사항**으로 남는다 — 편집 즉시 반영이 필요할 때만 붙이고,
  둘이 겹쳐도 같은 값을 다시 쓸 뿐이다.
- **회색 병합을 되살리는 규칙**: CSV는 병합의 왼쪽 칸에만 값을 준다 → *글자가 나오면 구간이
  열리고, 다음에 값이 나오는 칸에서 닫힌다*. 끝까지 안 닫히면 기한 없는 구간(= 명단에서 숨기는
  표기). `이주`·`한국 귀국`·`출장`·`전역` 따위는 `status_marks`로, **`새가족`으로 덮인 앞부분만은
  표기가 아니라 `registration_date`** 로 간다 (그 사람이 아직 오기 전이라는 뜻이므로).
  **빈칸은 결석이 아니다** — 아직 안 적었다는 뜻이라 앱을 건드리지 않는다.
- **C열 `예배 총 출석`이 체크섬이다.** 우리가 센 수와 다르면 우리가 잘못 읽은 것이므로 그 사람은
  반영하지 않고 경고로 올린다. 조용히 어긋난 O를 남기는 것보다 시끄럽게 멈추는 편이 낫다.
- **이름은 열쇠가 아니다.** 시트는 동명이인을 동산으로 가르고(건영동산 김서현 / 윤서동산 김서현)
  명단은 이름에 괄호를 붙여 가른다(`김서현(대학부)` / `김서현(청년부)`). `matchPerson`은
  이름+동산 → 유일한 이름 → **괄호 뗀 이름**(`baseName`) 순으로 찾고, 그래도 안 갈리면 **찍지
  않는다**. 이 단계가 없으면 이미 있는 사람을 새로 만들어 김서현이 넷이 된다 (실제 운영 명단으로
  확인한 사례다). 정말 없는 이름만 새 멤버로 등록된다.
- **시트의 동산은 명단에 옮겨 적지 않는다.** 두 곳이 같은 칸에 다른 것을 담고 있고(시트는
  `건영동산`, 명단 `subgroup`에는 `호연선규`처럼 짝지은 이름), 무엇보다 학기 종료 롤오버가
  일부러 비운 편성을 연동이 매번 도로 채우게 된다. 편성의 주인은 동산 탭. 새로 등록된 사람은
  어느 동산 줄에서 왔는지가 `notes`에 남는다.
- **연동은 자기가 만든 것만 되돌린다**: 연동이 넣은 행은 `attendance_log.source='sheet'`이고,
  O→X로 바뀌면 그 행만 지운다. 키오스크로 직접 찍은 출석(`source` 비어 있음)은 손대지 않는다.
  상태 표기도 같다 — `source:'sheet'`인 표기만 갈아 끼우고 관리자가 앱에서 적은 `방학`은 남는다.
- **연동 키가 곧 부(部)다** (`config.sheet_sync.token`, 부마다 자기 config 행). `/api/sheet/sync`는
  로그인이 아니라 `X-Sync-Token`으로 들어오고, 등록되지 않은 스프레드시트 id는 무시한다. 토큰은
  config에만 살고 `/api/config`(무인증)는 필드를 골라 내려주므로 새지 않는다.
- **붙이는 단위는 스프레드시트가 아니라 탭이다.** 교회의 시트는 **한 스프레드시트 안에서
  학기마다 · 부서마다 새 탭(페이지)** 이 나므로, 소스의 열쇠가 `(id, gid)` 두 칸인 것이 곧
  그 구조와 맞는다 — 같은 파일의 탭 여러 개가 각자 `group`과 `term`을 갖고 나란히 붙는다.
  `#gid=`가 빠진 주소는 "첫 번째 탭"을 뜻하므로, **그 스프레드시트가 이미 붙어 있는데 gid가
  비어 있으면 등록을 거절한다** — 안 그러면 이번 학기 탭인 줄 알고 지난 학기 탭을 읽는다.
  Apps Script의 두드림은 스프레드시트 id로 오므로 그 파일의 등록된 탭이 **전부** 다시 읽힌다.
- **부서는 시트 안에 없다** (동산 이름뿐). 여름 시트는 대학·청년부 합동 한 장이고 봄·가을에는
  부서마다 탭이 따로라, 소스를 등록할 때 사람이 `group`을 정해 준다 (합동이면 빈 문자열).
  지금 붙어 있는 것은 **2026 여름 동산 시트 한 장뿐**이고 (`20260816`이 시드로 넣는다, 합동),
  **가을 시트는 만들지 않았다** — 아직 그런 시트가 없어서 미리 등록하면 동기화가 매번 읽지
  못하는 주소를 두드리게 된다. 가을 링크가 나오면 설정 탭에서 부서를 골라 붙이면 된다.
- **시트에도 학기가 적힌다** (`sources[].term`, 붙인 날의 학기. `20260818`이 이미 등록된 여름
  시트를 `2026-summer`로 소급해 적어 준다 — 이 연동 자체가 그 학기 안에서만 존재했으므로).
  **시트를 붙이면 그 부서의 동산 리더 링크는 걷힌다** (`sheetCoveredGroups`): 한 부서의 동산
  출석은 시트나 링크 중 **하나**로만 들어온다. 둘로 적으면 다음 동기화에서 시트가 자기 값을 도로
  넣어 링크로 적은 것을 지우기 때문. 그래서 시트 등록이 곧 "이 부서는 이번 학기 시트가 담당한다"는
  선언이고, 떼면 다음 `/api/roster`에서 그 부서 링크가 다시 난다. **담당은 이번 학기 시트만
  한다** — 그러지 않으면 여름 시트 한 장이 가을 링크를 영영 막는다. 동기화는 학기를 보지 않고
  계속 돈다 (지난 학기 시트를 다시 읽어도 그 학기 날짜에 같은 값이 들어갈 뿐이다).

## 동산 리더 링크 (`/dongsan/:token`)
- **시트가 없는 학기에 그 부서의 동산모임 출석을 적는 자리.** 로그인이 아니라 **링크가
  신원**이고, 링크 하나가 **부서 하나 · 학기 하나**를 가리킨다 (`config.dongsan_links` =
  `[{token,group,subgroup,term,createdAt}]`, `20260817`+`20260818`; 지금 내는 링크는 `subgroup`이
  빈 문자열인 부서 링크뿐이다). 대학부 하나, 청년부 하나 — 그 부서 담당자에게 건넨다. 화면은 그 부서를
  **동산별로 묶어** 그리고, 동산이 아직 없는 사람은 '동산 미지정' 블록에 모인다 (편성 전에도
  적을 수 있어야 하므로).
- **적는 자리는 표다** — 세로가 사람, 가로가 최근 8주일이고 칸마다 O/X 드롭다운이다. 주일을
  하나씩 골라 가며 적으면 밀린 주를 채우는 데 화면을 여러 번 오가야 하고 "요즘 어떤가"가 한눈에
  안 보인다. 이름 열은 왼쪽에 고정하고 나머지를 가로로 굴린다 (관리자 출석부의 `GridView`와 같은
  방식 — 폰에서 8주가 한 화면에 안 들어간다). 열마다 **합계**를 두는데, 아직 손대지 않은 주일도
  전부 X로 보이므로 그 열의 0이 "아직 안 적었다"를 알려 주는 유일한 단서이기 때문이다.
  - **동산마다 링크를 따로 내는 길은 두지 않았다**: 적는 사람이 부서 담당자 한 명이면 링크도
    하나여야 관리가 되고, 동산이 새로 서거나 이름이 바뀔 때마다 링크를 다시 내고 다시 나눠 줄
    일이 없다. 동산별로 내던 시절의 링크가 남아 있어도 `parseLinks`가 그대로 읽고
    (`subgroup`으로 좁혀진다) 동산 탭 아래쪽 목록에서 폐기할 수 있다 — 목록에서 감추면 거둘
    방법까지 사라지기 때문.
  - **`group`이 비어 있는 링크는 만들지 않는다** — 부 전체를 여는 열쇠라 범위를 짚지 못하고,
    그런 열쇠를 없앤 것이 이 링크가 생긴 이유다 (서버가 만들 때 막고 `parseLinks`가 읽을 때 또
    버린다). 그 링크로 보이는 것은 그 부서 사람들의 이름과 그들의 **동산모임 출석**뿐이다 —
    예배 출석도, 연락처도, 다른 부서도 이 문으로 나가지 않는다. 공용 비밀번호를
    없앤 이유(범위를 짚지 못하는 열쇠)를 링크에도 똑같이 적용한 것이라, 하나가 새면 새는 것은
    그 부서 하나이고 관리자는 그것만 폐기한다 (동산 탭의 `DongsanLinksSection`).
- **적히는 것은 `kind='dongsan'` + `source='link'`.** 시트에서 온 줄(`source='sheet'`)과 같은
  칸에 앉으므로 출석부의 동산모임 위첨자가 그대로 둘 다 보여준다. 화면에서 X를 고르면
  `source`가 있는 줄(link·sheet 둘 다)을 지우고, `source`가 비어 있는 앱 출석은 건드리지
  않는다. **같은 사람을 시트와 링크로 함께 적지 않는다** — 다음 동기화에서 시트가 자기 값을
  도로 넣는다.
- **적을 수 있는 날은 서버가 정한다** (`recentSundays`, 최근 8주일). 화면이 보낸 날짜도,
  사람 id도 그대로 믿지 않고 링크의 범위 안에 있는지 표에 다시 물어본다.
- **링크는 학기를 따라 저절로 나고 진다** (`dongsanLink.ts` `reconcileTermLinks`, `20260818`).
  규칙은 한 줄이다: **부서 링크는 "지금 학기 × 시트가 담당하지 않는 부서" 만큼 있고, 그 밖에는
  없다.** 학기가 시작하면 그 학기의 링크가 나 있고, 학기가 끝나면 걷힌다 — 사람이 매 학기 내고
  거두지 않는다. 살아남은 지난 학기 링크는 "작년 담당자가 아직 우리 부서 명단을 연다"는 뜻이라,
  그 판단을 관리자의 기억에 맡기지 않는 것이다 (공용 비밀번호를 없앤 이유를 시간 축에 적용한 것).
  - 도는 자리는 **학기 종료 롤오버와 같은 `/api/roster`** (`syncTermLinks`) + 동산 탭의 GET.
    바뀐 게 없으면 아무것도 쓰지 않으므로 매 요청에 불러도 된다. 학기 판정은
    `currentSeason(오늘, config.semester_*)` → `"2026-fall"`, 아카이브·동산 스냅숏이 쓰는 그 키다.
  - **시트가 붙어 있는 부서에는 나지 않는다** (`sheetCoveredGroups`; `group`이 빈 시트는 두 부서를
    다 덮는다 — 여름 합동 시트가 그렇다). 같은 동산을 시트와 링크로 함께 적으면 다음 동기화가
    링크로 적은 값을 덮어쓰기 때문. 예전의 "여름이면 자리 없음" 규칙이 이것으로 대체됐다 —
    이유가 계절이 아니라 시트였으므로. 가을 시트를 붙이면 그 부서 링크는 그때 걷힌다.
  - **학기 중에 폐기하면 그 자리에 새 주소가 곧바로 난다** (POST도 같은 규칙을 거쳐 저장한다).
    폐기의 목적은 새어 나간 주소를 죽이는 것이지 그 부서를 학기 도중에 닫는 것이 아니라, 버튼도
    '새 주소로 바꾸기'다. **`term`이 빈 링크는 규칙 바깥**이라 자동으로 걷히지 않는다 — 동산별로
    내던 시절의 것과 장년부의 셀 링크(학기가 없는 부라 `USES_SEMESTERS` 밖이다)가 그것이고,
    동산 탭 아래쪽 목록에서 사람이 폐기한다.
  - **주소에 학기·연도·부서가 적힌다**: `/dongsan/2026-fall-college-9f3c…` (청년부는 `young`).
    링크를 두 장 나눠 주는 사람이 주소만 보고 갈라야 하기 때문. 여는 것은 뒤의 무작위 96비트고
    이름표는 열쇠가 아니다. 한글을 주소에 실으면 복사할 때 퍼센트 인코딩으로 뭉개진다.
- 드롭다운은 **O/X 둘뿐**이다: 표에서 출석은 "줄이 있다/없다"라 "안 왔다"와 "아직 안 적었다"를
  구별하지 못한다 (시트 파서의 *빈칸≠결석* 규칙은 시트 쪽에서 그대로 살아 있다). 그 한계를
  합계 줄과 화면 아래 한 줄 안내로 메운다.

## Deploy / ops — IMPORTANT gotchas
- **백업은 두 줄기**, 스키마 단위로 완전히 갈린다 (`PARTITION` 환경변수 / `backup.yml`의
  `partition` 입력 + matrix). `youth` → `pg_dump --schema=public` → `backups/`,
  `adult` → `pg_dump --schema=adult` → `backups/adult/`. **어느 파일에도 다른 부서의 사람은
  한 명도 없다.** 두 줄기가 같은 검증을 거친다 (일회용 DB에 마이그레이션 재생 → 덤프 적재 →
  행수 왕복 대조). 각 부서에서 데이터가 바뀔 때만 자기 줄기가 깨어나고 (그 스키마 config의
  `last_auto_backup_at` 청구권), 주간 크론은 입력을 실을 수 없으므로 matrix로 둘 다 돈다.
  복원도 스키마 단위다 — 그 스키마의 표를 전부 `TRUNCATE ... RESTART IDENTITY CASCADE` 하고
  백업을 흘려 넣으므로, 시퀀스를 손으로 밀 필요가 없고 다른 부서는 어느 쪽으로도 닿지 않는다.
  **재해복구는 이제 두 파일 다 필요하다** — `backups/`만으로는 장년부가 복구되지 않는다.
- **Edge function deploys via CI**, not MCP: `mcp__Supabase__deploy_edge_function` and
  `get_edge_function` are **permission-denied** in this environment. `.github/workflows/deploy.yml`
  runs `supabase functions deploy` when the `SUPABASE_ACCESS_TOKEN` repo secret is set (it is).
  So **any `supabase/functions` change deploys on merge to `main`**. Current fn version: v14.
- **Pages deploy `needs` the edge-function job** (atomic cutover) → if the fn deploy **fails**,
  Pages is skipped and the site stays put. But a `changes` job first diffs
  `supabase/functions` over the push range, and the fn job only runs when it actually changed;
  a **skipped** fn job lets Pages through, because an unchanged function is the one the
  frontend was built against. Don't re-tighten this to `needs: success()` — three consecutive
  runner outages ("The job was not acquired by Runner of type hosted") once held back a
  frontend-only deploy that had no function work in it. `changes` failing still blocks Pages
  (unknown ⇒ unsafe). A `notify` job comments deploy-success on the PR.
- **Migrations: add a repo file in `supabase/migrations/` and merge** — since 2026-06-10 prod's
  `schema_migrations` was repaired to match the repo's date-prefix filenames 1:1, so the Supabase
  branching integration is functional again: merge to `main` auto-applies new migration files to
  prod, and PR preview branches replay the full set (keep files **idempotent + guarded**, and
  version prefixes **unique**, ordered after their dependencies — members table exists from
  `20260615`, email from `20260623`). If you must hot-apply via `mcp__Supabase__apply_migration`,
  it records an orphan full-timestamp version that re-breaks the `main` sync ("Remote migration
  versions not found") — afterwards DELETE that row from `supabase_migrations.schema_migrations`
  and add the repo file with the next free date prefix instead.
- **Vite `base: '/kccp/'`** (GitHub Project Pages subpath) + `BrowserRouter` basename +
  `dist/404.html` SPA fallback. Without the base, every asset 404s → blank page.
  **Vercel PR previews serve at the domain root, so they look broken — preview-only; Pages is prod.**
  저장소 이름이 `kccp-attendance` → `kccp`로 바뀌면서 이 값도 따라왔다. 안 고쳤다면 빌드도
  배포도 초록으로 끝나고 브라우저만 옛 경로에서 자산을 찾다가 전부 404를 받았을 것이다 —
  하얀 화면에 콘솔에만 흔적이 남는, 가장 고약한 종류의 실패다. `main.tsx`의 basename,
  `sw.ts`의 스코프, `DongsanLinks`의 링크는 전부 `BASE_URL`을 읽으므로 따라온다. 남아 있던
  **하드코딩 하나**(`useAdminAuth`의 OAuth 복귀 경로)는 `BASE_PATH`로 갈아 끼웠고, Supabase
  redirect allow-list에 박히는 `redirectTo` 문자열만 여전히 상수다.
- **옛 주소는 죽는다.** `shrlak.github.io/kccp-attendance/`를 홈 화면에 추가해 둔 사람들이
  있다. **`kccp-attendance` 저장소를 지우지 말고** `index.html` 하나만 남겨 새 주소로
  보내는 것이 가장 싸다 (이 저장소에서는 할 수 없는 일 — 저쪽 저장소의 작업이다).
- **`backup.yml`의 `R2_BUCKET: kccp-attendance-backups`는 고치지 마라.** 실제 R2 버킷
  이름이고, 바꾸면 지금까지의 백업과 끊어진다. 저장소 이름과 우연히 같을 뿐이다. 반대로
  엣지 함수가 백업 워크플로를 부르는 **저장소 슬러그**는 따라와야 했다 (`backupRepo()`,
  기본값 `shrlak/kccp`) — 틀리면 404가 아니라 *옛* 저장소의 워크플로가 도는 조용한 실패다.
- 엑셀 내보내기 파일명(`kccp-attendance-2026-summer.xlsx`)은 사람이 받는 파일 이름이라
  그대로 뒀다. 바꿀지는 취향이고, 바꾸면 `archive.test.ts`가 알려 준다.
- Outbound network is allowlisted: `supabase.co` / `github.io` are blocked from this sandbox, so
  HTTP smoke tests of the live function/site fail with "Host not in allowlist". Verify via
  `mcp__Supabase__*` (DB/list_edge_functions) and the GitHub MCP instead.

## Perceived speed — where the waits live
- **A save must never wait on the roster refetch.** `refreshRoster(qc)` (lib/live.ts) is
  deliberately `void`, not awaitable: the mutation already returned, so the dialog closes on
  its own response and the refetch lands underneath. `refreshRosterSettled(qc)` is the
  awaitable twin, for the two callers that need it — the kiosk (holds an optimistic tile
  until the roster confirms) and the DB restore. Re-adding `await refreshRoster(...)`
  reintroduces a full members+log round trip on every save.
- **`/api/roster` is the app's hot path** (every tab reads it, `staleTime: 0`,
  `refetchInterval: 15s`). Its independent queries are batched: `resolveAdmin` ⟂ `getCfg`,
  then members ⟂ guests ⟂ the leader's 동산지기 lookup. The rollover *writes* stay after the
  401 so an unauthenticated request can't trigger a term rollover.
- **Reload** paints from the sessionStorage snapshot (`lib/queryPersist.ts`) before the first
  render; the refetch corrects it underneath.
- **Screen changes** are prefetched, not loaded on tap (`app/prefetch.ts`): route chunks on
  intent *and* on idle after first paint, Chart.js (203 kB) on idle once the panel is up.
  SheetJS (863 kB) is intent-only — the 내보내기 menu opening and hovering an 아카이브
  download — because it's the biggest dependency and exporting is deliberate.
- **Sign-in waits ≤2 s for GPS** (`GEO_LOGIN_WAIT_MS`), then goes without it; a cold
  high-accuracy fix used to hold the verifying screen for up to 9 s to enrich a log line.
  The server still records the IP city estimate, which the viewer labels 대략.
- `fx-*` durations in `index.css` are entrance timings between a tap and usable content —
  keep them short (fade .12s, pop .2s, rise .28s); they are not decoration.

## Git workflow
- Develop on the assigned `claude/...` branch. PRs created as **drafts**, **squash**-merged.
- The branch is deleted on each merge; recurring pattern to ship the next change cleanly:
  `git reset --hard origin/main` → re-apply/`cherry-pick` your commit → `git push --force`.
- Commit identity: `git config user.email noreply@anthropic.com && user.name Claude`. The
  squash-merge commits on `main` (committer `noreply@github.com`) are GitHub's, not yours — never
  rewrite them. Do not put the model id in commits/PRs/code.

## Status
- **새가족 교육 동산은 없앴다** (교육 기간에만 쓰던 임시 동산 배정). 동산이 두 벌이면 "이 사람의
  동산"이 어느 쪽인지가 화면마다 갈리는데, 실제로 쓰이는 것은 `members.subgroup` 하나였다 —
  교육용 이름 목록은 동산 탭에서만 정할 수 있었고, 붙인 값이 나가는 곳은 새가족 카드 타일의 작은
  줄 하나뿐이라 출석부·통계·엑셀·시트 연동 어디에도 들어가지 않았다. 지운 것: 멤버 편집 창의
  칸, 동산 탭의 이름 목록 편집기, 새가족 카드의 교육동산 줄, `/api/admin/new-member-dongsan-names`
  두 경로, `MemberEdit.newMemberDongsan`(멤버 수정 COLS에서도 빠져 이제 무시된다), 그 i18n 키들.
  **DB 컬럼 둘(`members.new_member_dongsan` · `config.new_member_dongsan_names`)은 두 스키마
  모두 그대로 둔다** — `config.summer_mode`와 같은 처리다. 백업이 `pg_dump --data-only
  --column-inserts`라 컬럼을 지우면 그 이전 덤프의 INSERT가 전부 깨지고(복원은 그 SQL을 그대로
  흘려 넣는다), 읽는 코드가 없는 컬럼은 아무 데도 새지 않는다.

**장년부 also runs on this system** (`kccpadults`): the same panel, scoped to its own 부 — 오늘 ·
출석부 · 멤버 · 통계 · 새가족 · 방문자 · 관리자 · 동산 · 설정 · 키오스크, all of it. **새가족 교육
is deliberately absent** there (it tracks 대학·청년부's two-week course). Its kiosk draws one 부서
block instead of two and drops the 부서만 보기 chips (nothing to choose between); its 새가족 카드
files everyone under 장년부 instead of guessing 대학부/청년부 from 소속; its 설정 탭 has no 여름
모드 row. **그 부서에서 동산은 "셀"이고,
셀 이름은 고정** — 학기가 끝나도 지워지지 않고 셀장·부셀장만 바뀐다. The panel header names the 부 on every screen, because that label is the only visible
difference between the two.

Full Phase 1–4 parity + production cutover complete. Shipped: branded landing, KCCP logo
(light/dark), 동산 admin tab (summer-combined names), bulk 동산 assign/unassign, clear-all
attendance with super-approval, analytics layout, logout→home (a **reload stays put**: the
route is the screen, and the admin panel's tab is remembered in `sessionStorage` via
`web/src/features/admin/adminTab.ts`), 출석부 archives (`features/admin/archive.ts` +
`ArchiveSection.tsx`: the sheet rolls over to the next 학기 — or the gap between two, shown
with the gap's own full Sunday set — the day a term ends, and every finished 학기/전환 기간,
학년도 and calendar year is downloadable as an Excel workbook built from the log at click
time, so clearing attendance clears the archives too). **출석부 탭은 표 하나만 그린다** — 시간순 '기록' 화면(`LogView`)과 표/기록 전환은 없앴다:
표가 이미 같은 사실을 담고 있고(누가 어느 주일에 왔나) 기록은 그것을 한 번 더 늘어놓을 뿐이라,
둘을 같이 두면 어느 쪽이 정본인지가 흐려진다. 한 줄 단위로 봐야 할 때는 내보내기의 엑셀(전체
기록 시트)이 그 자리를 대신한다. 장년부는 원래 표뿐이었으므로 `showsAttendanceLog`도 같이
없앴다.

**Status marks are the hiding rule**
(`web/src/lib/status.ts` is the single reader): a mark with **no end date** — 졸업, 타교회 정착,
한국 귀국, 이주 … — or any 귀국/이주/졸업 note takes the member **off the roster everywhere**.
The split happens once, in `useRoster`'s `splitRoster` (same place staff are split off), so
`data.members` never contains them and every tab — 출석부, 오늘, 멤버, 통계, 새가족, 새가족 교육,
방문자, 동산 pickers, 키오스크 — and every count is right without knowing the rule exists. They
come back as `data.hiddenMembers`, used in exactly two places: the 멤버 탭's collapsible
**숨긴 멤버** section (tap a card, clear the mark or give it an end date, and they return), and
`ArchiveSection`, which re-adds them on purpose so a finished 학기's Excel still holds everyone
who was actually there (`awayForRange` then decides per period). 키오스크 additionally hides a
current 방학, and — outside 여름학기 — offers a **부서만 보기** segmented control (전체/대학부/
청년부) chosen inside the kiosk, not a setting. See `docs/superpowers/`
(gitignored; force-added curated docs) for the parity inventory, cutover plan, and runbook.

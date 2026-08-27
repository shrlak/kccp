# KCCP

한국중앙교회 피츠버그 — 출석과 예배 슬라이드를 한 앱에서.

`shrlak/kccp-attendance`와 `shrlak/ppt`를 합친 저장소입니다. **두 저장소의 git
히스토리가 모두 들어 있습니다** (`ppt`는 `vendor/ppt/` 서브트리).

---

## 자격이 영역을 준다

첫 화면은 **KCCP 관리자 로그인**이고, 어떤 자격으로 들어오느냐가 무엇을 볼지
정합니다. 규칙은 두 문장입니다.

> 비밀번호는 언제나 출석뿐이다. 슬라이드는 구글 계정으로만 열린다.

| 자격 | 영역 | 부(部) | 로그인 후 |
|---|---|---|---|
| `kccpadmin` | 출석 | 대학·청년부 | 관리자 패널 |
| `kccpwelcome` | 출석 | 대학·청년부 | 새가족 |
| `kccpadults` | 출석 | 장년부 | 관리자 패널 |
| `kccpmedia@gmail.com` | 슬라이드 | 장년부 | 1부 · 2부 |
| `kccp.bitjulove.media@gmail.com` | 슬라이드 | 대학·청년부 | 3부 |
| 그 밖의 구글 계정 | 계산됨 | — | `member_roles`로 |
| 소유자 이메일 | 전부 | 둘 다 | 영역 고르기 |

슬라이드 계정으로는 명단에 닿을 수 없고, 출석 비밀번호로는 슬라이드를 만들 수
없습니다. **막는 것은 화면이 아니라 서버입니다** — `resolveAdmin()`이 라우트마다
영역을 요구하고, `areaOf()`의 기본값이 `'attend'`라 규칙을 빠뜨린 새 라우트는
*열리는 것이 아니라 막히는* 쪽으로 실패합니다.

설정으로 바꿀 수 있는 값:

```
KCCP_OWNER_EMAIL      기본값 spencerkim1235@gmail.com
KCCP_MEDIA_ACCOUNTS   "a@x.com:adult,b@y.com:youth"
```

## 주소

| 주소 | 무엇 | 로그인 |
|---|---|---|
| `/` | 관리자 로그인 → 가진 영역 | — |
| `/admin` | 같은 화면 (옛 주소, 그대로 삽니다) | — |
| `/checkin` | 부원 개인 체크인 (옛 랜딩) | 없음 |
| `/kiosk` | 교회 태블릿 | 키오스크 게이트 |
| `/share`, `/share/adult` | 카드 등록 (공유 시트) | 없음 |
| `/dongsan/:token` | 동산지기 출석 | 토큰이 곧 신원 |

## 폴더

```
web/src/areas/attend/     admin · checkin · dongsan · kiosk · share
web/src/areas/slides/     ppt가 들어올 자리 (지금은 껍데기)
web/src/areas/AreaChoice.tsx
supabase/functions/       attendance-api — auth.ts가 자격·영역·부를 푼다
supabase/migrations/      스키마
vendor/ppt/               합쳐 온 ppt 원본 (아직 손대지 않음)
```

## 개발

```bash
cd web
npm ci
npm run dev      # 개발 서버
npm test         # vitest — 692 tests
npm run build    # tsc + vite + PWA

# 엣지 함수
cd supabase/functions/attendance-api
deno test --allow-all    # 108 tests
```

## 남은 작업

1. **슬라이드 이식** — `vendor/ppt/src/lib/pptx*` · `src/bible/` · `src/lib/lyrics/`를
   `web/src/areas/slides/`로 `git mv`. (지우고 새로 만들면 `git blame`이 끊깁니다.)
2. **`ai-proxy` 엣지 함수** — Cloudflare Worker가 감추던 Gemini/OpenRouter 키를
   Supabase 시크릿으로. 인증이 생기는 게 이득입니다: 지금은 배포된 ppt 앱을 연
   누구나 무료 한도를 쓸 수 있지만, 합쳐지면 `areas`에 `'slides'`를 가진
   계정만 씁니다.
3. **파일은 Storage로** — Worker의 1 MiB 청크 코드가 통째로 사라집니다.
4. **콘티를 앱 안으로** — `services` · `teams` · `setlists`. 그러면 슬라이드
   마법사의 첫 단계가 "업로드"에서 "고르기"로 바뀝니다.
5. **`vendor/ppt` 정리, `ppt` 저장소 아카이브** — 미디어팀이 두 주 연속 KCCP만
   으로 슬라이드를 만든 다음에. 되돌릴 수 없는 단계는 이것뿐이라 제일 늦게.

### 번들 예산

합치기가 실패한다면 번들에서 실패합니다. 슬라이드가 끌고 올 무게(pdfjs ~1MB,
성경 본문 번역본당 수 MB)는 출석 쪽과 자릿수가 다릅니다. **기준선을 옮기기 전에
재 뒀습니다: precache 1063 KiB.** 슬라이드 영역은 반드시 lazy로 두고, 이 숫자가
크게 움직이면 무언가 랜딩으로 샌 것입니다.

자세한 규칙은 [`CLAUDE.md`](./CLAUDE.md), 사용자 매뉴얼은 [`docs/manual/`](./docs/manual/).

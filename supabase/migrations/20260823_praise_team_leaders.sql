-- 찬양팀 인도자 — 콘티를 올리는 사람이 누구인가.
--
-- ── 왜 표인가 (환경 변수가 아니라) ───────────────────────────────────────────────────
-- 부서 미디어팀은 `MEDIA_ACCOUNTS` 환경 변수에 박혀 있다. 그것이 옳았던 이유는 그 계정이
-- **사람이 아니라 역할 계정**이기 때문이다 — kccpmedia@gmail.com 은 아무도 아니고,
-- 그래서 members 행도 없다.
--
-- 인도자는 사람이다. 그리고 사람은 바뀐다 — 학기마다, 때로는 한 주 만에. 환경 변수에
-- 두면 인도자가 바뀔 때마다 **배포**가 필요하고, 배포할 수 있는 사람은 한 명이다.
-- 여기 두면 관리자가 한 줄을 고친다. `config.dongsan_leaders` 가 동산지기를 그렇게
-- 두는 것과 같은 판단이다.
--
-- ── 왜 이메일이 열쇠인가 ─────────────────────────────────────────────────────────────
-- 들어오는 길이 구글 로그인 하나뿐이고, 그 길이 우리에게 주는 것이 이메일이기 때문이다.
-- member_id 도 함께 적지만 그것은 **이름을 얻기 위한 것**이지 판정의 열쇠가 아니다:
-- 인도자가 members 에 없을 수 있고(다른 부 교인이 서는 일이 있다), 그때도 콘티는
-- 올라와야 한다.
--
-- **비밀번호는 여기에도 없다.** 주일 화면에 나가는 일과 AI 무료 한도를 쓰는 일은
-- 회수할 수 있고 로그인 기록이 남는 자격 뒤에 있어야 한다 (CLAUDE.md의 그 두 문장).
CREATE TABLE IF NOT EXISTS public.team_leaders (
    team_id    uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    -- 구글 로그인의 이메일. 소문자로 견준다 (아래 인덱스).
    email      text        NOT NULL,
    -- 그 사람의 members 행 — **있으면.** 어느 스키마인지는 팀의 부(部)가 안다.
    -- 판정에는 쓰지 않는다: 없다고 해서 인도자가 아닌 것이 아니다.
    member_id  uuid,
    -- 화면에 적는 이름. members 행이 없을 때 "누가 올렸나"를 말할 수 있는 유일한 값이다.
    name       text,
    active     boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, email)
);

COMMENT ON TABLE public.team_leaders IS
  '찬양팀 인도자 — 이 이메일로 들어온 로그인은 그 팀의 콘티를 올린다. 비밀번호로는 열리지 않는다.';

-- **한 인도자는 한 팀이다.** 두 팀을 이끌 수 있게 두면 "올린 인도자에 맞춰서"가 답을
-- 잃는다: 콘티 한 장이 어느 팀의 것인지를 서버가 정할 수 없고, 그 판단이 화면으로
-- 내려가면 결국 사람이 주일 아침에 고른다. 실제로 겹치는 사람이 생기면 그때는 계정을
-- 나누는 것이 아니라 이 제약을 풀고 화면에 고르는 자리를 만들어야 한다 — 그 결정이
-- 조용히 내려지지 않도록 여기서 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS team_leaders_one_team_per_email
    ON public.team_leaders (lower(email)) WHERE active;

-- 팀으로 되짚는 길. 인도자 목록은 팀 화면이 읽는다.
CREATE INDEX IF NOT EXISTS team_leaders_by_team
    ON public.team_leaders (team_id) WHERE active;

-- 나머지 표와 같은 처리: 정책 없는 DENY-ALL. 통로는 service_role로 도는 엣지 함수뿐이다.
ALTER TABLE public.team_leaders ENABLE ROW LEVEL SECURITY;

-- ── 콘티를 올린 사람 ─────────────────────────────────────────────────────────────────
-- `setlists` 는 지금까지 **팀**만 알았다. 미디어팀이 카톡으로 받아 올리던 시절에는 그것이
-- 아는 전부였기 때문이다. 이제 콘티는 인도자가 직접 올리므로 그 사람이 남는다 — 그리고
-- 그것이 남아야 하는 이유는 기록이 아니라 **물어볼 사람**이다: 표지의 곡 순서가 이상할
-- 때 주일 아침에 연락할 곳이 팀 이름이면 아무 데도 아니다.
ALTER TABLE public.setlists ADD COLUMN IF NOT EXISTS uploaded_by_email text;
ALTER TABLE public.setlists ADD COLUMN IF NOT EXISTS uploaded_by_name  text;

COMMENT ON COLUMN public.setlists.uploaded_by_email IS
  '콘티를 올린 인도자. 기록이 아니라 주일 아침에 물어볼 곳이다.';

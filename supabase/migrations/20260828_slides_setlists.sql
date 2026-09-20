-- 콘티를 앱 안으로 — 예배·찬양팀·콘티의 데이터 모델.
--
-- ── 이 합치기의 원래 목적 ─────────────────────────────────────────────────────────────
-- 지금 미디어팀은 찬양팀이 카톡으로 보낸 콘티 PDF를 **다시 받아 올린다.** 이 표들이
-- 생기면 찬양팀이 자기 콘티를 앱에 올리고, 마법사의 첫 단계가 「업로드」에서 「고르기」로
-- 바뀐다. 그것이 두 저장소를 합친 이유였다.
--
-- ── 왜 스키마가 아니라 컬럼으로 부(部)를 나누는가 ─────────────────────────────────────
-- 출석 쪽의 모든 표는 스키마로 부가 갈린다 (public / adult). 여기는 갈리지 않는다.
-- 출석에서 부의 경계는 **사람의 경계**다 — 다른 부의 명단은 한 행도 보여서는 안 된다.
-- 여기서 부는 **예배의 속성**이다: 1·2부는 장년부, 3부는 대학·청년부이고, 한 화면에서
-- 나란히 보이는 것이 정상이다. 스키마로 가르면 "이번 주 예배 목록"을 두 번 읽어 합쳐야
-- 하고, 그 합치는 코드가 곧 새는 자리가 된다. 범위는 `partition` 컬럼으로 좁힌다.

-- ── 예배 ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.services (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- '1부' · '2부' · '3부'
    name       text        NOT NULL,
    -- 시작 시각 (교회 현지 시간의 벽시계). 날짜가 붙지 않는 값이라 time 이다.
    starts_at  time        NOT NULL,
    partition  text        NOT NULL CHECK (partition IN ('youth', 'adult')),
    -- 화면에 나열되는 순서. 시각으로 정렬하면 부가 섞여 읽기 어렵다.
    sort_order integer     NOT NULL DEFAULT 0,
    active     boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (partition, name)
);

COMMENT ON TABLE public.services IS
  '주일 예배 — 1부 09:00(장년) · 2부 11:15(장년) · 3부 14:00(대학·청년). 부는 예배의 속성이라 스키마가 아니라 컬럼이다.';

-- ── 찬양팀 ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teams (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text        NOT NULL,
    -- 'praise' = 찬양팀(콘티를 만든다), 'choir' = 찬양대(성가대)
    kind       text        NOT NULL CHECK (kind IN ('praise', 'choir')),
    partition  text        NOT NULL CHECK (partition IN ('youth', 'adult')),
    active     boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (partition, name),
    -- 찬양대는 장년부에만 있다. 데이터베이스가 아는 사실이라 데이터베이스가 지킨다 —
    -- 화면에서만 막으면 다음에 시드를 넣는 사람이 조용히 어긴다.
    CONSTRAINT teams_choir_is_adult CHECK (kind <> 'choir' OR partition = 'adult')
);

COMMENT ON CONSTRAINT teams_choir_is_adult ON public.teams IS
  '찬양대(choir)는 장년부에만 있다 — 화면이 아니라 여기서 지킨다';

-- ── 어느 팀이 어느 예배에 서는가 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_services (
    team_id    uuid NOT NULL REFERENCES public.teams(id)    ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    -- 2부에는 콘티가 둘 온다 (헵시바 찬양팀 · 찬양대). 그중 **어느 쪽이 슬라이드가
    -- 되는가**를 이 칸이 정한다. 기본은 헵시바.
    leads_ppt  boolean NOT NULL DEFAULT false,
    PRIMARY KEY (team_id, service_id)
);

-- 한 예배에서 슬라이드를 이끄는 팀은 최대 하나다. 둘이면 마법사가 어느 콘티를 열지
-- 모르고, 그 판단은 주일 아침에 사람이 하게 된다.
CREATE UNIQUE INDEX IF NOT EXISTS team_services_one_leader
    ON public.team_services (service_id) WHERE leads_ppt;

-- ── 그 주의 콘티 ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.setlists (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id      uuid NOT NULL REFERENCES public.teams(id)    ON DELETE CASCADE,
    service_id   uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    service_date date NOT NULL,
    -- Storage 객체의 키. 버킷은 kccp-conti / kccp-decks (20260821), 전부 비공개.
    conti_path   text,
    deck_path    text,
    -- 보관 시각. 목록에서 내려가지만 **지워지지는 않는다** (아래).
    archived_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT NOW(),
    updated_at   timestamptz NOT NULL DEFAULT NOW(),
    -- service_id 를 빼고 팀·날짜만으로 잡으면 헵시바의 1부와 2부가 한 줄을 두고 서로
    -- 덮어쓴다 — 두 예배의 곡이 다르기 때문이다. 그리고 그 덮어쓰기는 이제 예배 중
    -- 화면에 나타난다.
    UNIQUE (team_id, service_id, service_date)
);

COMMENT ON COLUMN public.setlists.archived_at IS
  '목록에서 내려간 시각 — 지운 것이 아니다. 매주 일요일 오후 5시 전체 삭제(cron)를 대신한다.';

-- 살아 있는 콘티를 날짜 역순으로 — 마법사의 「고르기」가 읽는 길.
CREATE INDEX IF NOT EXISTS setlists_live_by_date
    ON public.setlists (service_date DESC) WHERE archived_at IS NULL;

-- ── 매주 지우던 규칙을 왜 다시 보는가 ────────────────────────────────────────────────
-- ppt는 일요일 오후 5시에 콘티를 **전부 지웠다** (Worker의 cron). 지운 이유가 Durable
-- Object의 용량이었다면, Storage로 옮긴 뒤에는 그 이유가 없어진다.
--
-- 지난 주 콘티를 다시 찾는 일은 실제로 생긴다. **지우는 것과 목록에서 안 보이는 것은
-- 다른 일**이고, 지금까지 그 둘이 붙어 있던 것은 기술적 제약 때문이었다. 그래서 기본을
-- **보관**으로 둔다: archived_at 을 찍으면 목록에서 내려가고 파일은 남는다.
--
-- 보관 비용이 실제로 문제가 되면 그때 pg_cron 으로 오래된 것부터 정리하면 된다. 지금
-- 넣지 않는 이유는, 아직 문제가 아닌 것을 위한 자동 삭제가 **문제가 되기 전에 데이터를
-- 지우는 유일한 코드**가 되기 때문이다.

-- 나머지 표와 같은 처리: 정책 없는 DENY-ALL. 통로는 service_role로 도는 엣지 함수뿐이다.
ALTER TABLE public.services      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setlists      ENABLE ROW LEVEL SECURITY;

-- ── 시드 ──────────────────────────────────────────────────────────────────────────────
-- 실재하는 예배와 팀이라 여기 둔다. 이름으로 충돌을 잡으므로 재생해도 안전하다.
INSERT INTO public.services (name, starts_at, partition, sort_order) VALUES
    ('1부', '09:00', 'adult', 1),
    ('2부', '11:15', 'adult', 2),
    ('3부', '14:00', 'youth', 3)
ON CONFLICT (partition, name) DO NOTHING;

INSERT INTO public.teams (name, kind, partition) VALUES
    ('주랑 찬양팀',   'praise', 'youth'),
    ('헵시바 찬양팀', 'praise', 'adult'),
    ('찬양대',        'choir',  'adult')
ON CONFLICT (partition, name) DO NOTHING;

-- 어느 팀이 어느 예배에 서고, 그중 누가 슬라이드를 이끄는가.
INSERT INTO public.team_services (team_id, service_id, leads_ppt)
SELECT t.id, s.id, x.leads_ppt
FROM (VALUES
    ('헵시바 찬양팀', 'adult', '1부', true),
    ('헵시바 찬양팀', 'adult', '2부', true),   -- 2부의 콘티 둘 중 슬라이드가 되는 쪽
    ('찬양대',        'adult', '2부', false),
    ('주랑 찬양팀',   'youth', '3부', true)
) AS x(team_name, part, service_name, leads_ppt)
JOIN public.teams    t ON t.name = x.team_name    AND t.partition = x.part
JOIN public.services s ON s.name = x.service_name AND s.partition = x.part
ON CONFLICT (team_id, service_id) DO NOTHING;

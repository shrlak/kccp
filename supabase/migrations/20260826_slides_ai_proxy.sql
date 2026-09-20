-- 슬라이드 AI 프록시가 앉을 자리 — Durable Object가 들고 있던 두 가지를 표로 옮긴다.
--
-- ── 왜 ────────────────────────────────────────────────────────────────────────────────
-- ppt 앱에는 백엔드가 없었다. 정적 사이트라 Gemini·OpenRouter 키를 숨길 곳이 없어서
-- Cloudflare Worker가 그 자리를 대신했고, 사용량 카운터와 공유 설정은 Durable Object의
-- 키-값 저장소에 살았다. 이제 Supabase 엣지 함수가 그 자리에 있으므로 상태도 여기로 온다.
--
-- 함께 넘어오는 것이 하나 더 있다. 지금은 **배포된 ppt 앱을 연 누구나** 교회의 AI 무료
-- 한도를 쓸 수 있다. 합쳐지면 `areas`에 'slides'를 가진 계정 — 부서 미디어팀의 역할 계정
-- 둘 — 만 쓴다. 프록시 경로가 `/api/slides/` 아래라 `areaOf()`가 그렇게 판정하고, 그
-- 판정을 위해 코드를 한 줄도 더 쓰지 않는다. **버그를 고친 것이 아니라 기능이 하나 생겼다.**
--
-- ── 부(部)를 모르는 두 표 ──────────────────────────────────────────────────────────────
-- 출석 쪽의 모든 표는 스키마로 부가 갈린다 (public / adult). 여기 둘은 갈리지 않는다:
--   · 무료 한도는 **키 하나에 붙어 있다.** 장년부가 쓴 250회와 대학·청년부가 쓴 250회는
--     같은 통에서 나간다. 부마다 카운터를 두면 그 합이 실제 한도를 넘겨도 아무도 모른다.
--   · 모델 풀과 제외 곡 목록은 인식 품질에 대한 판단이지 부서의 명단이 아니다.
-- 그래서 둘 다 public 스키마에만 둔다. adult.config 에는 짝이 없고, 그것이 의도다.
--
-- 백업에 딸려 오는 결과: 두 표 모두 대학·청년부 줄기(`pg_dump --schema=public`)에 실린다.
-- 대학·청년부를 복원하면 오늘의 사용량 카운터와 공유 설정이 백업 시점으로 돌아간다.
-- 카운터는 그날 자정에 어차피 새로 시작하는 값이고, 설정은 관리자 화면에서 다시 고른다.

-- ── 사용량 ────────────────────────────────────────────────────────────────────────────
-- 하루·공급자·모델마다 한 줄. Gemini의 RPD는 태평양 시간 자정에, OpenRouter의 것은 UTC
-- 자정에 리셋되므로 `day`는 **공급자마다 다른 시간대에서 계산된 날짜**다 (edge function의
-- usagePeriod가 정한다). 여기에 timestamptz를 두고 서버가 자르게 하면 두 리셋 시각 중
-- 하나는 반드시 틀린다.
CREATE TABLE IF NOT EXISTS public.ai_usage (
    day                 date        NOT NULL,
    provider            text        NOT NULL,
    model               text        NOT NULL,
    requests            integer     NOT NULL DEFAULT 0,
    successful_requests integer     NOT NULL DEFAULT 0,
    failed_requests     integer     NOT NULL DEFAULT 0,
    prompt_tokens       bigint      NOT NULL DEFAULT 0,
    output_tokens       bigint      NOT NULL DEFAULT 0,
    total_tokens        bigint      NOT NULL DEFAULT 0,
    updated_at          timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (day, provider, model)
);

COMMENT ON TABLE public.ai_usage IS
  '슬라이드 인식이 쓴 AI 무료 한도 — 하루·공급자·모델마다 한 줄. 부를 모른다 (한도가 키 하나에 붙어 있다).';
COMMENT ON COLUMN public.ai_usage.day IS
  '공급자의 리셋 시간대에서 센 날짜 (gemini=America/Los_Angeles, openrouter=UTC) — ai-proxy의 usagePeriod가 정한다';

-- 나머지 표와 같은 처리: 정책 없는 DENY-ALL. 데이터 통로는 service_role로 도는 엣지
-- 함수 하나뿐이고, 권한 판정은 auth.ts가 TypeScript로 한다.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- 한 번의 왕복으로 세는 원자적 증가. 읽고-더하고-쓰면 같은 순간에 들어온 두 인식 요청이
-- 서로의 증가를 덮어쓴다 — 한도를 세는 카운터에서 그 손실은 조용하고, 넘긴 뒤에야 드러난다.
CREATE OR REPLACE FUNCTION public.record_ai_usage(
    p_day     date,
    p_provider text,
    p_model    text,
    p_success  boolean,
    p_prompt_tokens bigint,
    p_output_tokens bigint,
    p_total_tokens  bigint
) RETURNS void
LANGUAGE sql
AS $$
    INSERT INTO public.ai_usage AS u (
        day, provider, model, requests, successful_requests, failed_requests,
        prompt_tokens, output_tokens, total_tokens, updated_at
    )
    VALUES (
        p_day, p_provider, p_model, 1,
        CASE WHEN p_success THEN 1 ELSE 0 END,
        CASE WHEN p_success THEN 0 ELSE 1 END,
        GREATEST(p_prompt_tokens, 0), GREATEST(p_output_tokens, 0), GREATEST(p_total_tokens, 0),
        NOW()
    )
    ON CONFLICT (day, provider, model) DO UPDATE SET
        requests            = u.requests            + 1,
        successful_requests = u.successful_requests + CASE WHEN p_success THEN 1 ELSE 0 END,
        failed_requests     = u.failed_requests     + CASE WHEN p_success THEN 0 ELSE 1 END,
        prompt_tokens       = u.prompt_tokens       + GREATEST(p_prompt_tokens, 0),
        output_tokens       = u.output_tokens       + GREATEST(p_output_tokens, 0),
        total_tokens        = u.total_tokens        + GREATEST(p_total_tokens, 0),
        updated_at          = NOW();
$$;

COMMENT ON FUNCTION public.record_ai_usage IS
  'AI 사용 한 건을 세는 원자적 UPSERT — 읽고-더하고-쓰면 동시 요청이 서로의 증가를 덮어쓴다';

-- ── 공유 설정 ─────────────────────────────────────────────────────────────────────────
-- 모델 풀(어느 모델이 champion이고 challenger인지)과 제외 곡 목록. 칸 하나에 jsonb로
-- 두는 이유는 모양이 자주 바뀌기 때문이다 — 모델 카탈로그는 무료 티어가 바뀔 때마다
-- 따라 움직이고, 그때마다 마이그레이션을 쓰고 싶지는 않다. 읽는 쪽(ai-proxy의 catalog.ts)이
-- 카탈로그에 없는 모델을 **버리므로**, 오래된 값이 남아 있어도 유료 모델로 새지 않는다.
ALTER TABLE public.config ADD COLUMN IF NOT EXISTS slides_ai_settings jsonb;

COMMENT ON COLUMN public.config.slides_ai_settings IS
  '슬라이드 인식의 공유 설정 (모델 풀 · 역할 · 제외 곡 목록) — 부를 모른다. NULL이면 ai-proxy의 기본값.';

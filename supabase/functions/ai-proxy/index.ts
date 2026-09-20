// 슬라이드 인식의 AI 프록시.
//
// ── 왜 이 함수가 있는가 ───────────────────────────────────────────────────────────────
// Cloudflare Worker가 존재한 이유의 절반이다. ppt는 정적 사이트라 백엔드가 없었고,
// Gemini·OpenRouter 키를 숨길 곳이 없었다. 이제 그 자리는 Supabase 엣지 함수다.
//
// 옮겨 오면서 **버그가 아니라 기능이 하나 생긴다.** 지금은 배포된 ppt 앱을 연 누구나
// 교회의 AI 무료 한도를 쓸 수 있다. 여기서는 영역을 가진 계정만 쓴다 — 경로 접두사가
// 곧 영역이라(`areaOf()`), **출석 비밀번호로는 이 함수를 부를 수 없다.** 그 판정을 위해
// 한 줄도 더 쓰지 않았다.
//
// 접두사는 둘이다: `/api/slides/ai/…`(미디어팀의 마법사)와 `/api/praise/ai/…`(찬양팀
// 인도자의 자동 제작). **같은 규칙을 두 번 적지 않고 접두사만 벗긴다** — 두 벌이 되면
// 한쪽이 뒤처지고, 뒤처진 쪽이 열려 있는 쪽이 된다.
//
// 인도자에게 이 문을 여는 것은 판단이다: 콘티에서 가사를 읽는 일이 곧 「자동으로 만든다」
// 이므로, 그것 없이는 이 영역이 업로드 창구에 지나지 않는다. 쓰는 만큼은 그대로 센다
// (`record_ai_usage`) — 한도는 키 하나에 붙어 있고, 두 문이 같은 카운터를 쓴다.
//
// ── 왜 attendance-api 안이 아닌가 ─────────────────────────────────────────────────────
// 한 요청이 상류 모델을 기다리는 동안 아이솔레이트를 붙들고 있는데, /api/roster 는 앱의
// 뜨거운 길이라 15초마다 모두가 부른다. 둘을 갈라 두면 인식이 느린 날에도 출석은 그대로
// 뜬다. 대신 자격 판정은 **같은 코드**를 부른다 (auth.ts) — 규칙이 두 벌이 되는 순간
// 한쪽이 뒤처지고, 뒤처진 쪽이 열려 있는 쪽이 된다.
// 버전을 박는다. attendance-api는 버전 없는 형태를 쓰지만(합쳐 오기 전부터), deno lint의
// no-unversioned-import 가 그것을 막는다 — 그리고 그 규칙이 옳다: 버전 없는 지정자는
// 어느 날의 배포가 어느 타입 정의로 빌드됐는지를 알 수 없게 만든다.
import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isOwner, resolveAdmin, type Role } from "../attendance-api/auth.ts";
import { resolveOpenRouterRoute, sanitizeSharedSettings } from "./catalog.ts";
import {
  buildUsageSnapshot,
  geminiUsageMetadata,
  openAiUsageMetadata,
  usageDay,
  type UsageRow,
} from "./usage.ts";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// attendance-api 의 것과 같은 목록이어야 한다 — 브라우저는 두 함수를 같은 클라이언트에서
// 부르고, 빠진 헤더 하나가 프리플라이트에서 요청 전체를 막는다.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Device-Id,X-Admin-Password,X-Partition,Authorization,apikey",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// 상류가 돌려준 본문을 그대로 흘린다. 프록시가 모양을 고치기 시작하면 모델이 바뀔 때마다
// 여기도 따라 고쳐야 하고, 클라이언트는 두 곳의 사정을 알아야 한다.
const passthrough = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const env = (key: string): string | undefined => {
  try { return Deno.env.get(key) ?? undefined; } catch { return undefined; }
};

/**
 * 설정을 쓸 수 있는 사람인가. 읽기는 슬라이드 영역이면 누구나 — 모델 풀은 인식이 돌기
 * 위해 필요한 값이다. 쓰기는 좁힌다: 모델 풀을 바꾸는 것은 교회 전체의 무료 한도가
 * 어디로 나가는지를 바꾸는 일이라, 미디어 역할 계정이 아니라 사람이 정한다.
 */
function canWriteSettings(role: Role): boolean {
  return role.role === "super_admin" || isOwner(role.email);
}

/**
 * 이 함수가 답하는 영역 접두사들. 새 영역을 더할 때 여기 한 줄이면 된다 — 그리고 그
 * 한 줄이 곧 「그 영역이 교회의 AI 무료 한도를 쓴다」는 결정이라, 조용히 지나가지 않는다.
 */
const AREA_PREFIXES = ["/api/slides/ai", "/api/praise/ai"] as const;

/** 사용량 한 건을 센다. 계량 실패가 인식 결과를 잃게 하면 안 되므로 삼킨다. */
// deno-lint-ignore no-explicit-any
async function recordUsage(sb: any, provider: string, model: string, success: boolean, tokens: {
  promptTokens: number; outputTokens: number; totalTokens: number;
}): Promise<void> {
  try {
    await sb.rpc("record_ai_usage", {
      p_day: usageDay(provider),
      p_provider: provider,
      p_model: model,
      p_success: success,
      p_prompt_tokens: tokens.promptTokens,
      p_output_tokens: tokens.outputTokens,
      p_total_tokens: tokens.totalTokens,
    });
  } catch (e) {
    console.error("ai usage record failed", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // service-role 클라이언트 — RLS를 지나간다. 권한 판정은 아래 resolveAdmin이 한다.
  //
  // any로 받는 이유: auth.ts의 SB는 `ReturnType<typeof createClient>`(제네릭 기본값)이고
  // 여기서 만든 것은 구체 타입이라, 두 제네릭이 불변(invariant)이라 서로 대입되지 않는다.
  // 실체는 같은 객체다. attendance-api도 같은 자리에서 같은 처리를 한다.
  // deno-lint-ignore no-explicit-any
  const sb: any = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 함수 이름 앞부분을 잘라 낸다 — attendance-api 와 같은 방식이라, 배포 경로가
  // /functions/v1/ai-proxy/api/slides/… 여도 규칙은 /api/slides/… 하나로 읽힌다.
  // **이 접두사가 곧 영역 판정이다** (auth.ts areaOf).
  const url = new URL(req.url);
  const apiIdx = url.pathname.indexOf("/api");
  const p = apiIdx >= 0 ? url.pathname.slice(apiIdx) : "/";

  if (req.method === "GET" && p === "/api/health") {
    return json({ status: "ok", ts: Date.now() });
  }

  // 영역 접두사를 벗겨 낸 나머지. 아래의 모든 분기는 이것 하나로 읽으므로, 경로 규칙이
  // 영역마다 갈라지지 않는다. **접두사를 지우는 것이지 검사를 건너뛰는 것이 아니다** —
  // 검사는 바로 아래 resolveAdmin 이 원래 경로(`req`)로 한다.
  const tail = AREA_PREFIXES.reduce<string | null>(
    (found, prefix) => found ?? (p.startsWith(prefix) ? p.slice(prefix.length) : null),
    null,
  );
  if (tail === null) return json({ error: "not found" }, 404);

  // resolveAdmin이 자격을 풀고, areaOf가 **원래 경로**에서 요구하는 영역을 확인한다 —
  // 출석 비밀번호는 areas: ['attend'] 뿐이라 두 접두사 어디에서도 떨어진다.
  const role = await resolveAdmin(sb, req);
  if (!role) return json({ error: "unauthorized" }, 401);

  try {
    // ── 공유 설정 ─────────────────────────────────────────────────────────────────────
    if (tail === "/settings") {
      if (req.method === "GET") {
        const { data } = await sb.from("config").select("slides_ai_settings").eq("id", 1).maybeSingle();
        return json(sanitizeSharedSettings(data?.slides_ai_settings));
      }
      if (req.method === "POST") {
        if (!canWriteSettings(role)) return json({ error: "forbidden" }, 403);
        let body: unknown = null;
        try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
        // 들어온 값을 그대로 저장하지 않는다. 카탈로그에 없는 모델은 여기서 떨어지므로,
        // 오래된 화면이나 손으로 만든 요청이 유료 모델을 설정에 심을 수 없다.
        const settings = sanitizeSharedSettings(body);
        const { error } = await sb.from("config").update({ slides_ai_settings: settings }).eq("id", 1);
        if (error) return json({ error: error.message }, 500);
        return json(settings);
      }
      return json({ error: "not found" }, 404);
    }

    // ── 사용량 ────────────────────────────────────────────────────────────────────────
    if (req.method === "GET" && tail === "/usage") {
      // 이틀치를 읽고 오늘 것만 접는다. 하루치만 읽으면 공급자마다 "오늘"이 다른
      // 시간대에서 계산되므로 자정 언저리에 한쪽이 통째로 빈다.
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data, error } = await sb.from("ai_usage").select("*").gte("day", since);
      if (error) return json({ error: error.message }, 503);
      return json(buildUsageSnapshot((data ?? []) as UsageRow[], {
        GEMINI_DAILY_REQUEST_LIMIT: env("GEMINI_DAILY_REQUEST_LIMIT"),
        OPENROUTER_DAILY_REQUEST_LIMIT: env("OPENROUTER_DAILY_REQUEST_LIMIT"),
        GEMINI_MODEL: env("GEMINI_MODEL"),
        OPENROUTER_MODEL: env("OPENROUTER_MODEL"),
      }));
    }

    if (req.method !== "POST") return json({ error: "not found" }, 404);

    // ── Gemini ────────────────────────────────────────────────────────────────────────
    if (tail.startsWith("/gemini/")) {
      const key = env("GEMINI_API_KEY");
      if (!key) return json({ error: "GEMINI_API_KEY not configured on the proxy" }, 500);
      const model = decodeURIComponent(tail.slice("/gemini/".length));
      if (!model) return json({ error: "missing model" }, 400);

      const body = await req.text();
      const upstream =
        `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const resBody = await res.text();
      await recordUsage(sb, "gemini", model, res.ok, geminiUsageMetadata(resBody));
      return passthrough(resBody, res.status);
    }

    // ── OpenRouter ───────────────────────────────────────────────────────────────────
    if (tail === "/openrouter") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

      const requested = typeof body?.model === "string" ? body.model : "";
      const route = resolveOpenRouterRoute(requested);
      // 조용한 대체는 없다. 무료 카탈로그 밖의 모델은 다른 것으로 바꾸는 게 아니라 거절한다.
      if (!route) return json({ error: `model not allowed: ${requested.slice(0, 100)}` }, 400);

      const key = env("OPENROUTER_API_KEY");
      if (!key) return json({ error: "OPENROUTER_API_KEY not configured on the proxy" }, 500);

      const res = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${key}`,
          "HTTP-Referer": "https://shrlak.github.io/kccp/",
          "X-OpenRouter-Title": "KCCP 예배 슬라이드",
        },
        body: JSON.stringify({ ...body, model: route.upstreamModel }),
      });
      const resBody = await res.text();
      await recordUsage(sb, "openrouter", route.upstreamModel, res.ok, openAiUsageMetadata(resBody));
      return passthrough(resBody, res.status);
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error("ai-proxy error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

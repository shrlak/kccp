import { assertEquals } from "jsr:@std/assert@1";
import {
  buildUsageSnapshot,
  DEFAULT_GEMINI_DAILY_REQUEST_LIMIT,
  DEFAULT_OPENROUTER_DAILY_REQUEST_LIMIT,
  geminiUsageMetadata,
  openAiUsageMetadata,
  pacificDateKey,
  usageDay,
  utcDateKey,
} from "./usage.ts";
import { usageCatalogModels } from "./catalog.ts";

// UTC로는 이미 다음 날인데 태평양 시간으로는 아직 전날인 순간. 두 공급자의 리셋 시각이
// 갈리는 자리이고, 서버 시간으로 한 번에 자르면 여기서 한쪽이 틀린 칸에 들어간다.
const ACROSS_MIDNIGHT = new Date("2026-08-28T04:30:00Z");

Deno.test("날짜 칸은 공급자의 리셋 시간대에서 센다", () => {
  assertEquals(utcDateKey(ACROSS_MIDNIGHT), "2026-08-28");
  assertEquals(pacificDateKey(ACROSS_MIDNIGHT), "2026-08-27");
  assertEquals(usageDay("gemini", ACROSS_MIDNIGHT), "2026-08-27");
  assertEquals(usageDay("openrouter", ACROSS_MIDNIGHT), "2026-08-28");
});

Deno.test("Gemini 응답에서 토큰 수 — 못 읽으면 0이지 실패가 아니다", () => {
  assertEquals(
    geminiUsageMetadata(
      JSON.stringify({ usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5, totalTokenCount: 16 } }),
    ),
    { promptTokens: 11, outputTokens: 5, totalTokens: 16 },
  );
  assertEquals(geminiUsageMetadata("not json"), { promptTokens: 0, outputTokens: 0, totalTokens: 0 });
  assertEquals(geminiUsageMetadata("{}"), { promptTokens: 0, outputTokens: 0, totalTokens: 0 });
});

Deno.test("OpenAI 호환 응답에서 토큰 수", () => {
  assertEquals(
    openAiUsageMetadata(JSON.stringify({ usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })),
    { promptTokens: 7, outputTokens: 3, totalTokens: 10 },
  );
  assertEquals(openAiUsageMetadata(""), { promptTokens: 0, outputTokens: 0, totalTokens: 0 });
});

Deno.test("첫 요청 전에도 카탈로그의 모든 모델이 카드를 갖는다", () => {
  const snapshot = buildUsageSnapshot([], {}, ACROSS_MIDNIGHT);
  assertEquals(snapshot.models.length, usageCatalogModels().length);
  for (const card of snapshot.models) assertEquals(card.requests, 0);
});

Deno.test("오늘 줄은 카드를 덮고, 어제 줄은 무시된다", () => {
  const snapshot = buildUsageSnapshot(
    [
      // gemini의 '오늘'은 태평양 시간으로 27일이다.
      { day: "2026-08-27", provider: "gemini", model: "gemini-3.6-flash", requests: 9, successful_requests: 8, failed_requests: 1 },
      // 같은 날짜 문자열이지만 openrouter의 '오늘'은 28일 — 어제 것이라 접히지 않는다.
      { day: "2026-08-27", provider: "openrouter", model: "google/gemma-4-31b-it:free", requests: 40 },
    ],
    {},
    ACROSS_MIDNIGHT,
  );
  const gemini = snapshot.models.find((m) => m.model === "gemini-3.6-flash")!;
  assertEquals(gemini.requests, 9);
  assertEquals(gemini.successfulRequests, 8);
  assertEquals(gemini.limit, DEFAULT_GEMINI_DAILY_REQUEST_LIMIT);

  const gemma = snapshot.models.find((m) => m.model === "google/gemma-4-31b-it:free")!;
  assertEquals(gemma.requests, 0);
  assertEquals(gemma.limit, DEFAULT_OPENROUTER_DAILY_REQUEST_LIMIT);
});

Deno.test("모르는 공급자의 줄은 화면에 들어오지 않는다", () => {
  const snapshot = buildUsageSnapshot(
    [{ day: "2026-08-28", provider: "anthropic", model: "claude", requests: 99 }],
    {},
    ACROSS_MIDNIGHT,
  );
  assertEquals(snapshot.models.some((m) => m.model === "claude"), false);
});

Deno.test("한도는 환경 변수로 덮어쓸 수 있고, 못 쓸 값이면 기본값이 남는다", () => {
  const raised = buildUsageSnapshot([], { GEMINI_DAILY_REQUEST_LIMIT: "1000" }, ACROSS_MIDNIGHT);
  assertEquals(raised.models.find((m) => m.provider === "gemini")!.limit, 1000);
  const broken = buildUsageSnapshot([], { GEMINI_DAILY_REQUEST_LIMIT: "0" }, ACROSS_MIDNIGHT);
  assertEquals(broken.models.find((m) => m.provider === "gemini")!.limit, DEFAULT_GEMINI_DAILY_REQUEST_LIMIT);
});

Deno.test("정렬은 gemini 먼저, 그 안에서는 이름 순 — 화면이 흔들리지 않게", () => {
  const snapshot = buildUsageSnapshot([], {}, ACROSS_MIDNIGHT);
  const providers = snapshot.models.map((m) => m.provider);
  assertEquals(providers, [...providers].sort((a, b) => (a === b ? 0 : a === "gemini" ? -1 : 1)));
});

import { assertEquals } from "jsr:@std/assert@1";
import {
  DEFAULT_EXCLUDED_TITLES,
  isFreeVisionCatalogEntry,
  migrateEngineName,
  OPENROUTER_NEMOTRON_MODEL,
  RECOGNITION_MODEL_CATALOG,
  resolveOpenRouterRoute,
  sanitizeAttemptOrder,
  sanitizeExcludedTitles,
  sanitizeRoleOverrides,
  sanitizeSharedSettings,
  usageCatalogModels,
} from "./catalog.ts";

Deno.test("every OpenRouter route in the catalog ends in :free", () => {
  // 카탈로그가 곧 지갑의 경계다. 유료 슬러그가 하나라도 들어오면 공용 키가 그리로 나간다.
  for (const entry of RECOGNITION_MODEL_CATALOG) {
    assertEquals(isFreeVisionCatalogEntry(entry), true, entry.model);
  }
});

Deno.test("카탈로그 밖의 모델은 바꾸지 않고 거절한다", () => {
  assertEquals(resolveOpenRouterRoute("openai/gpt-4o"), null);
  assertEquals(resolveOpenRouterRoute(""), null);
  // 접미사 없는 Nemotron ID는 저장된 설정이 아직 들고 다니는 것 — 프록시가 :free를 붙인다.
  assertEquals(resolveOpenRouterRoute("nvidia/nemotron-nano-12b-v2-vl"), {
    configuredModel: "nvidia/nemotron-nano-12b-v2-vl",
    upstreamModel: OPENROUTER_NEMOTRON_MODEL,
  });
});

Deno.test("gemini 모델은 OpenRouter 경로로 새지 않는다", () => {
  assertEquals(resolveOpenRouterRoute("gemini-3.6-flash"), null);
});

Deno.test("엔진 이름 옮기기 — 옛 'nvidia' 갈래는 openrouter다", () => {
  assertEquals(migrateEngineName("nvidia"), "openrouter");
  assertEquals(migrateEngineName("openrouter"), "openrouter");
  assertEquals(migrateEngineName("gemini"), "gemini");
  assertEquals(migrateEngineName("anthropic"), undefined);
  assertEquals(migrateEngineName(null), undefined);
});

Deno.test("시도 순서는 저장된 것을 존중하되 카탈로그 밖은 버리고 빠진 것을 채운다", () => {
  const order = sanitizeAttemptOrder([
    { engine: "openrouter", model: "google/gemma-4-31b-it:free" },
    { engine: "openrouter", model: "openai/gpt-4o" }, // 카탈로그 밖 → 사라진다
    { engine: "gemini", model: "gemini-3.5-flash" },
  ]);
  assertEquals(order[0], { engine: "openrouter", model: "google/gemma-4-31b-it:free" });
  assertEquals(order[1], { engine: "gemini", model: "gemini-3.5-flash" });
  assertEquals(order.length, RECOGNITION_MODEL_CATALOG.length);
  assertEquals(order.some((a) => a.model === "openai/gpt-4o"), false);
});

Deno.test("문자열 하나가 그 엔진의 모델 전부를 뜻하던 옛 모양도 읽는다", () => {
  const order = sanitizeAttemptOrder(["nvidia"]);
  assertEquals(order[0].engine, "openrouter");
  assertEquals(order.length, RECOGNITION_MODEL_CATALOG.length);
});

Deno.test("제외 곡 목록 — 공백·대소문자를 무시해 중복을 지운다", () => {
  assertEquals(sanitizeExcludedTitles(["공동체 고백송", " 공동체고백송 ", ""]), ["공동체 고백송"]);
  assertEquals(sanitizeExcludedTitles(null), DEFAULT_EXCLUDED_TITLES);
  assertEquals(sanitizeExcludedTitles([1, {}, true]), []);
});

Deno.test("역할 덮어쓰기는 카탈로그 모델과 실재하는 역할만", () => {
  assertEquals(
    sanitizeRoleOverrides({
      "gemini:gemini-3.6-flash": "paused",
      "gemini:gemini-3.6-flash-nope": "paused",
      "openrouter:google/gemma-4-31b-it:free": "monarch",
    }),
    { "gemini:gemini-3.6-flash": "paused" },
  );
});

Deno.test("설정 전체를 씻으면 언제나 세 칸이 갖춰진 모양이 나온다", () => {
  const s = sanitizeSharedSettings(undefined);
  assertEquals(s.attempts.length, RECOGNITION_MODEL_CATALOG.length);
  assertEquals(s.excludedTitles, DEFAULT_EXCLUDED_TITLES);
  assertEquals(s.roleOverrides, {});
});

Deno.test("계량되는 이름은 프록시가 실제로 부르는 슬러그다", () => {
  const models = usageCatalogModels();
  assertEquals(models.some((m) => m.model === OPENROUTER_NEMOTRON_MODEL), true);
  // 접미사 없는 ID로 계량하면 같은 모델이 두 칸으로 갈린다.
  assertEquals(models.some((m) => m.model === "nvidia/nemotron-nano-12b-v2-vl"), false);
});

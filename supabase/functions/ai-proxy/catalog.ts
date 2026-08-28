// 인식 모델 카탈로그와 공유 설정의 순수 부분.
//
// ppt의 Worker(`worker/src/config.js`)에서 옮겨 온 것이고, 그쪽이 그랬듯 이 파일은
// 저장 위치를 모른다 — 그래서 단위 테스트가 붙는다. 저장은 index.ts가 config.slides_ai_settings
// 한 칸에 한다.
//
// **카탈로그가 곧 지갑의 경계다.** OpenRouter로 나가는 모든 경로는 `:free`로 끝나고,
// 카탈로그에 없는 모델은 다른 것으로 바꾸는 게 아니라 **거절한다** — 조용히 바꾸면 아무도
// 요청하지 않은 모델에 공용 키를 쓰고, 그 모델의 정확도를 다른 모델의 것으로 기록하게 된다.

export type Engine = "gemini" | "openrouter";
export type ModelRole = "champion" | "challenger" | "paused";

export interface CatalogEntry {
  engine: Engine;
  /** 저장된 설정과 화면이 쓰는 ID. */
  model: string;
  /** 프록시가 실제로 부르는 것. Nemotron만 둘이 다르다 (아래). */
  upstreamModel: string;
  role: Exclude<ModelRole, "paused">;
}

/** 기존 Nemotron 카탈로그 칸이 쓰는 OpenRouter 무료 변종. */
export const OPENROUTER_NEMOTRON_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";

// 각 칸은 시작 역할을 함께 선언한다: champion은 모든 쪽을 읽고, challenger는 champion들이
// 서로 다르게 읽은 쪽에만 불린다. 지금 가장 나은 무료 비전 모델만 여기 들어온다.
//
// `upstreamModel`이 `model`과 다른 것은 저장된 설정이 아직 들고 다니는 접미사 없는
// Nemotron ID 하나뿐이다.
export const RECOGNITION_MODEL_CATALOG: readonly CatalogEntry[] = [
  { engine: "gemini", model: "gemini-3.6-flash", upstreamModel: "gemini-3.6-flash", role: "champion" },
  { engine: "gemini", model: "gemini-3.5-flash", upstreamModel: "gemini-3.5-flash", role: "champion" },
  {
    engine: "openrouter",
    model: "nvidia/nemotron-nano-12b-v2-vl",
    upstreamModel: OPENROUTER_NEMOTRON_MODEL,
    role: "champion",
  },
  {
    engine: "openrouter",
    model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    upstreamModel: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    role: "challenger",
  },
  {
    engine: "openrouter",
    model: "dots-studio/dots-3-note-preview:free",
    upstreamModel: "dots-studio/dots-3-note-preview:free",
    role: "challenger",
  },
  {
    engine: "openrouter",
    model: "google/gemma-4-31b-it:free",
    upstreamModel: "google/gemma-4-31b-it:free",
    role: "challenger",
  },
];

export const DEFAULT_EXCLUDED_TITLES = ["공동체 고백송", "예배 전 준비 찬양"];

function attemptKey(a: { engine: Engine; model: string }): string {
  return `${a.engine}:${a.model}`;
}

/**
 * 저장된 설정의 엔진 이름을 지금 쓰는 이름으로. OpenRouter 갈래는 예전에 'nvidia'라
 * 불렸다 — 여기서 옮겨 주면 기기마다 캐시된 설정을 버리지 않아도 된다.
 */
export function migrateEngineName(value: unknown): Engine | undefined {
  if (value === "gemini") return "gemini";
  if (value === "openrouter" || value === "nvidia") return "openrouter";
  return undefined;
}

/** OpenRouter 칸인데 무료가 아닌 곳으로 가는 것이 아니면 참. */
export function isFreeVisionCatalogEntry(entry: CatalogEntry): boolean {
  return entry.engine !== "openrouter" || entry.upstreamModel.endsWith(":free");
}

export interface Attempt { engine: Engine; model: string }

/** 카탈로그에 있는 것만 남기고, 중복을 지우고, 빠진 카탈로그 모델을 뒤에 붙인다. */
export function sanitizeAttemptOrder(raw: unknown): Attempt[] {
  const seen = new Set<string>();
  const order: Attempt[] = [];
  const push = (a: { engine: Engine; model: string }) => {
    const key = attemptKey(a);
    if (seen.has(key)) return;
    seen.add(key);
    order.push({ engine: a.engine, model: a.model });
  };
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === "string") {
        const legacy = migrateEngineName(value);
        if (!legacy) continue;
        for (const entry of RECOGNITION_MODEL_CATALOG) if (entry.engine === legacy) push(entry);
        continue;
      }
      const v = value as { engine?: unknown; model?: unknown } | null;
      if (!v || typeof v.model !== "string") continue;
      const engine = migrateEngineName(v.engine);
      if (!engine) continue;
      const known = RECOGNITION_MODEL_CATALOG.find((e) => e.engine === engine && e.model === v.model);
      // 카탈로그에 없는 모델 — 유료 경로이거나 이 빌드가 더는 싣지 않는 것 — 은 다른 것으로
      // 바꾸지 않고 버린다.
      if (known && isFreeVisionCatalogEntry(known)) push(known);
    }
  }
  for (const entry of RECOGNITION_MODEL_CATALOG) push(entry);
  return order;
}

/** 비어 있지 않은 문자열만, 공백·대소문자를 무시해 중복을 지우고, 개수를 막는다. */
export function sanitizeExcludedTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_EXCLUDED_TITLES];
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const title = value.trim().slice(0, 100);
    if (!title) continue;
    const key = title.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= 100) break;
  }
  return titles;
}

/** 카탈로그 모델과 실재하는 역할을 가리키는 덮어쓰기만 남긴다. */
export function sanitizeRoleOverrides(raw: unknown): Record<string, ModelRole> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const roles: ModelRole[] = ["champion", "challenger", "paused"];
  const overrides: Record<string, ModelRole> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!roles.includes(value as ModelRole)) continue;
    if (RECOGNITION_MODEL_CATALOG.some((e) => attemptKey(e) === key)) overrides[key] = value as ModelRole;
  }
  return overrides;
}

export interface SharedSettings {
  attempts: Attempt[];
  excludedTitles: string[];
  roleOverrides: Record<string, ModelRole>;
}

export function sanitizeSharedSettings(raw: unknown): SharedSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    attempts: sanitizeAttemptOrder(obj.attempts),
    excludedTitles: sanitizeExcludedTitles(obj.excludedTitles),
    roleOverrides: sanitizeRoleOverrides(obj.roleOverrides),
  };
}

/**
 * 공유 키로 부를 수 있는 정확한 무료 상류 슬러그를 돌려주거나, 이 프록시가 값을 치르지
 * 않을 모델이면 null.
 *
 * 거절이 의도다: 조용히 다른 모델로 바꾸면 아무도 요청하지 않은 요청에 공용 키를 쓰고,
 * 정확도를 엉뚱한 모델의 것으로 기록하게 된다.
 */
export function resolveOpenRouterRoute(
  requested: string,
): { configuredModel: string; upstreamModel: string } | null {
  const known = RECOGNITION_MODEL_CATALOG.find(
    (e) => e.engine === "openrouter" && e.model === requested,
  );
  if (!known || !isFreeVisionCatalogEntry(known)) return null;
  return { configuredModel: known.model, upstreamModel: known.upstreamModel };
}

/**
 * 시스템의 모든 모델을, **계량되는 이름**의 {provider, model} 짝으로. 사용량 화면이
 * 첫 요청 전에도 모델마다 카드를 보일 수 있게 한다. OpenRouter 갈래는 프록시가 실제로
 * 부르는 `:free` 슬러그로 계량되므로 카탈로그 그 자체와는 다르다.
 */
export function usageCatalogModels(): { provider: string; model: string }[] {
  const models: { provider: string; model: string }[] = [];
  for (const entry of RECOGNITION_MODEL_CATALOG) {
    if (entry.engine === "gemini") models.push({ provider: "gemini", model: entry.model });
    else models.push({ provider: "openrouter", model: entry.upstreamModel });
  }
  return models;
}

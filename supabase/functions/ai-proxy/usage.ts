// 무료 한도를 세는 순수 부분 — 어느 날짜에 넣을지, 표의 줄들을 화면이 읽는 모양으로
// 어떻게 접을지. 저장은 index.ts가 public.ai_usage 에 한다.
//
// ppt의 Worker(`worker/src/usage.js`)에서 옮겨 왔고, Durable Object의 키-값 모양
// (`usage:provider:period:model`) 대신 표의 기본키 (day, provider, model)를 쓴다.
//
// 공급자 대시보드가 언제나 정본이다. 이 카운터가 있는 이유는 어느 API도 "남은 한도"를
// 옮겨 담을 수 있는 형태로 알려주지 않기 때문이다.

import { usageCatalogModels } from "./catalog.ts";

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";
export const DEFAULT_GEMINI_DAILY_REQUEST_LIMIT = 250;
export const DEFAULT_OPENROUTER_DAILY_REQUEST_LIMIT = 50;

export const PROVIDERS = new Set(["gemini", "openrouter"]);

/** 사용량 화면의 고정된 표시·정렬 순서. */
const PROVIDER_RANK: Record<string, number> = { gemini: 0, openrouter: 1 };

function finiteNonNegative(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Gemini의 RPD 한도가 리셋되는 태평양 시간의 달력 날짜. */
export function pacificDateKey(value: Date | string | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** OpenRouter의 하루치 무료 한도가 쓰는 UTC 달력 날짜. */
export function utcDateKey(value: Date | string | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

/**
 * 이 요청이 어느 날짜 칸에 들어가는가.
 *
 * 공급자마다 리셋 시각이 다르다는 것이 요점이다. 서버 시간으로 한 번에 자르면 둘 중
 * 하나는 반드시 틀린 칸에 들어가고, 그 어긋남은 자정 언저리에만 나타나 재현하기 어렵다.
 */
export function usageDay(provider: string, value: Date | string | number = new Date()): string {
  return provider === "gemini" ? pacificDateKey(value) : utcDateKey(value);
}

/** Gemini 응답 본문에서 토큰 수. 못 읽으면 0 — 계량이 프록시를 실패시키지 않는다. */
export function geminiUsageMetadata(responseBody: string) {
  try {
    const usage = (JSON.parse(responseBody)?.usageMetadata ?? {}) as Record<string, number>;
    return {
      promptTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0,
    };
  } catch {
    return { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
}

/** OpenAI 호환 chat-completions 응답 본문에서 토큰 수. */
export function openAiUsageMetadata(responseBody: string) {
  try {
    const usage = (JSON.parse(responseBody)?.usage ?? {}) as Record<string, number>;
    return {
      promptTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    };
  } catch {
    return { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
}

export interface UsageRow {
  day: string;
  provider: string;
  model: string;
  requests?: number;
  successful_requests?: number;
  failed_requests?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  updated_at?: string | null;
}

export interface UsageModelCard {
  provider: string;
  model: string;
  day: string;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  updatedAt: string | null;
  metric: "requests";
  used: number;
  limit: number;
}

export interface UsageSnapshot {
  generatedAt: string;
  source: string;
  models: UsageModelCard[];
}

/**
 * 오늘의 줄들을 화면이 읽는 모델 단위 모양으로.
 *
 * 카탈로그의 모든 모델이 **첫 요청 전에도** 카드를 갖는다. 없으면 사용량 화면이 "안 쓴
 * 모델"과 "설정에서 빠진 모델"을 구분해 보여 주지 못한다.
 */
export function buildUsageSnapshot(
  rows: UsageRow[] | null,
  env: Record<string, string | undefined> = {},
  now: Date = new Date(),
): UsageSnapshot {
  const geminiLimit = positiveNumber(env.GEMINI_DAILY_REQUEST_LIMIT, DEFAULT_GEMINI_DAILY_REQUEST_LIMIT);
  const openRouterLimit = positiveNumber(
    env.OPENROUTER_DAILY_REQUEST_LIMIT,
    DEFAULT_OPENROUTER_DAILY_REQUEST_LIMIT,
  );

  const pairs = [
    ...usageCatalogModels(),
    { provider: "gemini", model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL },
    { provider: "openrouter", model: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL },
  ].filter((p) => PROVIDERS.has(p.provider) && !!p.model);

  const byModel = new Map<string, UsageRow>();
  for (const pair of pairs) {
    const key = `${pair.provider}:${pair.model}`;
    if (byModel.has(key)) continue;
    byModel.set(key, { day: usageDay(pair.provider, now), provider: pair.provider, model: pair.model });
  }
  // 오늘 것만. 공급자마다 "오늘"이 다른 시간대에서 계산되므로 한 줄씩 확인한다.
  for (const row of rows ?? []) {
    if (!row || !PROVIDERS.has(row.provider)) continue;
    if (row.day !== usageDay(row.provider, now)) continue;
    byModel.set(`${row.provider}:${row.model}`, row);
  }

  const models = [...byModel.values()]
    .map((row): UsageModelCard => {
      const requests = finiteNonNegative(row.requests);
      return {
        provider: row.provider,
        model: row.model,
        day: row.day,
        requests,
        successfulRequests: finiteNonNegative(row.successful_requests),
        failedRequests: finiteNonNegative(row.failed_requests),
        promptTokens: finiteNonNegative(row.prompt_tokens),
        outputTokens: finiteNonNegative(row.output_tokens),
        totalTokens: finiteNonNegative(row.total_tokens),
        updatedAt: row.updated_at ?? null,
        metric: "requests",
        used: requests,
        limit: row.provider === "gemini" ? geminiLimit : openRouterLimit,
      };
    })
    .sort((a, b) => {
      if (a.provider !== b.provider) {
        return (PROVIDER_RANK[a.provider] ?? 9) - (PROVIDER_RANK[b.provider] ?? 9);
      }
      return a.model.localeCompare(b.model);
    });

  return { generatedAt: now.toISOString(), source: "ai-proxy", models };
}

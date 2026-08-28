import { getAiUsage } from './proxy';

export type UsageProvider = 'gemini' | 'openrouter' | 'nvidia';
export type UsageMetric = 'requests' | 'usd';

export interface ModelUsage {
  provider: UsageProvider;
  model: string;
  period: 'day' | 'month';
  periodKey: string;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  computeSeconds: number;
  providerMeasuredRequests: number;
  updatedAt: string | null;
  metric: UsageMetric;
  used: number;
  limit: number;
  estimated: boolean;
  usdPerSecond?: number;
}

export interface AiUsageSnapshot {
  generatedAt: string;
  source: 'shared-proxy';
  models: ModelUsage[];
}

/**
 * 프록시는 이제 **언제나 있다.**
 *
 * ppt에서는 VITE_RECOGNITION_PROXY_URL 이 비어 있을 수 있었고(정적 사이트라 프록시를
 * 붙이지 않고도 배포됐다), 그래서 이 물음이 필요했다. 합쳐진 앱에서 슬라이드 화면에
 * 들어왔다는 것은 이미 'slides' 영역을 가진 계정으로 로그인했다는 뜻이고, 그 자격이
 * 곧 프록시를 부를 자격이다.
 */
export function hasSharedUsageMonitor(): boolean {
  return true;
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function parseUsageSnapshot(raw: unknown): AiUsageSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error('사용량 응답 형식이 올바르지 않습니다.');
  const object = raw as Record<string, unknown>;
  if (!Array.isArray(object.models)) throw new Error('모델별 사용량이 응답에 없습니다.');
  const models: ModelUsage[] = object.models.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('모델 사용량 형식이 올바르지 않습니다.');
    const model = item as Record<string, unknown>;
    const provider = model.provider;
    const metric = model.metric;
    const period = model.period;
    if (
      provider !== 'gemini' &&
      provider !== 'openrouter' &&
      provider !== 'nvidia'
    )
      throw new Error('알 수 없는 AI 공급자입니다.');
    if (metric !== 'requests' && metric !== 'usd') throw new Error('알 수 없는 사용량 단위입니다.');
    if (period !== 'day' && period !== 'month') throw new Error('알 수 없는 사용량 기간입니다.');
    if (typeof model.model !== 'string' || !model.model.trim()) throw new Error('AI 모델명이 없습니다.');
    return {
      provider,
      model: model.model,
      period,
      periodKey: typeof model.periodKey === 'string' ? model.periodKey : '',
      requests: nonNegativeNumber(model.requests),
      successfulRequests: nonNegativeNumber(model.successfulRequests),
      failedRequests: nonNegativeNumber(model.failedRequests),
      promptTokens: nonNegativeNumber(model.promptTokens),
      outputTokens: nonNegativeNumber(model.outputTokens),
      totalTokens: nonNegativeNumber(model.totalTokens),
      computeSeconds: nonNegativeNumber(model.computeSeconds),
      providerMeasuredRequests: nonNegativeNumber(model.providerMeasuredRequests),
      updatedAt: typeof model.updatedAt === 'string' ? model.updatedAt : null,
      metric,
      used: nonNegativeNumber(model.used),
      limit: nonNegativeNumber(model.limit),
      estimated: model.estimated === true,
      usdPerSecond: model.usdPerSecond == null ? undefined : nonNegativeNumber(model.usdPerSecond),
    };
  });
  return {
    generatedAt: typeof object.generatedAt === 'string' ? object.generatedAt : new Date().toISOString(),
    source: 'shared-proxy',
    models,
  };
}

/**
 * 오늘의 무료 한도 사용량. 전송은 proxy.ts 가 맡는다 — 자격을 싣는 규칙(구글 토큰, 부)이
 * 한 곳에만 있어야 뒤처지는 쪽이 생기지 않는다.
 *
 * `parseUsageSnapshot` 은 그대로 남는다: 서버가 모양을 바꿔도 화면이 먼저 무너지지 않게
 * 하는 자리이고, 그 검사는 전송이 무엇이든 필요하다.
 */
export async function fetchAiUsage(): Promise<AiUsageSnapshot> {
  try {
    return parseUsageSnapshot(await getAiUsage());
  } catch (error) {
    throw new Error(
      `AI 사용량을 불러오지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

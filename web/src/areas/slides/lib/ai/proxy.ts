// 슬라이드 인식이 상류 모델과 이야기하는 유일한 통로.
//
// ppt에서는 Cloudflare Worker의 주소를 직접 불렀고, 그 앱은 로그인이 없었으므로 배포된
// 페이지를 연 누구나 교회의 AI 무료 한도를 쓸 수 있었다. 여기서는 자격이 실려 나가고,
// 서버가 `/api/slides/` 접두사로 슬라이드 영역을 요구한다 — 출석 비밀번호로는 이 경로가
// 열리지 않는다.
//
// **키는 여기 없다.** 브라우저는 어느 모델을 부를지만 말하고, 키를 붙이는 것도 무료
// 카탈로그 밖의 모델을 거절하는 것도 프록시가 한다.
import { AI_BASE, apiAt, authHeaders } from '../../../../lib/api'

export type Engine = 'gemini' | 'openrouter'
export type ModelRole = 'champion' | 'challenger' | 'paused'

export interface Attempt { engine: Engine; model: string }

/** 프록시가 씻어서 돌려주는 공유 설정 — 카탈로그 밖의 모델은 여기 없다. */
export interface SharedSettings {
  attempts: Attempt[]
  excludedTitles: string[]
  /**
   * 카탈로그 모델 중 역할이 덮어써진 것만 담긴다. Partial 인 것이 정확하다 —
   * `Record<string, ModelRole>` 은 아무 문자열에나 역할이 있다고 주장하고, 그러면
   * 찾지 못한 키가 undefined 가 아니라 ModelRole 로 읽힌다.
   */
  roleOverrides: Partial<Record<string, ModelRole>>
}

export interface UsageModelCard {
  provider: string
  model: string
  day: string
  requests: number
  successfulRequests: number
  failedRequests: number
  promptTokens: number
  outputTokens: number
  totalTokens: number
  updatedAt: string | null
  metric: 'requests'
  used: number
  limit: number
}

export interface UsageSnapshot {
  generatedAt: string
  source: string
  models: UsageModelCard[]
}

// 악보 한 쪽을 읽는 데 상류가 20초 넘게 쓰는 일이 실제로 있다. 기본 12초로는 성공할
// 요청을 우리 쪽에서 끊는다.
const RECOGNITION_TIMEOUT_MS = 60_000

/**
 * Gemini generateContent 를 프록시를 거쳐 부른다. 본문과 응답 모두 상류의 모양 그대로다 —
 * 프록시가 모양을 고치기 시작하면 모델이 바뀔 때마다 두 곳을 함께 고쳐야 한다.
 */
export function callGemini<T = unknown>(model: string, body: unknown): Promise<T> {
  return apiAt<T>(
    AI_BASE,
    'POST',
    `/api/slides/ai/gemini/${encodeURIComponent(model)}`,
    body,
    undefined,
    RECOGNITION_TIMEOUT_MS,
  )
}

/**
 * OpenAI 호환 chat-completions 를 프록시를 거쳐. `model`은 **카탈로그의 ID**이고,
 * 프록시가 그것을 정확한 `:free` 슬러그로 옮긴다. 카탈로그 밖이면 400이 온다 —
 * 조용히 다른 모델로 바뀌지 않는다.
 */
export function callOpenRouter<T = unknown>(body: { model: string } & Record<string, unknown>): Promise<T> {
  return apiAt<T>(AI_BASE, 'POST', '/api/slides/ai/openrouter', body, undefined, RECOGNITION_TIMEOUT_MS)
}

export function getAiUsage(): Promise<UsageSnapshot> {
  return apiAt<UsageSnapshot>(AI_BASE, 'GET', '/api/slides/ai/usage')
}

export function getSharedSettings(): Promise<SharedSettings> {
  return apiAt<SharedSettings>(AI_BASE, 'GET', '/api/slides/ai/settings')
}

/** 최고관리자·소유자만 쓸 수 있다 (프록시가 막는다). 미디어 역할 계정은 읽기만. */
export function saveSharedSettings(settings: SharedSettings): Promise<SharedSettings> {
  return apiAt<SharedSettings>(AI_BASE, 'POST', '/api/slides/ai/settings', settings)
}

/**
 * 프록시로 던지고 **Response 를 그대로** 돌려준다. `apiAt` 은 비-2xx 를 던지고 JSON을
 * 풀어 주지만, 인식은 상태 코드 자체에 다르게 반응한다 — 429는 오늘 한도가 찬 것이라
 * 다른 모델로 넘어가야 하고, 500은 그 모델이 이 쪽을 못 읽은 것이라 다시 시도한다.
 */
export function aiProxyPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${AI_BASE}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

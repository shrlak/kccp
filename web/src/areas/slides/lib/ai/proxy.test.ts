import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_BASE, setAdminPassword, setAdminToken } from '../../../../lib/api'
import { callGemini, callOpenRouter, getAiUsage } from './proxy'

function mockFetch(status = 200, body: unknown = {}) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('slides AI proxy client', () => {
  beforeEach(() => {
    setAdminToken(null)
    setAdminPassword(null)
    vi.unstubAllGlobals()
  })

  it('AI_BASE는 출석 함수가 아니라 ai-proxy를 가리킨다', () => {
    // 같은 프로젝트의 다른 함수다. 여기가 틀리면 프록시 경로가 출석 함수로 가서
    // areaOf가 'attend'로 판정하고, 미디어 계정이 401을 받는다.
    expect(AI_BASE).toMatch(/\/ai-proxy$/)
    expect(AI_BASE).not.toMatch(/attendance-api/)
  })

  it('모든 경로가 /api/slides/ 아래다 — 그 접두사가 곧 영역 판정이다', async () => {
    const spy = mockFetch(200, { models: [] })
    setAdminToken('jwt')
    await getAiUsage()
    await callOpenRouter({ model: 'nvidia/nemotron-nano-12b-v2-vl' })
    for (const [url] of spy.mock.calls) {
      expect(String(url).startsWith(`${AI_BASE}/api/slides/`)).toBe(true)
    }
  })

  it('구글 토큰을 실어 보낸다 — 슬라이드는 계정으로만 열린다', async () => {
    const spy = mockFetch(200, {})
    setAdminToken('jwt-abc')
    await callGemini('gemini-3.6-flash', { contents: [] })
    expect(spy.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-abc')
  })

  it('슬래시가 든 모델 이름은 경로에서 인코딩된다', async () => {
    const spy = mockFetch(200, {})
    setAdminToken('jwt')
    await callGemini('nvidia/nemotron', {})
    expect(String(spy.mock.calls[0][0])).toBe(
      `${AI_BASE}/api/slides/ai/gemini/nvidia%2Fnemotron`,
    )
  })

  it('카탈로그 밖 모델의 400은 프록시가 준 문구 그대로 올라온다', async () => {
    mockFetch(400, { error: 'model not allowed: openai/gpt-4o' })
    setAdminToken('jwt')
    await expect(callOpenRouter({ model: 'openai/gpt-4o' })).rejects.toThrow(
      'model not allowed: openai/gpt-4o',
    )
  })
})

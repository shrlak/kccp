import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recognizeConti } from './recognizeConti'
import type { ContiDocument } from './utils/contiPdf'
import type { Song } from './utils/types'

vi.mock('./ai/aiSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai/aiSettings')>()),
  // 공유 설정은 프록시에서 온다 — 이 테스트가 묻는 것은 곡과 악보를 잇는 규칙이다.
  getSyncedAiSettings: async () => (await importOriginal<typeof import('./ai/aiSettings')>()).getAiSettings(),
}))

const recognizeScoreBatch = vi.hoisted(() => vi.fn())
vi.mock('./ai/scoreRecognition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai/scoreRecognition')>()),
  recognizeScoreBatch,
}))

function doc(renderPage = vi.fn(async (n: number) => `data:image/jpeg;base64,PAGE${n}`)): ContiDocument {
  return { renderPage, parsed: { info: { songs: [] }, numPages: 9, pageTexts: [], musicPages: [] } } as unknown as ContiDocument
}

const song = (over: Partial<Song>): Song => ({
  id: 's', title: '', sections: [], order: [], linesPerSlide: 4, ...over,
})

describe('recognizeConti', () => {
  beforeEach(() => recognizeScoreBatch.mockReset())

  it('표지가 쪽을 짚어 준 곡만 읽는다 — 무료 한도를 곡이 아닌 악보에 쓰지 않는다', async () => {
    const render = vi.fn(async (n: number) => `data:image/jpeg;base64,PAGE${n}`)
    recognizeScoreBatch.mockResolvedValue({ scores: [{ title: '주 은혜임을', sections: [], order: [] }], engine: 'gemini', observations: [], confidence: [0.9] })

    await recognizeConti(doc(render), [
      song({ id: 'a', title: '주 은혜임을', pageIndex: 3 }),
      song({ id: 'b', title: '쪽을 모르는 곡' }),
    ])

    expect(render).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledWith(3)
  })

  it('쪽을 모르는 곡이 뒤를 밀지 않는다 — 결과는 원래 자리에 얹힌다', async () => {
    recognizeScoreBatch.mockResolvedValue({
      scores: [{ title: '읽어 낸 제목', sections: [{ label: 'V1', lines: ['가사'] }], order: ['V1'] }],
      engine: 'gemini', observations: [], confidence: [0.9],
    })

    const out = await recognizeConti(doc(), [
      song({ id: 'a', title: '쪽 없음' }),
      song({ id: 'b', title: '', pageIndex: 5 }),
    ])

    // 순서대로 짝지었다면 첫째 곡이 덮였을 것이다.
    expect(out.songs[0].title).toBe('쪽 없음')
    expect(out.songs[1].sections[0].lines).toEqual(['가사'])
    expect(out.recognizedPages).toBe(1)
  })

  it('읽을 악보가 하나도 없으면 상류를 부르지 않는다', async () => {
    const out = await recognizeConti(doc(), [song({ id: 'a', title: '곡' })])
    expect(recognizeScoreBatch).not.toHaveBeenCalled()
    expect(out.recognizedPages).toBe(0)
  })

  it('자신 없어 한 곡을 이름으로 돌려준다 — 사람이 그것부터 본다', async () => {
    recognizeScoreBatch.mockResolvedValue({
      scores: [
        { title: '확실한 곡', sections: [{ label: 'V1', lines: ['가'] }], order: ['V1'] },
        { title: '흐릿한 곡', sections: [{ label: 'V1', lines: ['나'] }], order: ['V1'] },
      ],
      engine: 'gemini', observations: [], confidence: [0.95, 0.2],
    })

    const out = await recognizeConti(doc(), [
      song({ id: 'a', title: '', pageIndex: 2 }),
      song({ id: 'b', title: '', pageIndex: 4 }),
    ])
    expect(out.lowConfidence).toEqual(['흐릿한 곡'])
  })

  it('빈 답은 곡을 덮지 않는다', async () => {
    recognizeScoreBatch.mockResolvedValue({
      scores: [{ title: '', sections: [], order: [] }], engine: 'gemini', observations: [], confidence: [0.9],
    })
    const out = await recognizeConti(doc(), [song({ id: 'a', title: '사람이 적은 제목', pageIndex: 2 })])
    expect(out.songs[0].title).toBe('사람이 적은 제목')
    expect(out.recognizedPages).toBe(0)
  })
})

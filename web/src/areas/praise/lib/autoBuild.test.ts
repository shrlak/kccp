// 콘티 한 장으로 진짜 덱을 끝까지 만들어 본다.
//
// 인식만 갈아 끼운다 (상류 모델을 부르지 않으려고). 나머지는 전부 진짜다 — 진짜
// 템플릿으로 진짜 .pptx 가 나오고, 그 안에 무엇이 어느 순서로 들어갔는지를 센다.
// **인도자가 누르는 버튼 하나가 덮는 길이 이것이고**, 여기서 조용히 어긋나는 것이
// 주일 아침에 드러나는 것들이다.
import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { slideAsset } from '../../slides/__fixtures__/slideAssets'
import type { SlideAssets } from '../../slides/lib/buildDeck'
import type { ContiDocument } from '../../slides/lib/utils/contiPdf'
import type { ContiInfo, Song } from '../../slides/lib/utils/types'
import { autoBuildDeck } from './autoBuild'

const assets: SlideAssets = {
  load: async (name) => {
    const bytes = slideAsset(name)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  },
  // 성경 본문(27 MB)은 아직 옮기지 않았다 — 그래서 이 테스트의 콘티는 본문을 비운다.
  bibleBase: 'unused://',
}

/** 번들 라이브러리를 못 받는 상태. 그러면 back 덱이 받은 그대로 나간다. */
function noLibrary() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
}

function conti(info: ContiInfo): ContiDocument {
  return {
    parsed: { info, numPages: 3, pageTexts: [], musicPages: [2, 3] },
    renderPage: async () => 'data:image/png;base64,AAAA',
    destroy: () => {},
  }
}

const cover: ContiInfo = {
  date: '9/20/26',
  sermonTitle: '주와 함께',
  songs: [
    { title: '주 은혜임을', pageIndex: 2 },
    { title: 'Celebrate the Light' },
    { title: '축복하노라', pageIndex: 3 },
  ],
}

/** 인식이 성공한 척 — 가사를 채워서 돌려준다. */
const fakeRecognize = (filled: Record<string, string[]>) =>
  vi.fn(async (_doc: ContiDocument, songs: Song[]) => ({
    songs: songs.map((song) =>
      filled[song.title]
        ? { ...song, sections: [{ label: 'V1', lines: filled[song.title] }], order: ['V1'] }
        : song,
    ),
    recognizedPages: Object.keys(filled).length,
    lowConfidence: [] as string[],
  }))

async function deckText(deck: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(deck)
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
  return (await Promise.all(slides.map((f) => zip.file(f)!.async('string')))).join('\n')
}

describe('autoBuildDeck', () => {
  it('콘티 한 장으로 끝까지 간다 — 인도자가 고르는 것이 없다', async () => {
    noLibrary()
    const recognize = fakeRecognize({
      '주 은혜임을': ['내가 살아가는 것', '주의 은혜임을'],
      '축복하노라': ['축복하노라 주의 이름으로'],
    })
    const seen: string[] = []
    const out = await autoBuildDeck(conti(cover), {
      assets,
      baseUrl: '/',
      recognize,
      onStatus: (s) => seen.push(s.phase),
    })

    expect(recognize).toHaveBeenCalledOnce()
    // 콘티가 적어 둔 것은 다시 묻지 않는다.
    expect(out.contiDate).toBe('9/20/26')
    expect(out.sermonTitle).toBe('주와 함께')
    // 진행은 읽기 → 인식 → 조립 → 끝 순서로 한 번씩 지나간다.
    expect(seen[0]).toBe('read')
    expect(seen).toContain('recognize')
    expect(seen[seen.length - 1]).toBe('done')

    const text = await deckText(out.deck.merged)
    expect(text).toContain('내가 살아가는 것')
    expect(text).toContain('축복하노라')
  }, 120_000)

  it('공동체 고백송은 슬라이드를 만들지 않는다 — back 덱에 이미 있다', async () => {
    noLibrary()
    const out = await autoBuildDeck(conti(cover), { assets, baseUrl: '/', recognize: fakeRecognize({}) })
    expect(out.songs.map((s) => s.title)).toEqual(['주 은혜임을', '축복하노라'])
  }, 120_000)

  it('고백송 다음 곡은 설교 뒤로 간다 — 여는 찬양이 아니다', async () => {
    noLibrary()
    const out = await autoBuildDeck(conti(cover), { assets, baseUrl: '/', recognize: fakeRecognize({}) })
    expect(out.songs.find((s) => s.title === '축복하노라')?.postSermon).toBe(true)
    expect(out.songs.find((s) => s.title === '주 은혜임을')?.postSermon).toBeUndefined()

    // 그 곡과 뒤따르는 기도는 예배 순서의 한 칸이라, 기도가 셋이 된다.
    const kinds = out.deck.overview.map((o) => o.kind)
    expect(kinds.filter((k) => k === 'prayer')).toHaveLength(3)
  }, 120_000)

  it('인식이 실패해도 덱은 나온다 — 토요일 밤에 아무것도 없이 남기지 않는다', async () => {
    noLibrary()
    const out = await autoBuildDeck(conti(cover), {
      assets,
      baseUrl: '/',
      recognize: vi.fn(async () => {
        throw new Error('오늘 한도가 찼습니다')
      }),
    })
    expect(out.recognitionError).toBe('오늘 한도가 찼습니다')
    expect(out.recognizedPages).toBe(0)
    expect(out.deck.overview.length).toBeGreaterThan(0)
    // 가사가 비어 있는 곡은 전부 「확인해 주세요」로 올라온다 — 조용히 빈 슬라이드가
    // 나가는 것이 이 화면에서 가장 나쁜 실패다.
    expect(out.needsReview).toEqual(['주 은혜임을', '축복하노라'])
  }, 120_000)

  it('읽긴 읽었지만 비어 있는 곡도 확인 목록에 올라온다', async () => {
    noLibrary()
    const out = await autoBuildDeck(conti(cover), {
      assets,
      baseUrl: '/',
      recognize: fakeRecognize({ '주 은혜임을': ['내가 살아가는 것'] }),
    })
    expect(out.needsReview).toEqual(['축복하노라'])
  }, 120_000)

  it('악보 쪽이 하나도 없으면 인식을 부르지 않는다 — 무료 한도를 그냥 쓰지 않는다', async () => {
    noLibrary()
    const recognize = fakeRecognize({})
    const out = await autoBuildDeck(conti({ songs: [{ title: '주 은혜임을' }] }), {
      assets,
      baseUrl: '/',
      recognize,
    })
    expect(recognize).not.toHaveBeenCalled()
    expect(out.deck.overview.length).toBeGreaterThan(0)
  }, 120_000)
})

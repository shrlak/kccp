// 진짜 템플릿으로 진짜 덱을 만들어 본다.
//
// 「이번 주 콘티로 0901.pptx를 만들어 지금 ppt 앱이 만든 것과 열어서 비교한다」의
// 자동화된 절반이다. 사람이 열어 보는 비교는 대신할 수 없지만, **무엇이 몇 장씩 어느
// 순서로 들어갔는지**는 여기서 붙잡을 수 있고 그것이 이관에서 조용히 어긋나는 부분이다.
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { slideAsset } from '../__fixtures__/slideAssets'
import { buildDeck, hasAnyContent, type DeckInput, type SlideAssets } from './buildDeck'
import type { DeckOverviewKind } from './utils/deckOverview'
import type { Song } from './utils/types'

const assets: SlideAssets = {
  load: async (name) => {
    const bytes = slideAsset(name)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  },
  // 성경 본문(27 MB)은 아직 옮기지 않았다 — 그래서 이 테스트는 말씀 구간을 비운다.
  bibleBase: 'unused://',
}

const song = (over: Partial<Song> = {}): Song => ({
  id: 's1',
  title: '주 은혜임을',
  sections: [
    { label: 'V1', lines: ['내가 살아가는 것', '주의 은혜임을'] },
    { label: 'C', lines: ['오 주님', '감사합니다'] },
  ],
  order: ['V1', 'C'],
  linesPerSlide: 4,
  ...over,
})

const emptyInput = (): DeckInput => ({
  songs: [],
  bible: { verseInput: '', sermonTitle: '', translations: [], versesPerSlide: 2 },
  announcementText: '',
  additionalFiles: [],
})

async function slideCount(deck: Uint8Array): Promise<number> {
  const zip = await JSZip.loadAsync(deck)
  return Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length
}

describe('buildDeck', () => {
  it('아무것도 없어도 front · 기도 둘 · back 은 나온다 — 예배의 뼈대다', async () => {
    const { merged, overview } = await buildDeck(emptyInput(), assets)

    // 장 수와 개요가 1:1이어야 한다. 어긋나면 편집기 보기의 썸네일이 다른 장을 가리킨다.
    expect(overview.length).toBe(await slideCount(merged))
    expect(overview.filter((o) => o.kind === 'prayer').length).toBe(2)
    expect(overview[0].kind).toBe('front')
    expect(overview[overview.length - 1].kind).toBe('back')
  }, 60_000)

  it('순서가 곧 예배 순서다 — front → 찬양 → 기도 → 광고 → back', async () => {
    const input: DeckInput = {
      ...emptyInput(),
      songs: [song()],
      announcementText: '1. <여름 수련회>\n8월 30일 토요일\n2. <새가족 환영>\n예배 후 친교실',
    }
    const { merged, overview } = await buildDeck(input, assets)
    expect(overview.length).toBe(await slideCount(merged))

    const kinds = overview.map((o) => o.kind)
    const firstOf = (k: DeckOverviewKind) => kinds.indexOf(k)
    expect(firstOf('front')).toBe(0)
    expect(firstOf('lyrics-title')).toBeGreaterThan(firstOf('front'))
    expect(firstOf('prayer')).toBeGreaterThan(firstOf('lyrics-title'))
    expect(firstOf('announcement')).toBeGreaterThan(firstOf('prayer'))
    expect(firstOf('back')).toBeGreaterThan(firstOf('announcement'))
  }, 60_000)

  it('광고 두 건이면 광고 장이 둘이고, 제목이 그대로 붙는다', async () => {
    const { overview } = await buildDeck(
      { ...emptyInput(), announcementText: '1. <여름 수련회>\n8월 30일\n2. <새가족 환영>\n예배 후' },
      assets,
    )
    const ads = overview.filter((o) => o.kind === 'announcement')
    expect(ads.map((a) => a.label)).toEqual(['여름 수련회', '새가족 환영'])
  }, 60_000)

  it('설교 PPTX는 그대로 들어가고, 그 장 수만큼 개요가 는다', async () => {
    const sermonBytes = slideAsset('front-slides.pptx')
    const sermonBuffer = sermonBytes.buffer.slice(
      sermonBytes.byteOffset,
      sermonBytes.byteOffset + sermonBytes.byteLength,
    ) as ArrayBuffer

    const withSermon = await buildDeck(
      { ...emptyInput(), sermonDeck: { name: '2026-08-30 말씀.pptx', data: sermonBuffer } },
      assets,
    )
    const withoutSermon = await buildDeck(emptyInput(), assets)

    const sermonSlides = withSermon.overview.filter((o) => o.kind === 'sermon')
    expect(sermonSlides.length).toBeGreaterThan(0)
    expect(withSermon.overview.length).toBe(withoutSermon.overview.length + sermonSlides.length)
    expect(sermonSlides[0].subtitle).toBe('2026-08-30 말씀.pptx')
    expect(withSermon.overview.length).toBe(await slideCount(withSermon.merged))
  }, 90_000)

  it('완성된 덱은 PowerPoint가 열 수 있는 모양이다', async () => {
    // assertPptxIntegrity가 buildDeck 안에서 던지므로, 여기까지 오면 통과한 것이다 —
    // 그 검사가 잡는 것이 곧 "복구가 필요합니다" 대화상자다.
    const { merged } = await buildDeck({ ...emptyInput(), songs: [song()] }, assets)
    const zip = await JSZip.loadAsync(merged)
    expect(zip.file('[Content_Types].xml')).not.toBeNull()
    expect(zip.file('ppt/presentation.xml')).not.toBeNull()
  }, 60_000)
})

describe('hasAnyContent', () => {
  it('빈 입력은 빈 입력이다 — 뼈대만 있는 덱을 실수로 내려받게 두지 않는다', () => {
    expect(hasAnyContent(emptyInput())).toBe(false)
  })

  it('다섯 가지 중 하나만 있어도 참이다', () => {
    expect(hasAnyContent({ ...emptyInput(), songs: [song()] })).toBe(true)
    expect(hasAnyContent({ ...emptyInput(), announcementText: '1. <광고>\n내용' })).toBe(true)
    expect(
      hasAnyContent({
        ...emptyInput(),
        bible: { verseInput: '요한복음 3:16', sermonTitle: '', translations: ['nkrv'], versesPerSlide: 2 },
      }),
    ).toBe(true)
  })
})

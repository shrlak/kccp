// 한 주의 예배 슬라이드를 조립하는 곳 — 마법사의 심장.
//
// ppt에서는 이 파이프라인이 App.tsx 안에, 여섯 단계의 화면 상태와 뒤엉켜 있었다. 여기서는
// 떼어 낸다: 들어가는 것은 그 주의 내용(곡·말씀·설교·광고·추가 자료)뿐이고, 나오는 것은
// 완성된 .pptx 바이트와 그 안에 무엇이 몇 장씩 들어갔는지다. 화면을 모르므로 **테스트가
// 진짜 템플릿으로 진짜 덱을 만들어 볼 수 있고**, 그것이 이 이관의 안전장치다 — 두 곳에서
// 같은 주를 만들어 열어 비교하는 기간 동안 이쪽이 무엇을 만들었는지 코드가 말해 준다.
//
// **순서가 곧 예배 순서다.** front → 찬양 → 기도 → 말씀 → 설교 → 기도 → 설교 후 찬양 →
// 기도 → 광고 → back → 추가 자료. 이 순서를 바꾸는 것은 리팩터링이 아니라 예배를 바꾸는
// 일이다.
import { convertAdditionalFile } from './additionalFiles/convert'
import type { AdditionalFile } from './additionalFiles/types'
import { buildBiblePptx } from '../bible/pptxBuilder'
import { loadTranslation } from '../bible/bibleData'
import { normalizeContiScripture, parseVerseInput } from '../bible/refParser'
import { buildVerseSlidePlan } from '../bible/versePlanner'
import { applyConfessionSong } from './pptx/confessionSlides'
import { inspectDeckBytes } from './pptx/deckInspect'
import { buildPptx } from './pptx/pptxBuilder'
import { mergePptxDecks } from './pptx/pptxMerge'
import { assertPptxIntegrity } from './pptx/pptxPackage'
import { extractSlideSubset } from './pptx/pptxSlices'
import { buildAnnouncementDeck, parseAnnouncements } from './utils/announcementBuilder'
import { expandDeckSegment, songOverviewItems, type DeckOverviewItem } from './utils/deckOverview'
import type { Song } from './utils/types'

/**
 * service-template.pptx 안에서 재사용하는 슬라이드의 **1-based 위치**. 템플릿을 새로
 * 받으면 여기가 함께 움직여야 한다 — 어긋나면 기도 자리에 광고가 나오고, 그것은 주일
 * 아침 화면에서 드러난다.
 */
export const SERVICE_SLIDES = {
  prayer1: [17],
  prayer2: [31],
  // 설교 후 찬양과 광고 사이의 기도. 템플릿은 예배 순서의 기도마다 한 장을 싣는데 이
  // 둘은 같은 장이라 번호가 같다 — 같은 값이 두 번 적힌 것이 아니라, **예배 순서에서
  // 다른 자리**다.
  prayer3: [31],
  announcementTitle: [32],
  announcementItemTemplate: 33,
} as const

/** 슬라이드 자산이 사는 곳. web/public/slides/ 아래이고, base 경로를 탄다. */
export const SLIDE_ASSET_PREFIX = 'slides/'

export interface BibleInput {
  /** 사람이 적은 그대로의 구절 (콘티에서 읽어 온 표기도 여기 들어온다). */
  verseInput: string
  sermonTitle: string
  /** 최대 두 개. 셋을 넘기면 한 슬라이드에 들어가지 않는다. */
  translations: string[]
  versesPerSlide: number
  /** 이번 한 번만 쓰는 성경 템플릿. 그 주의 내용이 아니라 세션의 덮어쓰기다. */
  customTemplate?: ArrayBuffer
}

export interface DeckInput {
  songs: Song[]
  bible: BibleInput
  /** 목사님 PPTX — 그대로 삽입한다. */
  sermonDeck?: { name: string; data: ArrayBuffer }
  /** 번호 매긴 목록. 비어 있으면 광고 구간이 통째로 빠진다. */
  announcementText: string
  additionalFiles: AdditionalFile[]
  /** 관리자가 갈아 끼운 front/back. 없으면 번들된 것을 쓴다. */
  customFront?: ArrayBuffer
  customBack?: ArrayBuffer
  /**
   * 이번 주의 공동체 고백송 — **가사까지** 담긴 곡이다.
   *
   * 그 곡의 가사 슬라이드는 back 덱 **안에** 있으므로, 이것이 오면 그 블록을 제자리에서
   * 고쳐 쓴다 (덱을 쪼갰다 붙이지 않는다 — back 덱은 3 MB이고 대부분이 미디어라 그렇게
   * 하면 마스터·레이아웃·미디어가 통째로 복제된다).
   *
   * 없으면 back 덱을 **받은 그대로** 둔다. 제목만 있고 가사가 없는 경우를 여기까지
   * 들여보내지 않는 이유가 그것이다: 빈 곡으로 고쳐 쓰면 주일 아침에 빈 슬라이드가
   * 나온다. 그 판단은 `lookupConfessionSong`이 부르는 쪽에서 한다.
   */
  confessionSong?: Song | null
}

export interface BuiltDeck {
  merged: Uint8Array
  /**
   * 실제로 병합된 순서 그대로의 장 목록. 추정이 아니라 `inspectDeckBytes`로 센 값이라,
   * 편집기 보기가 붙었을 때 썸네일과 1:1로 맞는다.
   */
  overview: DeckOverviewItem[]
}

/**
 * 자산을 어디서 가져오는가. 브라우저는 fetch로, 테스트는 디스크에서 준다.
 *
 * 성경 본문이 따로인 이유: `loadTranslation`은 접두사를 받아 자기가 `bible-text/…`를
 * 붙이고 **직접 fetch 한다.** 로더를 통과시키면 4-5 MB짜리 JSON이 ArrayBuffer로 한 번
 * 더 복사되고, 번역본 둘이면 그 복사가 두 번이다.
 */
export interface SlideAssets {
  /** public/slides/ 아래의 pptx 템플릿. */
  load: (name: string) => Promise<ArrayBuffer>
  /** loadTranslation에 그대로 넘어가는 접두사 (끝에 / 를 포함한다). */
  bibleBase: string
}

/** 브라우저의 기본 자산 — base 경로 아래에서 받는다. */
export function browserSlideAssets(baseUrl: string): SlideAssets {
  return {
    async load(name) {
      const res = await fetch(`${baseUrl}${SLIDE_ASSET_PREFIX}${name}`)
      if (!res.ok) throw new Error(`${name} 을(를) 불러오지 못했습니다.`)
      return res.arrayBuffer()
    },
    bibleBase: baseUrl,
  }
}

/** 입력에 슬라이드가 될 만한 것이 하나라도 있는가. */
export function hasAnyContent(input: DeckInput): boolean {
  return (
    input.songs.length > 0 ||
    parseVerseInput(normalizeContiScripture(input.bible.verseInput)).refs.length > 0 ||
    !!input.sermonDeck ||
    parseAnnouncements(input.announcementText).length > 0 ||
    input.additionalFiles.length > 0
  )
}

/**
 * 예배 슬라이드 한 벌.
 *
 * 압축에 대하여: 중간 병합은 전부 STORE다. 조각을 붙일 때마다 다시 압축하면 같은 바이트를
 * 여러 번 압축하게 되고, 그 비용이 이 함수에서 가장 큰 부분이 된다. **마지막 병합 하나만**
 * DEFLATE로 눌러 파일 크기를 줄인다 — 뒤에 추가 자료가 붙으면 그 마지막이 뒤로 밀린다.
 */
export async function buildDeck(input: DeckInput, assets: SlideAssets): Promise<BuiltDeck> {
  const [serviceTemplate, frontSlides, backSource] = await Promise.all([
    assets.load('service-template.pptx'),
    input.customFront ?? assets.load('front-slides.pptx'),
    input.customBack ?? assets.load('back-slides.pptx'),
  ])

  // back 덱은 공동체 고백송을 **스스로 찍는다.** 이번 주의 곡으로 그 블록을 고쳐 써서,
  // 누가 .pptx를 손으로 열지 않아도 이번 시즌의 고백송이 고정 슬라이드에 실리게 한다.
  // 이미 그 곡이 적혀 있거나 고칠 곡이 없으면 `applied`가 false이고, 그때는 받은
  // 바이트를 그대로 쓴다.
  const confession = input.confessionSong
    ? await applyConfessionSong(backSource, input.confessionSong)
    : null
  const backSlides = confession?.applied ? confession.data : backSource

  const overview: DeckOverviewItem[] = []
  let merged: Uint8Array = new Uint8Array(frontSlides)
  const frontCount = (await inspectDeckBytes(frontSlides)).slideCount
  overview.push(
    ...expandDeckSegment({ kind: 'front', count: frontCount, labelAt: (i, count) => `Front ${i + 1}/${count}` }),
  )

  // **설교 후 찬양은 예배 순서에서 다른 자리에 있다.** 같은 템플릿으로 만들되, 여는
  // 찬양이 아니라 설교 뒤의 기도 다음에 끼워 넣는다 (아래).
  const praiseSongs = input.songs.filter((song) => !song.postSermon)
  const postSermonSongs = input.songs.filter((song) => song.postSermon)
  const loadLyricsTemplate = () => assets.load('template.pptx')

  if (praiseSongs.length > 0) {
    merged = await mergePptxDecks(merged, await buildPptx(await loadLyricsTemplate(), praiseSongs), 'STORE')
    overview.push(...praiseSongs.flatMap((s) => songOverviewItems(s)))
  }

  merged = await mergePptxDecks(merged, await extractSlideSubset(serviceTemplate, [...SERVICE_SLIDES.prayer1]), 'STORE')
  overview.push(...expandDeckSegment({ kind: 'prayer', count: SERVICE_SLIDES.prayer1.length, labelAt: () => '기도' }))

  // parseVerseInput은 읽어 낸 구절과 **읽지 못한 토큰**을 함께 돌려준다. 여기서는 읽어
  // 낸 것만 쓴다 — 못 읽은 토큰을 사람에게 보여 주는 것은 화면의 일이고, 조립은 그것
  // 때문에 멈추지 않는다.
  const { refs: bibleRefs } = parseVerseInput(normalizeContiScripture(input.bible.verseInput))
  if (bibleRefs.length > 0) {
    // 번역본은 **실제로 고른 것만** 받는다. 여섯 개가 27 MB이고, 무심코 전부 받으면
    // 그 무게가 첫 화면으로 딸려 온다 (그래서 정적 import가 아니라 이 fetch다).
    const bibles = new Map()
    for (const id of input.bible.translations) {
      bibles.set(id, await loadTranslation(assets.bibleBase, id))
    }
    const plan = buildVerseSlidePlan(
      bibleRefs,
      input.bible.translations,
      bibles,
      input.bible.sermonTitle,
      input.bible.versesPerSlide,
    )
    const bibleTemplate = input.bible.customTemplate ?? (await assets.load('bible-template.pptx'))
    const bibleDeck = await buildBiblePptx(bibleTemplate, plan)
    merged = await mergePptxDecks(merged, bibleDeck, 'STORE')
    const bibleCount = (await inspectDeckBytes(bibleDeck.buffer as ArrayBuffer)).slideCount
    overview.push(
      ...expandDeckSegment({ kind: 'bible', count: bibleCount, labelAt: (i, count) => `말씀 ${i + 1}/${count}` }),
    )
  }

  if (input.sermonDeck) {
    merged = await mergePptxDecks(merged, input.sermonDeck.data, 'STORE')
    const sermonCount = (await inspectDeckBytes(input.sermonDeck.data)).slideCount
    overview.push(
      ...expandDeckSegment({
        kind: 'sermon',
        count: sermonCount,
        labelAt: (i, count) => `설교 ${i + 1}/${count}`,
        subtitleAt: () => input.sermonDeck!.name,
      }),
    )
  }

  merged = await mergePptxDecks(merged, await extractSlideSubset(serviceTemplate, [...SERVICE_SLIDES.prayer2]), 'STORE')
  overview.push(...expandDeckSegment({ kind: 'prayer', count: SERVICE_SLIDES.prayer2.length, labelAt: () => '기도' }))

  // 설교 후 찬양 — 설교 뒤의 기도와 광고 앞의 기도 사이다. 그 곡과 뒤따르는 기도는 예배
  // 순서의 **한 칸**이라, 설교 후 찬양이 없는 주에는 둘을 함께 건너뛴다 — 따로 두면
  // 기도 슬라이드가 연달아 두 장 나온다.
  if (postSermonSongs.length > 0) {
    merged = await mergePptxDecks(merged, await buildPptx(await loadLyricsTemplate(), postSermonSongs), 'STORE')
    overview.push(...postSermonSongs.flatMap((s) => songOverviewItems(s)))
    merged = await mergePptxDecks(merged, await extractSlideSubset(serviceTemplate, [...SERVICE_SLIDES.prayer3]), 'STORE')
    overview.push(...expandDeckSegment({ kind: 'prayer', count: SERVICE_SLIDES.prayer3.length, labelAt: () => '기도' }))
  }

  const announcementItems = parseAnnouncements(input.announcementText)
  if (announcementItems.length > 0) {
    merged = await mergePptxDecks(
      merged,
      await extractSlideSubset(serviceTemplate, [...SERVICE_SLIDES.announcementTitle]),
      'STORE',
    )
    overview.push(
      ...expandDeckSegment({
        kind: 'divider',
        count: SERVICE_SLIDES.announcementTitle.length,
        labelAt: () => '광고',
      }),
    )
    merged = await mergePptxDecks(
      merged,
      await buildAnnouncementDeck(serviceTemplate, SERVICE_SLIDES.announcementItemTemplate, announcementItems),
      'STORE',
    )
    overview.push(
      ...announcementItems.map((item, i) => ({
        id: `announcement-${i}`,
        kind: 'announcement' as const,
        label: item.title.trim() || `광고 ${i + 1}`,
        subtitle: item.bodyLines[0],
      })),
    )
  }

  // 마무리 덱은 언제나 들어가고 언제나 광고 뒤다.
  merged = await mergePptxDecks(merged, backSlides, input.additionalFiles.length > 0 ? 'STORE' : 'DEFLATE')
  const backCount = (await inspectDeckBytes(backSlides)).slideCount
  overview.push(...expandDeckSegment({ kind: 'back', count: backCount, labelAt: (i, count) => `Back ${i + 1}/${count}` }))

  let imageTemplate: ArrayBuffer | null = null
  if (input.additionalFiles.some((file) => file.kind !== 'pptx')) {
    imageTemplate = await assets.load('template.pptx')
  }
  for (const [fileIndex, file] of input.additionalFiles.entries()) {
    const converted = await convertAdditionalFile(file, imageTemplate ?? new Uint8Array())
    merged = await mergePptxDecks(
      merged,
      converted.deck,
      fileIndex === input.additionalFiles.length - 1 ? 'DEFLATE' : 'STORE',
    )
    overview.push(
      ...Array.from({ length: converted.slideCount }, (_, slideIndex) => ({
        id: `additional-${file.id}-${slideIndex}`,
        kind: 'additional' as const,
        label: file.name,
        subtitle: `${slideIndex + 1}/${converted.slideCount}`,
      })),
    )
  }

  // 마지막에 한 번 전체를 본다. 여기서 걸리는 것은 PowerPoint가 "복구가 필요합니다"로
  // 보여 주는 그것이고, 그 자리는 주일 아침이다.
  await assertPptxIntegrity(merged)
  return { merged, overview }
}

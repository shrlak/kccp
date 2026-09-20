// 콘티 한 장 → 완성된 예배 슬라이드. 인도자가 누르는 버튼 하나 뒤에 있는 전부다.
//
// ── 왜 한 함수인가 ───────────────────────────────────────────────────────────────────
// 미디어팀의 마법사는 여섯 단계다. 그 단계들이 있는 이유는 **고칠 수 있어야 하기**
// 때문이다 — 설교 PPT를 끼우고, 광고를 적고, 번역본을 고른다. 인도자에게는 그 물음이
// 하나도 해당하지 않는다: 인도자가 아는 것은 콘티뿐이고, 그 콘티 안에 이미 곡·본문·설교
// 제목이 적혀 있다.
//
// 그래서 여기서는 단계가 없다. 콘티를 받아 **끝까지 간다.** 화면이 하는 일은 진행 상황을
// 보여 주는 것과, 다 되면 내려받게 해 주는 것뿐이다.
//
// ── 어디서 멈추지 않는가 ─────────────────────────────────────────────────────────────
// **인식이 실패해도 덱은 나온다.** 가사를 못 읽은 곡은 제목만 든 빈 슬라이드가 되고,
// 화면이 그 곡들의 이름을 적어 준다. 여기서 던지면 인도자는 토요일 밤에 아무것도 없이
// 남고, 그 주의 슬라이드는 결국 미디어팀이 처음부터 만든다 — 없애려던 그 일이다.
import { browserSlideAssets, buildDeck, type BuiltDeck, type SlideAssets } from '../../slides/lib/buildDeck'
import { songsFromConti } from '../../slides/lib/contiSongs'
import { recognizeConti, type RecognitionStatus } from '../../slides/lib/recognizeConti'
import { lookupConfessionSong } from '../../slides/lib/utils/confessionSong'
import type { ContiDocument } from '../../slides/lib/utils/contiPdf'
import type { Song } from '../../slides/lib/utils/types'

export type AutoPhase = 'read' | 'recognize' | 'build' | 'done'

export interface AutoStatus {
  phase: AutoPhase
  /** 0–1. 대략적인 눈금이지 정확한 비율이 아니다. */
  progress: number
  message: string
}

export interface AutoBuildResult {
  deck: BuiltDeck
  songs: Song[]
  /** 콘티가 적어 둔 예배 날짜 — 사람이 적은 모양 그대로 ("8/30/26"). */
  contiDate?: string
  scripture?: string
  sermonTitle?: string
  /** 실제로 가사를 읽어 낸 악보 쪽 수. 0이면 사람에게 그렇게 말해야 한다. */
  recognizedPages: number
  /** 모델이 자신 없어 한 곡 + 가사가 끝내 비어 있는 곡. 화면이 이것부터 보여 준다. */
  needsReview: string[]
  /** 인식이 통째로 실패했을 때의 이유. 덱은 그래도 나온다. */
  recognitionError?: string
}

/** 기본 번역본. 마법사의 기본값과 같다 — 인도자에게 묻지 않는 값이므로 같아야 한다. */
const TRANSLATIONS = ['nkrv', 'esv']
const VERSES_PER_SLIDE = 2

export interface AutoBuildOptions {
  assets?: SlideAssets
  /** `slides/` · `bible-text/` 자산의 접두사. 기본은 이 배포의 base 경로. */
  baseUrl?: string
  onStatus?: (status: AutoStatus) => void
  /** 갈아 끼울 수 있게 열어 둔 자리 — 테스트가 상류 모델 없이 이 길을 걷는다. */
  recognize?: typeof recognizeConti
}

/** 가사가 한 줄도 없는 곡. 인식이 아예 닿지 못한 곡이 여기 걸린다. */
function isBlank(song: Song): boolean {
  return !song.sections.some((section) => section.lines.some((line) => line.trim()))
}

export async function autoBuildDeck(
  doc: ContiDocument,
  options: AutoBuildOptions = {},
): Promise<AutoBuildResult> {
  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL ?? '/'
  const assets = options.assets ?? browserSlideAssets(baseUrl)
  const recognize = options.recognize ?? recognizeConti
  const say = (status: AutoStatus) => options.onStatus?.(status)

  say({ phase: 'read', progress: 0.05, message: '콘티를 읽는 중…' })
  const info = doc.parsed.info
  const initial = songsFromConti(info.songs)

  let songs = initial
  let recognizedPages = 0
  let lowConfidence: string[] = []
  let recognitionError: string | undefined

  if (initial.some((song) => typeof song.pageIndex === 'number')) {
    // 부르기 **전에** 한 번 말한다. 인식은 이 길에서 가장 오래 걸리는 칸이라(모델이
    // 여럿이고 악보 한 쪽에 20초가 넘는 일도 있다), 첫 눈금이 인식 쪽에서 오기를
    // 기다리면 그동안 막대가 멈춰 있는 것처럼 보인다 — 멈춘 막대는 다시 누르게 한다.
    say({ phase: 'recognize', progress: 0.1, message: '악보에서 가사를 읽는 중…' })
    try {
      // 인식의 눈금을 전체의 0.1–0.8 구간에 얹는다. 인도자가 보는 것은 하나의 진행
      // 막대이지 두 개가 아니다.
      const out = await recognize(doc, initial, (status: RecognitionStatus) =>
        say({
          phase: 'recognize',
          progress: 0.1 + status.progress * 0.7,
          message: status.message,
        }),
      )
      songs = out.songs
      recognizedPages = out.recognizedPages
      lowConfidence = out.lowConfidence
    } catch (e) {
      // 여기서 멈추지 않는 이유는 위에 적어 두었다.
      recognitionError = e instanceof Error ? e.message : String(e)
    }
  }

  say({ phase: 'build', progress: 0.85, message: '슬라이드를 만드는 중…' })
  // 공동체 고백송은 그 주의 입력이 아니라 **이번 시즌의 설정**이다. 제목은 관리자 설정에,
  // 가사는 곡 라이브러리에 있고, 가사를 못 찾으면 back 덱이 받은 그대로 나간다.
  const confession = await lookupConfessionSong(baseUrl)

  const deck = await buildDeck(
    {
      songs,
      bible: {
        // 콘티가 본문과 설교 제목을 들고 있으면 그대로 쓴다. 인도자에게 다시 물으면
        // 옮겨 적게 되고, 옮겨 적는 자리가 곧 오타가 나는 자리다.
        verseInput: info.scripture ?? '',
        sermonTitle: info.sermonTitle ?? '',
        translations: TRANSLATIONS,
        versesPerSlide: VERSES_PER_SLIDE,
      },
      // 설교 PPT와 광고·추가 자료는 인도자가 가진 것이 아니다. 미디어팀이 그 주에
      // 덧붙이고, 그래서 buildDeck 이 그 구간을 통째로 건너뛴다.
      announcementText: '',
      additionalFiles: [],
      confessionSong: confession.song,
    },
    assets,
  )

  const needsReview = [
    ...new Set([
      ...lowConfidence,
      ...songs.filter(isBlank).map((song) => song.title || '제목 없는 곡'),
    ]),
  ]
  say({ phase: 'done', progress: 1, message: `${deck.overview.length}장을 만들었습니다.` })

  return {
    deck,
    songs,
    contiDate: info.date,
    scripture: info.scripture,
    sermonTitle: info.sermonTitle,
    recognizedPages,
    needsReview,
    ...(recognitionError ? { recognitionError } : {}),
  }
}

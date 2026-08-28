// 콘티 PDF의 악보 쪽에서 가사를 읽어 낸다 — 화면과 인식 라이브러리 사이의 한 줄.
//
// ppt에서는 이 흐름이 LyricsGenerator.tsx(1,841줄) 안에 화면 상태와 섞여 있었다. 여기서는
// buildDeck 과 같은 규칙을 쓴다: 들어가는 것은 콘티 문서와 곡 목록, 나오는 것은 가사가
// 채워진 곡 목록. 화면을 모르므로 진행 상황만 콜백으로 알린다.
//
// **키는 브라우저에 없다.** 실제 호출은 전부 ai-proxy 를 지나고, 그 경로가 `/api/slides/`
// 아래라 'slides' 영역을 가진 계정만 부를 수 있다 — 교회의 AI 무료 한도를 쓰는 일이
// 회수할 수 있는 자격 뒤에 있다는 뜻이다.
import { getSyncedAiSettings } from './ai/aiSettings'
import { applyScoreToSong, recognizeScoreBatch } from './ai/scoreRecognition'
import type { ContiDocument } from './utils/contiPdf'
import type { Song } from './utils/types'

/** 인식이 어디까지 왔는지. 화면이 그대로 보여 준다. */
export interface RecognitionStatus {
  phase: 'render' | 'recognize' | 'done'
  /** 0–1. 대략적인 눈금이지 정확한 비율이 아니다. */
  progress: number
  message: string
}

export interface RecognizeContiResult {
  songs: Song[]
  /** 실제로 읽어 낸 쪽 수 — 0이면 사람에게 그렇게 말해야 한다. */
  recognizedPages: number
  /** 모델이 자신 없어 한 곡. 화면이 "확인해 주세요"로 표시할 자리. */
  lowConfidence: string[]
}

/** 이 아래면 사람이 한 번 봐야 한다. ppt의 값을 그대로 가져왔다. */
const REVIEW_THRESHOLD = 0.55

/**
 * 악보 쪽을 이미지로 만들어 한 번에 인식하고, 그 결과를 곡에 얹는다.
 *
 * 곡과 쪽을 잇는 것은 `song.pageIndex` 다 — 콘티 표지가 곡 순서를 적어 두고
 * `matchSongsToPages` 가 그것을 쪽 번호에 붙여 준다. 그 연결이 없는 곡은 건너뛴다:
 * 순서대로 짝지으면 표지에 없는 악보 한 장 때문에 그 뒤가 전부 한 칸씩 밀린다.
 */
export async function recognizeConti(
  doc: ContiDocument,
  songs: Song[],
  onStatus?: (status: RecognitionStatus) => void,
): Promise<RecognizeContiResult> {
  const say = (s: RecognitionStatus) => onStatus?.(s)

  // 표지가 짚어 준 쪽만 읽는다. musicPages 전부를 읽으면 곡이 아닌 악보(특송 등)까지
  // 무료 한도를 쓴다.
  const targets = songs
    .map((song, index) => ({ song, index, page: song.pageIndex }))
    .filter((t): t is { song: Song; index: number; page: number } => typeof t.page === 'number')

  if (targets.length === 0) return { songs, recognizedPages: 0, lowConfidence: [] }

  say({ phase: 'render', progress: 0.05, message: '악보를 이미지로 만드는 중…' })
  const images: string[] = []
  for (const [i, target] of targets.entries()) {
    images.push(await doc.renderPage(target.page))
    say({
      phase: 'render',
      progress: 0.05 + (0.25 * (i + 1)) / targets.length,
      message: `악보를 이미지로 만드는 중… ${i + 1}/${targets.length}`,
    })
  }

  say({ phase: 'recognize', progress: 0.35, message: '가사를 읽는 중… (모델이 여럿이라 조금 걸립니다)' })
  const settings = await getSyncedAiSettings()
  // 표지의 곡 제목을 힌트로 준다. 강제가 아니라 참고라, 모델이 다르게 읽으면 모델을 따른다 —
  // 표지가 줄임말을 쓰는 일이 흔하기 때문이다.
  const hints = targets.map((t) => t.song.title || undefined)
  const batch = await recognizeScoreBatch(images, settings, 'full', hints)

  const next = [...songs]
  const lowConfidence: string[] = []
  let recognizedPages = 0
  batch.scores.forEach((score, i) => {
    const target = targets[i]
    if (!score || (score.sections.length === 0 && !score.title)) return
    recognizedPages += 1
    next[target.index] = applyScoreToSong(next[target.index], score)
    if ((batch.confidence[i] ?? 1) < REVIEW_THRESHOLD) {
      lowConfidence.push(next[target.index].title || `${target.page}쪽`)
    }
  })

  say({ phase: 'done', progress: 1, message: `${recognizedPages}곡을 읽었습니다.` })
  return { songs: next, recognizedPages, lowConfidence }
}

// 이미 확인된 가사를 다시 쓸 수 있는가 — 그 판단 하나.
//
// `lib/storage/library.ts`(Worker + localStorage 동기화)에서 갈라 왔다. 셋 다 메모리
// 위의 배열만 보는 순수 함수인데, 저장 코드 옆에 살고 있어서 인식 쪽이 그것 하나 때문에
// Worker 라이브러리 전체를 물고 있었다 — 02번의 `normalizeTitle`과 정확히 같은 모양이다.
//
// 배열이 어디서 오는지는 이 파일이 모른다. 지금은 Worker의 `/libraries/lyrics`가 주고,
// 나중에는 `songs`·`song_sections` 표가 준다. 그 이관은 되돌릴 수 없는 유일한 단계라
// (미디어팀이 두 주 연속 KCCP만으로 만든 뒤에 온다) 여기서는 손대지 않는다.
import { normalizeTitle } from '../utils/titles'
import type { LibraryEntry, SongIdentity, VerificationState } from '../utils/types'

const VERIFICATION_STATES: VerificationState[] = ['draft', 'verified', 'edited']

/**
 * 이 항목의 신뢰 수준. `verification` 칸이 생기기 전에 저장된 것들은 사람이 직접 담은
 * 것이므로 `verified`로 읽는다 — 기본값을 `draft`로 두면 옛 라이브러리 전체가 하루아침에
 * 기계의 추측으로 강등된다.
 */
export function entryVerification(entry: LibraryEntry): VerificationState {
  return VERIFICATION_STATES.includes(entry.verification as VerificationState)
    ? (entry.verification as VerificationState)
    : 'verified'
}

/** 사람이 뒤에 서 준 값인가. */
export function isGroundTruth(entry: LibraryEntry): boolean {
  return entryVerification(entry) !== 'draft'
}

/**
 * 페이지를 다시 인식하는 **대신** 쓸 수 있는 저장된 항목.
 *
 * 사람이 확인한 것만 자격이 있다: draft 는 기계의 추측이고, 그것을 재사용하면 한 번의
 * 나쁜 읽기가 영구히 굳는다. 아티스트가 양쪽 다 알려져 있으면 그것도 맞아야 한다 —
 * 제목이 같은 다른 곡이 서로 섞이지 않게. 같은 조건이면 가장 높은 버전이 이긴다.
 */
export function selectReusableEntry(
  entries: LibraryEntry[],
  identity: SongIdentity,
): LibraryEntry | undefined {
  const wantedTitle = normalizeTitle(identity.title ?? '')
  if (!wantedTitle) return undefined
  const wantedArtist = identity.artist ? normalizeTitle(identity.artist) : ''
  return entries
    .filter((candidate) => isGroundTruth(candidate))
    .filter((candidate) => normalizeTitle(candidate.title) === wantedTitle)
    .filter(
      (candidate) =>
        !wantedArtist || !candidate.artist || normalizeTitle(candidate.artist) === wantedArtist,
    )
    .sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0]
}

/** `selectReusableEntry`의 옛 이름. 부르는 쪽이 둘 다 쓰고 있어 남겨 둔다. */
export const findReusableEntry = selectReusableEntry

// ── 번들된 곡 라이브러리 ────────────────────────────────────────────────────────────
// `library.json` — 사이트와 함께 나가는 읽기 전용 시작 라이브러리다. ppt에서는 이것이
// `lib/storage/library.ts`의 위쪽 절반이었고, 아래쪽 절반(localStorage의 "이 브라우저의
// 사본" + Worker 동기화)은 **여기 오지 않는다**: 계정이 생기면 사본은 하나다.
//
// 그래서 `mergeLibraries`도 `loadUserLibrary`도 없다. 읽는 곳이 하나뿐이면 합칠 것도 없고,
// 합치는 코드가 곧 두 사본이 어긋나는 자리다.

const MAX_LYRIC_SECTIONS = 50
const MAX_LYRIC_LINES = 500

function trimmedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

/**
 * 저장된 항목 하나를 곡으로 읽는다. 곡이 아니면 null.
 *
 * `verification` 칸이 없던 시절의 항목은 `verified`로 올린다 — 사람이 직접 담은 것들이고,
 * 그것이 이 값의 뜻이다 (`entryVerification`과 같은 이유).
 */
export function sanitizeLibraryEntry(raw: unknown): LibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const title = trimmedString(obj.title, 200)
  if (!title || !normalizeTitle(title) || !Array.isArray(obj.sections)) return null

  let lineCount = 0
  const sections: { label: string; lines: string[] }[] = []
  for (const candidate of obj.sections.slice(0, MAX_LYRIC_SECTIONS)) {
    if (!candidate || typeof candidate !== 'object') continue
    const record = candidate as Record<string, unknown>
    if (!Array.isArray(record.lines)) continue
    const label = trimmedString(record.label, 30)
    if (!label) continue
    const lines: string[] = []
    for (const value of record.lines) {
      if (lineCount >= MAX_LYRIC_LINES) break
      if (typeof value !== 'string') continue
      lines.push(value.slice(0, 500))
      lineCount += 1
    }
    sections.push({ label, lines })
    if (lineCount >= MAX_LYRIC_LINES) break
  }

  const order = Array.isArray(obj.order)
    ? obj.order.map((value) => trimmedString(value, 30)).filter(Boolean).slice(0, 500)
    : []
  const artist = trimmedString(obj.artist, 200)
  const key = trimmedString(obj.key, 20)
  const rawVersion = Number(obj.version)
  const version = Number.isSafeInteger(rawVersion) && rawVersion >= 1 ? rawVersion : 1

  return {
    title,
    ...(artist ? { artist } : {}),
    ...(key ? { key } : {}),
    sections,
    order,
    verification: entryVerification(obj as unknown as LibraryEntry),
    version,
  }
}

export function sanitizeLibraryEntries(raw: unknown): LibraryEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeLibraryEntry).filter((entry): entry is LibraryEntry => entry !== null)
}

/**
 * 번들된 라이브러리. 다른 슬라이드 자산과 같은 자리(`slides/`)에 산다 — 선캐시에서
 * 빠지는 접두사가 그것 하나이기 때문이다 (`sw.ts`의 `globIgnores`).
 *
 * 못 받아도 던지지 않는다: 라이브러리가 없으면 공동체 고백송이 back 덱에 적힌 그대로
 * 남을 뿐, 덱 조립이 멈출 이유는 없다.
 */
export async function fetchBundledLibrary(baseUrl: string): Promise<LibraryEntry[]> {
  try {
    const res = await fetch(`${baseUrl}slides/library.json`)
    if (!res.ok) return []
    return sanitizeLibraryEntries(await res.json())
  } catch {
    return []
  }
}

/**
 * 그 제목의 항목, 없으면 undefined.
 *
 * 제목은 정규화해서 비교하므로 띄어쓰기·대소문자·문장부호는 뜻이 없다 — 그러나 **낱말은
 * 뜻이 있다.** 비슷한 이름은 다른 곡이다: "주 은혜임을"이 "주 은혜임을 아네"로 답하면
 * 그 화면에 없던 가사가 화면에 오른다.
 */
export function findEntry(library: LibraryEntry[], title: string): LibraryEntry | undefined {
  const want = normalizeTitle(title)
  if (!want) return undefined
  return library.find((e) => normalizeTitle(e.title) === want)
}

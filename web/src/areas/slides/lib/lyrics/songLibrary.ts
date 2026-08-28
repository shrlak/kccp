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

// 콘티 표지의 곡 목록 → 그 주에 슬라이드를 만들 곡들.
//
// 두 화면이 이것을 쓴다: 미디어팀의 마법사(찬양 단계)와 찬양팀 인도자의 자동 제작.
// **한 곳에 두는 이유는 규칙이 하나이기 때문이다** — 두 벌이 되면 한쪽이 공동체 고백송을
// 빼고 다른 쪽은 넣는 주가 오고, 그 차이는 주일 아침 화면에서 드러난다.
import { splitLyricsAndConfessionSongs } from './utils/contiText'
import type { ContiSongEntry, Song } from './utils/types'

let nextId = 1

/** 빈 곡 하나. 파트는 V1 한 칸으로 시작한다 — 가사는 인식이나 사람이 채운다. */
export function emptySong(title = ''): Song {
  return {
    id: `song-${nextId++}`,
    title,
    sections: [{ label: 'V1', lines: [''] }],
    order: ['V1'],
    // 템플릿의 기본값. 넘기면 가사가 슬라이드 밖으로 흐른다.
    linesPerSlide: 4,
  }
}

/**
 * 표지에서 읽은 것을 그 주의 곡 목록으로. 가사는 아직 비어 있다 — 제목·키와, 그 곡의
 * 악보가 몇 쪽인지(`pageIndex`)까지다. **그 쪽 번호가 인식이 곡과 악보를 잇는 유일한
 * 끈이다**: 순서대로 짝지으면 표지에 없는 악보 한 장 때문에 그 뒤가 전부 한 칸씩 밀린다.
 *
 * 표지의 목록이 그대로 찬양 목록이 되지는 않는다:
 *
 * - **공동체 고백송은 빠진다.** 그 곡의 가사 슬라이드는 back 덱 안에 이미 있고, 여기서
 *   또 만들면 같은 곡이 두 번 나간다.
 * - **그 바로 다음 곡은 설교 후 찬양이다.** 여는 찬양이 아니라 설교 뒤로 가도록 표를
 *   달아 둔다 (조립 순서는 `buildDeck`).
 */
export function songsFromConti(entries: ContiSongEntry[]): Song[] {
  const { lyricsSongs, postSermonSong } = splitLyricsAndConfessionSongs(entries)
  return lyricsSongs.map((entry) => ({
    ...emptySong(entry.title),
    key: entry.key,
    pageIndex: entry.pageIndex,
    ...(entry === postSermonSong ? { postSermon: true } : {}),
  }))
}

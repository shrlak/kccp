// Resolving the 공동체 고백송 — the song whose lyric slides live inside the
// fixed back-slides deck.
//
// 관리자 설정 stores only the TITLE (shared across every device via the
// proxy); the lyrics themselves come from the 곡 라이브러리, so the confession
// song is edited, corrected and saved exactly like every other song instead
// of being typed a second time into the settings.
import { getSyncedAiSettings } from '../ai/aiSettings';
import { fetchBundledLibrary, findEntry } from '../lyrics/songLibrary';
import { planSlides } from './slidePlanner';
import type { LibraryEntry, Song } from './types';

/** A library entry as the song the slide planner works on. */
export function songFromLibraryEntry(entry: LibraryEntry, id = 'confession-song'): Song {
  return {
    id,
    title: entry.title,
    ...(entry.key ? { key: entry.key } : {}),
    sections: structuredClone(entry.sections),
    order: [...entry.order],
    linesPerSlide: 4,
    ...(entry.verification ? { verification: entry.verification } : {}),
  };
}

export interface ConfessionSongLookup {
  /** The configured title. Empty means "leave the back slides as supplied". */
  title: string;
  /** The song to print, or null when the library has no lyrics under that title. */
  song: Song | null;
  /** Lyric slides it would fill (the marker slide is not counted). */
  slideCount: number;
}

/**
 * Look up this season's 공동체 고백송.
 *
 * ppt는 번들 라이브러리와 **이 브라우저의 사본**(localStorage)을 합쳐 읽었다. 여기서는
 * 번들 하나뿐이다 — 로그인이 생기면서 사본이 하나가 됐기 때문이고, 합치는 코드가 곧 두
 * 사본이 어긋나는 자리였다.
 *
 * 가사가 없는 제목은 `song: null`로 떨어진다. 그러면 back 덱은 **받은 그대로** 남는다 —
 * 빈 곡으로 고쳐 쓰면 주일 아침에 빈 슬라이드가 나온다.
 */
export async function lookupConfessionSong(
  baseUrl: string,
  title?: string,
): Promise<ConfessionSongLookup> {
  const wanted = (title ?? (await getSyncedAiSettings()).confessionSong).trim();
  if (!wanted) return { title: '', song: null, slideCount: 0 };

  const entry = findEntry(await fetchBundledLibrary(baseUrl), wanted);
  if (!entry) return { title: wanted, song: null, slideCount: 0 };

  const song = songFromLibraryEntry(entry);
  const slideCount = planSlides(song).filter((plan) => plan.kind === 'lyrics').length;
  return { title: wanted, song: slideCount > 0 ? song : null, slideCount };
}

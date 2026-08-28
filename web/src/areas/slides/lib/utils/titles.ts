/**
 * 제목 비교의 한 가지 기준.
 *
 * `lib/storage/library.ts`(Worker에 묶인 라이브러리)에서 그대로 들고 왔다. 순수
 * 함수인데 Worker 옆에 살고 있어서, 옮겨 온 순수 코드 셋이 그것 하나 때문에
 * Worker 라이브러리를 끌고 올 뻔했다. storage/ 는 Supabase Storage로 다시 지어질
 * 것이므로(04), 여기가 이 함수의 최종 집이다.
 */

/** Lowercase and strip everything but letters, digits and Hangul, for title comparison. */
export function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^0-9a-zㄱ-ㆎ가-힣]+/g, '');
}

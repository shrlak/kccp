// 테스트가 읽는 슬라이드 정적 자산 — web/public/slides/ 의 진짜 템플릿들이다.
//
// 경로를 한 곳에 모아 둔다. ppt에서는 tests/ 가 저장소 뿌리 바로 아래라 어느
// 테스트에서든 join(__dirname, '..', 'public', …) 이면 됐지만, 여기서는 테스트가
// 소스 옆에 흩어져 살아서 파일마다 '..' 개수가 달라진다 — 옮길 때마다 세어야 하는
// 종류의 값이고, 세다가 틀리면 ENOENT 하나로 끝난다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** web/public/slides/ — 이 파일에서 네 칸 위가 web/ 이다. */
const SLIDES = join(__dirname, '..', '..', '..', '..', 'public', 'slides');

/**
 * back-slides.pptx 는 저장소에 없다. assets/pptx/back-slides/*.b64 를
 * scripts/assemble-pptx-assets.mjs 가 복원하고, package.json 의 pretest 가
 * 테스트 전에 그것을 부른다.
 */
export function slideAsset(name: string): Uint8Array<ArrayBuffer> {
  // Buffer가 아니라 Uint8Array로 돌려준다. Buffer의 .buffer 는 Node의 풀에서 온
  // ArrayBuffer일 수 있어 파일보다 클 수 있고, DOM의 BlobPart 타입도 아니다 —
  // new File([...]) 로 넘기는 테스트가 그 자리에서 걸린다.
  return new Uint8Array(readFileSync(join(SLIDES, name)));
}

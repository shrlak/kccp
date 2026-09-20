/**
 * 바이트가 정말 .pptx 인지만 본다.
 *
 * `lib/storage/pptLibrary.ts`에서 들고 왔다 — 저장 경로에 붙어 있었을 뿐, 어디에
 * 저장하는지는 모르는 함수다. additionalFiles/convert 가 이것 하나를 쓰느라 Worker
 * 라이브러리 전체에 묶여 있었다.
 */
import JSZip from 'jszip';

/** Confirm the bytes are a loadable .pptx before archiving them. */
export async function inspectDeckBytes(
  data: ArrayBuffer | Uint8Array,
): Promise<{ slideCount: number }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('PPTX 파일을 읽지 못했습니다.');
  }
  const slideCount = Object.keys(zip.files).filter((file) => /^ppt\/slides\/slide\d+\.xml$/.test(file)).length;
  return { slideCount };
}

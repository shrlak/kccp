import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildImageDeck, containRect } from './imageDeckBuilder';
import { assertPptxIntegrity, findBrokenRelationships } from './pptxPackage';
import { slideAsset } from '../../__fixtures__/slideAssets';

const template = slideAsset('template.pptx');
const png1x1 = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=', 'base64'),
);
const jpeg1x1 = new Uint8Array(
  Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==', 'base64'),
);

describe('containRect', () => {
  it('centers a portrait image on a 4:3 slide without cropping', () => {
    expect(containRect(1000, 2000)).toEqual({ x: 2_857_500, y: 0, cx: 3_429_000, cy: 6_858_000 });
  });

  it('centers a wide image vertically without cropping', () => {
    expect(containRect(2000, 1000)).toEqual({ x: 0, y: 1_143_000, cx: 9_144_000, cy: 4_572_000 });
  });

  it('rejects non-positive dimensions', () => {
    expect(() => containRect(0, 100)).toThrow('이미지 크기');
  });
});

describe('buildImageDeck', () => {
  it('creates one valid image slide and relationship per source image', async () => {
    const result = await buildImageDeck(template, [
      { data: png1x1, mimeType: 'image/png', width: 1, height: 1 },
      { data: jpeg1x1, mimeType: 'image/jpeg', width: 1, height: 1 },
    ]);
    const zip = await JSZip.loadAsync(result);
    const slides = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path));
    const media = Object.keys(zip.files).filter((path) => /^ppt\/media\/additional-image-\d+\.(png|jpg)$/.test(path));

    expect(slides).toHaveLength(2);
    expect(media).toEqual(['ppt/media/additional-image-1.png', 'ppt/media/additional-image-2.jpg']);
    for (const [index, path] of slides.entries()) {
      const xml = await zip.file(path)!.async('string');
      expect(xml).toContain(`<p:cNvPr id="${1000 + index}" name="추가 자료 ${index + 1}"/>`);
      expect(xml).toContain(`<a:blip r:embed="rIdAdditionalImage${index + 1}"/>`);
      expect(xml).not.toContain('눈부신 햇살');
    }
    expect(await findBrokenRelationships(zip)).toEqual([]);
    await expect(assertPptxIntegrity(result)).resolves.toBeUndefined();
  });

  it('rejects an empty image list', async () => {
    await expect(buildImageDeck(template, [])).rejects.toThrow('이미지가 없습니다');
  });
});

// 수요예배 템플릿 위에서 그리는 경우는 **여기서 검사하지 않는다.** 그 생성기는 아직
// vendor/ppt/ 에 있고, 그 3.4 MB짜리 템플릿을 web/public/slides/ 로 들이면 슬라이드를
// 쓰지 않는 사람의 배포에까지 그 무게가 실린다. 그 검사는 그대로 upstream(그리고
// vendor/ppt/tests/pptx/imageDeckBuilder.test.ts)에 있고, 수요예배가 이 앱으로 건너오는
// 날 템플릿과 함께 따라온다. `canvas` 옵션 자체는 위의 containRect 검사가 덮는다.

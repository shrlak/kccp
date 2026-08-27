import { afterEach, describe, it, expect, vi } from 'vitest'
import { combineVertical, copyCanvasToClipboard, fitFontPx, slotLabel } from './todaySheetImage'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fakeCanvas(payload: string, succeeds = true): HTMLCanvasElement {
  return {
    toBlob(callback: BlobCallback, type?: string) {
      callback(succeeds ? new Blob([payload], { type }) : null)
    },
  } as HTMLCanvasElement
}

class TestClipboardItem {
  readonly data: Record<string, Blob>

  constructor(data: Record<string, Blob>) {
    this.data = data
  }
}

describe('merged clipboard image', () => {
  it('stacks source canvases vertically into one white canvas', () => {
    const first = { width: 100, height: 40 } as HTMLCanvasElement
    const second = { width: 80, height: 60 } as HTMLCanvasElement
    const fillRect = vi.fn()
    const drawImage = vi.fn()
    const combined = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect, drawImage }),
    } as unknown as HTMLCanvasElement
    vi.spyOn(document, 'createElement').mockReturnValue(combined)

    expect(combineVertical([first, second], 12)).toBe(combined)
    expect(combined.width).toBe(100)
    expect(combined.height).toBe(112)
    expect(fillRect).toHaveBeenCalledWith(0, 0, 100, 112)
    expect(drawImage).toHaveBeenNthCalledWith(1, first, 0, 0)
    expect(drawImage).toHaveBeenNthCalledWith(2, second, 10, 52)
  })

  it('writes the merged canvas as exactly one Chrome-compatible ClipboardItem', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write } })

    await expect(copyCanvasToClipboard(fakeCanvas('merged'))).resolves.toBe(true)

    expect(write).toHaveBeenCalledTimes(1)
    const items = write.mock.calls[0][0] as TestClipboardItem[]
    expect(items).toHaveLength(1)
    expect(await items[0].data['image/png'].text()).toBe('merged')
  })

  it('does not write when the merged canvas conversion fails', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', class {})
    vi.stubGlobal('navigator', { clipboard: { write } })

    await expect(copyCanvasToClipboard(fakeCanvas('merged', false))).resolves.toBe(false)
    expect(write).not.toHaveBeenCalled()
  })
})

// A measuring stub: width = characters × font px, with the px read back from
// whatever font string fitFontPx last set — enough to exercise the fit math.
function fakeCtx() {
  const ctx = {
    font: '',
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16)
      return { width: text.length * px } as TextMetrics
    },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

const font = (px: number) => `400 ${px}px "Gowun Dodum", sans-serif`

describe('fitFontPx', () => {
  it('keeps the base size when the text already fits', () => {
    const ctx = fakeCtx()
    expect(fitFontPx(ctx, '홍길동', 166, 18, 11, font)).toBe(18)
    expect(ctx.font).toContain('18px')
  })

  it('shrinks a long name proportionally so it fits the cell', () => {
    const ctx = fakeCtx()
    // 12 chars × 18px = 216 > 166 → floor(18 × 166 / 216) = 13
    const px = fitFontPx(ctx, 'ABCDEFGHIJKL', 166, 18, 11, font)
    expect(px).toBe(13)
    expect(ctx.font).toContain('13px')
    expect(ctx.measureText('ABCDEFGHIJKL').width).toBeLessThanOrEqual(166)
  })

  it('never goes below the minimum size, even for absurdly long text', () => {
    const ctx = fakeCtx()
    const px = fitFontPx(ctx, 'X'.repeat(40), 166, 18, 11, font)
    expect(px).toBe(11)
    expect(ctx.font).toContain('11px')
  })
})

describe('slotLabel', () => {
  it('appends the status icon only when tagged', () => {
    expect(slotLabel('홍길동', null)).toBe('홍길동')
    expect(slotLabel('홍길동', 'newFamily')).toBe('홍길동 ✝️')
    expect(slotLabel('홍길동', 'visitor')).toBe('홍길동 👋')
  })
})

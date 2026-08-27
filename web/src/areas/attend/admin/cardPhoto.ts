import { canvasToBlob } from './todaySheetImage'

// ── 카드 사진 → 업로드용 base64 JPEG ──────────────────────────────────────────
// Phone photos are 5–15MB; the extraction endpoint takes a JSON body, so downscale
// client-side before encoding: long edge ≤3072px, JPEG q0.82 → typically 1–2MB, well
// inside the endpoint's 8MB base64 guard, while keeping handwriting legible. The long
// edge covers the *whole photo*, so a shot of four cards laid on a table gives each one
// a quarter of it — that is why the budget is far above the ~1568px a single card
// needs, and why it was raised from 2048: below this a stack of cards loses exactly the
// strokes the model has to read, and a card comes back half-empty or is missed
// entirely. Always re-encodes to JPEG, which also converts anything the browser can
// decode (PNG/WebP/etc.); undecodable files (e.g. HEIC on browsers without support)
// reject → the dialog shows "bad image".

const MAX_EDGE = 3072
const JPEG_QUALITY = 0.82

export async function fileToCardImage(file: File): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const { source, width, height, cleanup } = await decodeImage(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY)
    if (!blob) throw new Error('jpeg encode failed')
    return { base64: await blobToBase64(blob), mediaType: 'image/jpeg' }
  } finally {
    cleanup()
  }
}

// createImageBitmap decodes off the main thread and respects EXIF orientation in
// modern browsers; fall back to <img> + object URL where it's missing or refuses
// the file.
async function decodeImage(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { source: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() }
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image decode failed'))
      el.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

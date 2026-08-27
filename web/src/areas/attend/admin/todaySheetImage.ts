import {
  TODAY_SHEET_COLUMNS,
  todaySheetGroups,
  TODAY_SHEET_ROWS,
  todayGroupRoster,
  todaySheetFilename,
  todaySheetSlots,
  type TodayRosterEntry,
  type TodaySheetTag,
} from './todaySheet'
import { formatHeaderDate } from './exports'
import type { LogEntry } from '../../../lib/api'
import type { Partition } from '../../../lib/partition'

// ── Today's check-in sheet → JPG download + clipboard (Korean) ───────────────
// The DOM side of the sheet export: render a 부서's numbered roll sheet onto a
// canvas, download it as a JPG, and copy both pages to the clipboard as one merged
// image. The sheet is always drawn in Korean. The pure model lives in todaySheet.ts.

// Per-부서 accent, matching the analytics/kiosk palette (대학부 gold, 청년부 blue);
// anything else falls back to the brand terracotta.
const GROUP_ACCENT: Record<string, string> = { 대학부: '#E0A800', 청년부: '#3B82F6' }
const DEFAULT_ACCENT = '#D9603D'

// Korean labels — the exported sheet is Korean regardless of the app's UI language.
const L = {
  num: '번호',
  name: '이름',
  title: '출석부',
  count: (n: number) => `총 ${n}명 출석`,
  newFamily: '오늘 등록한 새가족',
  visitor: '방문자',
}

// Status icon shown next to a name (matches the kiosk's ✝️ 새가족 / 👋 방문자 actions).
const TAG_ICON: Record<Exclude<TodaySheetTag, null>, string> = { newFamily: '✝️', visitor: '👋' }

// A name with its status icon appended, e.g. "홍길동 ✝️"; plain name when untagged. Only
// the 새가족 who registered on the sheet's date carry ✝️ (see checkinTag).
export function slotLabel(name: string, tag: TodaySheetTag): string {
  if (!name || !tag) return name
  return `${name} ${TAG_ICON[tag]}`
}

// Logical-pixel layout; the canvas is rendered at SCALE× for a crisp raster.
const SCALE = 2
const MARGIN = 40
const TITLE_H = 52
const GAP = 22
const HEADER_H = 36
const ROW_H = 44
const LEGEND_H = 34
const NUM_W = 48
const NAME_W = 188
const COL_W = NUM_W + NAME_W
const GRID_W = COL_W * TODAY_SHEET_COLUMNS
const GRID_H = HEADER_H + ROW_H * TODAY_SHEET_ROWS
const W = MARGIN * 2 + GRID_W
const H = MARGIN + TITLE_H + GAP + GRID_H + LEGEND_H + MARGIN

// Make sure the Jua/Gowun Dodum web fonts are loaded so the canvas rasterizes them
// (instead of a system fallback). Best-effort — drawing still succeeds on failure.
export async function ensureSheetFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.all([
      document.fonts.load('700 34px "Jua"'),
      document.fonts.load('400 18px "Gowun Dodum"'),
      document.fonts.load('700 16px "Gowun Dodum"'),
    ])
    await document.fonts.ready
  } catch {
    // ignore — fall back to system fonts
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

// "#E0A800" + alpha → "rgba(r, g, b, a)" for the light number-cell tint.
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Trim `text` with an ellipsis so it fits within `maxW` px at the current font.
function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

// Font size (px) that fits `text` within `maxW` at the given weight/family, starting
// from `basePx` and shrinking down to `minPx` — long names get a smaller font instead
// of an ellipsis. Text width scales linearly with font size, so one measurement at
// `basePx` is enough. Leaves ctx.font set to the returned size.
export function fitFontPx(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  basePx: number,
  minPx: number,
  font: (px: number) => string,
): number {
  ctx.font = font(basePx)
  const width = ctx.measureText(text).width
  if (width <= maxW) return basePx
  const px = Math.max(minPx, Math.floor((basePx * maxW) / width))
  ctx.font = font(px)
  return px
}

// Draw one 부서's 60-slot sheet onto a fresh canvas and return it.
export function renderTodaySheet(group: string, entries: TodayRosterEntry[], date: string): HTMLCanvasElement {
  const accent = GROUP_ACCENT[group] ?? DEFAULT_ACCENT
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Title (left) + date · count (right)
  ctx.fillStyle = accent
  ctx.font = '700 32px "Jua", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`${group} ${L.title}`, MARGIN, MARGIN + TITLE_H / 2)
  ctx.fillStyle = '#6b7280'
  ctx.font = '400 17px "Gowun Dodum", sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`${formatHeaderDate(date, 'ko')} · ${L.count(entries.length)}`, W - MARGIN, MARGIN + TITLE_H / 2)

  const gridTop = MARGIN + TITLE_H + GAP
  const gridLeft = MARGIN
  const slots = todaySheetSlots(entries)

  // Cell fills + text
  for (let c = 0; c < TODAY_SHEET_COLUMNS; c++) {
    const x = gridLeft + c * COL_W
    // Column header band
    ctx.fillStyle = accent
    ctx.fillRect(x, gridTop, COL_W, HEADER_H)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.font = '700 15px "Gowun Dodum", sans-serif'
    ctx.fillText(L.num, x + NUM_W / 2, gridTop + HEADER_H / 2)
    ctx.fillText(L.name, x + NUM_W + NAME_W / 2, gridTop + HEADER_H / 2)

    for (let r = 0; r < TODAY_SHEET_ROWS; r++) {
      const slot = slots[c * TODAY_SHEET_ROWS + r]
      const y = gridTop + HEADER_H + r * ROW_H
      // Number cell — light accent tint
      ctx.fillStyle = tint(accent, 0.1)
      ctx.fillRect(x, y, NUM_W, ROW_H)
      ctx.fillStyle = '#374151'
      ctx.textAlign = 'center'
      ctx.font = '700 15px "Gowun Dodum", sans-serif'
      ctx.fillText(String(slot.num), x + NUM_W / 2, y + ROW_H / 2)
      // Name cell (+ 새가족/방문자 icon) — long names shrink to fit the cell (down to
      // 11px); the ellipsis only kicks in if even the smallest size can't hold them.
      if (slot.name) {
        ctx.fillStyle = '#1f2937'
        ctx.textAlign = 'left'
        const label = slotLabel(slot.name, slot.tag)
        const maxW = NAME_W - 22
        fitFontPx(ctx, label, maxW, 18, 11, (px) => `400 ${px}px "Gowun Dodum", sans-serif`)
        ctx.fillText(truncate(ctx, label, maxW), x + NUM_W + 12, y + ROW_H / 2)
      }
    }
  }

  // Grid lines (drawn on top of the fills)
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1
  for (let r = 0; r <= TODAY_SHEET_ROWS; r++) {
    const y = gridTop + HEADER_H + r * ROW_H
    line(ctx, gridLeft, y, gridLeft + GRID_W, y)
  }
  line(ctx, gridLeft, gridTop, gridLeft + GRID_W, gridTop) // top of header
  for (let c = 0; c < TODAY_SHEET_COLUMNS; c++) {
    const x = gridLeft + c * COL_W
    line(ctx, x, gridTop, x, gridTop + GRID_H) // column left edge
    line(ctx, x + NUM_W, gridTop, x + NUM_W, gridTop + GRID_H) // 번호/이름 divider
  }
  line(ctx, gridLeft + GRID_W, gridTop, gridLeft + GRID_W, gridTop + GRID_H) // right edge

  // Legend (icon key): ✝️ 오늘 등록한 새가족   👋 방문자
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = '400 15px "Gowun Dodum", sans-serif'
  ctx.fillStyle = '#6b7280'
  const legendY = gridTop + GRID_H + LEGEND_H / 2 + 4
  const legend = [`${TAG_ICON.newFamily} ${L.newFamily}`, `${TAG_ICON.visitor} ${L.visitor}`]
  let legendX = gridLeft
  for (const item of legend) {
    ctx.fillText(item, legendX, legendY)
    legendX += ctx.measureText(item).width + 24
  }

  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

// Trigger a file download for a blob.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Stack canvases vertically (centered) into one canvas, separated by `gap` px, on white.
// Both 출석부 pages and all selected 새가족 cards become one Chrome-compatible image.
export function combineVertical(canvases: HTMLCanvasElement[], gap: number): HTMLCanvasElement {
  const width = Math.max(...canvases.map((canvas) => canvas.width))
  const height = canvases.reduce((total, canvas) => total + canvas.height, 0) + gap * Math.max(0, canvases.length - 1)
  const combined = document.createElement('canvas')
  combined.width = width
  combined.height = height
  const ctx = combined.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  let y = 0
  for (const canvas of canvases) {
    ctx.drawImage(canvas, Math.round((width - canvas.width) / 2), y)
    y += canvas.height + gap
  }
  return combined
}

// Copy one PNG ClipboardItem. Merging first keeps this compatible with Chrome, which
// rejects clipboard writes containing multiple image items.
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || typeof navigator === 'undefined' || !navigator.clipboard?.write) return false
  try {
    const blob = await canvasToBlob(canvas, 'image/png')
    if (!blob) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

// Render one sheet per 부서 of the logged-in 부 (대학부 + 청년부, or 장년부 alone) for
// `today`. `newMemberNames` holds the 새가족 who registered on that very day — only they get
// the ✝️ icon. Shared by the copy/save actions below so there's one render pass regardless
// of which (or both) the operator picks.
async function buildTodaySheetCanvases(
  log: LogEntry[],
  today: string,
  newMemberNames: ReadonlySet<string>,
  partition: Partition,
): Promise<HTMLCanvasElement[]> {
  await ensureSheetFonts()
  return todaySheetGroups(partition).map((group) =>
    renderTodaySheet(group, todayGroupRoster(log, today, group, newMemberNames), today),
  )
}

// Copy both pages, stacked into one image, to the clipboard.
export async function copyTodaySheets(
  log: LogEntry[],
  today: string,
  newMemberNames: ReadonlySet<string>,
  partition: Partition = 'youth',
): Promise<{ copied: boolean }> {
  const canvases = await buildTodaySheetCanvases(log, today, newMemberNames, partition)
  const copied = await copyCanvasToClipboard(combineVertical(canvases, 80))
  return { copied }
}

// Download each 부서's sheet as its own JPG.
export async function saveTodaySheets(
  log: LogEntry[],
  today: string,
  newMemberNames: ReadonlySet<string>,
  partition: Partition = 'youth',
): Promise<void> {
  const groups = todaySheetGroups(partition)
  const canvases = await buildTodaySheetCanvases(log, today, newMemberNames, partition)
  for (let i = 0; i < groups.length; i++) {
    const blob = await canvasToBlob(canvases[i], 'image/jpeg', 0.95)
    if (blob) downloadBlob(blob, todaySheetFilename(groups[i], today, 'jpg'))
    // A short gap so the browser accepts the second (back-to-back) download.
    if (i < groups.length - 1) await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

import type { Member } from '../../../lib/api'
import {
  ensureSheetFonts,
  canvasToBlob,
  downloadBlob,
  combineVertical,
  copyCanvasToClipboard,
} from './todaySheetImage'
import { cardModel, type CardCell, type CardCheckOption } from './newFamilyCard'

// ── 새가족 등록 카드 → JPG download + clipboard (Korean) ─────────────────────
// Renders each 새가족 as a faithful copy of the paper registration card: a centered
// grey title bar (< KCCP 빛주사랑 대학청년부 - 새가족 등록 카드 >) over a solid-bordered
// table of [grey label | value | grey label | value] rows, with the member's data
// filled in — gender circled in the 이름 cell, the matching 소속/세례/신앙생활/심방
// checkbox ticked, dates as MM / DD / YYYY (underscore blanks when missing). Each
// person ships as their own JPG; the clipboard gets all selected cards stacked into one
// merged image. The card's content comes from the pure `cardModel` in ./newFamilyCard
// (shared with the kiosk entry form); this module only draws it.

// Re-exported so the card's model + the 소속 storage convention stay importable from
// the module that consumes them for export (tests use these too).
export { cardModel, formatCardDate, joinAffiliation, splitAffiliation } from './newFamilyCard'

// Logical-pixel layout; rendered at SCALE× for a crisp raster (as todaySheetImage).
// Column proportions follow the scanned card: equal grey label columns, with the
// right value column wider than the left (≈ 16% | 31% | 16% | 37%).
const SCALE = 2
const CARD_W = 860
const MARGIN = 24 // white margin around the printed table
const TABLE_W = CARD_W - MARGIN * 2
const LABEL_W = 130 // grey label columns
const VALUE1_W = 250 // left value column (이름 / 생년월일 / 소속 / 학교 / 등록일)
const VALUE2_W = TABLE_W - LABEL_W * 2 - VALUE1_W // right value column, wider (as printed)
const TITLE_H = 54
const MIN_ROW_H = 48
const PAD_X = 12 // value-cell horizontal padding
const PAD_Y = 12 // value-cell vertical padding around stacked checkbox lines
const LINE_H = 26 // one checkbox line
const TEXT_LINE_H = 22 // one wrapped plain-text line (학교/전공 or 직장, …)
const BOX = 13 // checkbox square

const INK = '#111111'
const LABEL_GREY = '#d9d9d9'
const TITLE_GREY = '#efefef'

const TITLE_FONT = '700 22px "Jua", sans-serif'
const VALUE_FONT = '400 16px "Gowun Dodum", sans-serif'
const OPTION_FONT = '400 14px "Gowun Dodum", sans-serif'
const CAPTION_FONT = '400 10.5px "Gowun Dodum", sans-serif'

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

// Word-wrap `text` to fit `maxW` at the current ctx.font — greedy, breaking on
// whitespace where possible and falling back to a mid-word break for a single token
// wider than the whole cell (long school/program names with no spaces). Matches the
// 학교/전공 or 직장 field on the printed card, which wraps instead of truncating.
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (!text) return ['']
  const words = text.split(/(\s+)/).filter((w) => w !== '')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line + word
    if (ctx.measureText(test).width <= maxW || !line) {
      // A lone word already wider than the cell: break it character by character.
      if (!line && ctx.measureText(test).width > maxW && word.trim().length > 1) {
        let chunk = ''
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxW && chunk) {
            lines.push(chunk)
            chunk = ch
          } else {
            chunk += ch
          }
        }
        line = chunk
      } else {
        line = test
      }
    } else {
      lines.push(line.trimEnd())
      line = word.trimStart()
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines.length ? lines : ['']
}

// Width of one checkbox option (box + label + optional English caption).
function checkWidth(ctx: CanvasRenderingContext2D, opt: CardCheckOption): number {
  ctx.font = OPTION_FONT
  let w = BOX + 6 + ctx.measureText(opt.label).width
  if (opt.caption) {
    ctx.font = CAPTION_FONT
    w += 5 + ctx.measureText(opt.caption).width
  }
  return w
}

interface PlacedCheck {
  opt: CardCheckOption
  line: number
  w: number
}

// The printed card stacks every ☐ 옵션 on its own line (소속·세례·신앙생활 columns,
// and O over X for 심방 요청) — no horizontal flow.
function layoutChecks(ctx: CanvasRenderingContext2D, options: CardCheckOption[]): { placed: PlacedCheck[]; lines: number } {
  const placed = options.map((opt, i) => ({ opt, line: i, w: checkWidth(ctx, opt) }))
  return { placed, lines: options.length }
}

// Height one value cell needs: one line per checkbox option, or as many wrapped lines
// as a long text value (학교/전공 or 직장, …) needs to fit `width`.
function cellHeight(ctx: CanvasRenderingContext2D, cell: CardCell, width: number): number {
  if (cell.content.kind === 'checks') {
    const { lines } = layoutChecks(ctx, cell.content.options)
    return Math.max(MIN_ROW_H, PAD_Y * 2 + lines * LINE_H)
  }
  if (cell.content.kind === 'text' && cell.content.text) {
    ctx.font = VALUE_FONT
    const lines = wrapLines(ctx, cell.content.text, width - PAD_X * 2)
    return Math.max(MIN_ROW_H, PAD_Y * 2 + lines.length * TEXT_LINE_H)
  }
  return MIN_ROW_H
}

// Grey label cell: fill + bold centered text. Long labels wrap onto two centered
// lines at the first space (the printed 소속 (학교/직장) / 학교/전공 or 직장 style);
// single-word overflow shrinks instead.
function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number) {
  ctx.fillStyle = LABEL_GREY
  ctx.fillRect(x, y, LABEL_W, h)
  ctx.fillStyle = INK
  const maxW = LABEL_W - 10
  const fontAt = (size: number) => `700 ${size}px "Gowun Dodum", sans-serif`
  ctx.font = fontAt(15)
  ctx.textAlign = 'center'
  const cx = x + LABEL_W / 2
  const words = text.split(' ')
  if (ctx.measureText(text).width > maxW && words.length > 1) {
    const lines = [words[0], words.slice(1).join(' ')]
    let size = 15
    while (size > 11 && lines.some((l) => ctx.measureText(l).width > maxW)) {
      size -= 1
      ctx.font = fontAt(size)
    }
    ctx.fillText(lines[0], cx, y + h / 2 - 9)
    ctx.fillText(lines[1], cx, y + h / 2 + 10)
  } else {
    let size = 15
    while (size > 11 && ctx.measureText(text).width > maxW) {
      size -= 1
      ctx.font = fontAt(size)
    }
    ctx.fillText(text, cx, y + h / 2 + 1)
  }
  ctx.textAlign = 'left'
}

// ☐ / ☑-style checkbox: a small square, plus a bold ✓ overhanging it when checked.
function drawCheckbox(ctx: CanvasRenderingContext2D, x: number, cy: number, checked: boolean) {
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, cy - BOX / 2 + 0.5, BOX, BOX)
  if (checked) {
    ctx.fillStyle = INK
    ctx.font = '700 16px "Gowun Dodum", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('✓', x + BOX / 2 + 1, cy - 1)
    ctx.textAlign = 'left'
  }
}

// Value cell with a checkbox group (소속 / 세례 여부 / 신앙생활 / 심방 요청 O·X),
// options stacked one per line like the printed card.
function drawChecksCell(
  ctx: CanvasRenderingContext2D,
  content: Extract<CardCell['content'], { kind: 'checks' }>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const innerW = w - PAD_X * 2
  const { placed, lines } = layoutChecks(ctx, content.options)
  const top = y + (h - lines * LINE_H) / 2
  for (const p of placed) {
    const cy = top + p.line * LINE_H + LINE_H / 2
    const bx = x + PAD_X
    drawCheckbox(ctx, bx, cy, p.opt.checked)
    ctx.fillStyle = INK
    ctx.font = OPTION_FONT
    const labelW = ctx.measureText(p.opt.label).width
    ctx.fillText(p.opt.label, bx + BOX + 6, cy + 1)
    if (p.opt.caption) {
      ctx.fillStyle = '#444444'
      ctx.font = CAPTION_FONT
      ctx.fillText(p.opt.caption, bx + BOX + 6 + labelW + 5, cy + 2)
    }
  }
  // Free text after the last option (the paper's "Other: ____" blank).
  if (content.extra) {
    const last = placed[placed.length - 1]
    const ex = x + PAD_X + last.w + 6
    const cy = top + last.line * LINE_H + LINE_H / 2
    const room = x + PAD_X + innerW - ex
    if (room > 24) {
      ctx.fillStyle = INK
      ctx.font = OPTION_FONT
      ctx.fillText(truncate(ctx, content.extra, room), ex, cy + 1)
    }
  }
}

// 이름 cell: the name plus "( 남 / 여 )", with the member's gender circled in pen —
// an ellipse around 남 or 여 (nothing circled when the gender is blank/unknown).
function drawNameCell(
  ctx: CanvasRenderingContext2D,
  content: Extract<CardCell['content'], { kind: 'name' }>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const cy = y + h / 2 + 1
  ctx.font = VALUE_FONT
  ctx.fillStyle = INK
  const genderParts = ['( ', '남', ' / ', '여', ' )'] as const
  const genderW = genderParts.reduce((gw, p) => gw + ctx.measureText(p).width, 0)
  const nameMax = w - PAD_X * 2 - genderW - 14
  const name = truncate(ctx, content.name, Math.max(nameMax, 40))
  ctx.fillText(name, x + PAD_X, cy)
  let gx = x + PAD_X + ctx.measureText(name).width + 14
  for (const part of genderParts) {
    ctx.fillText(part, gx, cy)
    const w = ctx.measureText(part).width
    if (part === content.circled) {
      ctx.strokeStyle = INK
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.ellipse(gx + w / 2, cy - 1, w / 2 + 6, 12, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }
    gx += w
  }
}

// Draw one member's 등록 카드 onto a fresh canvas and return it.
export function renderNewFamilyCard(m: Member): HTMLCanvasElement {
  const model = cardModel(m)

  // First pass on a throwaway context: measure how tall each row needs to be
  // (checkbox groups wrap), then size the real canvas exactly.
  const meas = document.createElement('canvas').getContext('2d')
  if (!meas) throw new Error('canvas 2d context unavailable')
  const rowHeights = model.rows.map((r) => Math.max(cellHeight(meas, r.left, VALUE1_W), cellHeight(meas, r.right, VALUE2_W)))
  const tableH = TITLE_H + rowHeights.reduce((a, b) => a + b, 0)
  const H = MARGIN * 2 + tableH

  const canvas = document.createElement('canvas')
  canvas.width = CARD_W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  // Paper background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CARD_W, H)

  const left = MARGIN
  const top = MARGIN

  // Title bar: light grey, centered bold Jua
  ctx.fillStyle = TITLE_GREY
  ctx.fillRect(left, top, TABLE_W, TITLE_H)
  ctx.fillStyle = INK
  ctx.font = TITLE_FONT
  ctx.textAlign = 'center'
  ctx.fillText(model.title, left + TABLE_W / 2, top + TITLE_H / 2 + 2)
  ctx.textAlign = 'left'

  // Rows: [grey label | value | grey label | wider value] — printed column widths.
  const colX = [left, left + LABEL_W, left + LABEL_W + VALUE1_W, left + LABEL_W * 2 + VALUE1_W]
  let y = top + TITLE_H
  model.rows.forEach((row, i) => {
    const h = rowHeights[i]
    for (const [cell, lx, vx, vw] of [
      [row.left, colX[0], colX[1], VALUE1_W],
      [row.right, colX[2], colX[3], VALUE2_W],
    ] as const) {
      drawLabel(ctx, cell.label, lx, y, h)
      const c = cell.content
      if (c.kind === 'text') {
        ctx.fillStyle = INK
        ctx.font = VALUE_FONT
        if (c.text) {
          const lines = wrapLines(ctx, c.text, vw - PAD_X * 2)
          const top2 = y + (h - lines.length * TEXT_LINE_H) / 2
          lines.forEach((ln, li) => ctx.fillText(ln, vx + PAD_X, top2 + li * TEXT_LINE_H + TEXT_LINE_H / 2 + 1))
        }
      } else if (c.kind === 'name') {
        drawNameCell(ctx, c, vx, y, vw, h)
      } else {
        drawChecksCell(ctx, c, vx, y, vw, h)
      }
    }
    y += h
  })

  // Grid lines (solid dark, like the printed table)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.beginPath()
  // Horizontal: under the title, then under each row (the table bottom is the outer border)
  let gy = top + TITLE_H
  ctx.moveTo(left, gy + 0.5)
  ctx.lineTo(left + TABLE_W, gy + 0.5)
  for (let i = 0; i < rowHeights.length - 1; i++) {
    gy += rowHeights[i]
    ctx.moveTo(left, gy + 0.5)
    ctx.lineTo(left + TABLE_W, gy + 0.5)
  }
  // Vertical column separators (below the full-width title bar only)
  for (const cx of [colX[1], colX[2], colX[3]]) {
    ctx.moveTo(cx + 0.5, top + TITLE_H)
    ctx.lineTo(cx + 0.5, top + tableH)
  }
  ctx.stroke()

  // Outer border, heavier
  ctx.lineWidth = 2
  ctx.strokeRect(left, top, TABLE_W, tableH)
  ctx.lineWidth = 1

  return canvas
}

// Per-person filenames: 새가족등록카드-YYYY-MM-DD-이름.jpg. Names are sanitized for
// the filesystem, an empty name falls back to the card's 1-based position, and a
// duplicate name within the batch gets a -2/-3… suffix so no download overwrites
// another. Pure + exported for tests.
export function cardFilenames(members: Pick<Member, 'name'>[], date: string): string[] {
  const seen = new Map<string, number>()
  return members.map((m, i) => {
    const safe = (m.name || '').replace(/[\\/:*?"<>|]/g, '').trim() || String(i + 1)
    const n = (seen.get(safe) ?? 0) + 1
    seen.set(safe, n)
    return `새가족등록카드-${date}-${safe}${n > 1 ? `-${n}` : ''}.jpg`
  })
}

// Render every member's card. Shared by the copy/save actions below so there's one
// render pass regardless of which (or both) the operator picks.
async function buildNewFamilyCards(members: Member[]): Promise<HTMLCanvasElement[]> {
  await ensureSheetFonts()
  return members.map(renderNewFamilyCard)
}

// Copy every card, stacked into a single image, to the clipboard.
export async function copyNewFamilyCards(members: Member[]): Promise<{ copied: boolean }> {
  const cards = await buildNewFamilyCards(members)
  const copied = await copyCanvasToClipboard(combineVertical(cards, 24 * SCALE))
  return { copied }
}

// Download each person's card as its own JPG.
export async function saveNewFamilyCards(members: Member[], date: string): Promise<void> {
  const cards = await buildNewFamilyCards(members)
  const filenames = cardFilenames(members, date)
  for (let i = 0; i < cards.length; i++) {
    const blob = await canvasToBlob(cards[i], 'image/jpeg', 0.95)
    if (blob) downloadBlob(blob, filenames[i])
    // A short gap so the browser accepts back-to-back downloads (as the 출석표 export).
    if (i < cards.length - 1) await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

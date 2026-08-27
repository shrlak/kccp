import type { Member, LogEntry } from '../../../lib/api'
import type { CalendarLike } from '../../../lib/semester'
import { buildGrid } from './sheet'
import { semesterBounds, semesterKey, semesterSundays, transitionBounds, transitionSundays, isActiveNewFamily } from './newFamily'
import { splitAffiliation } from './newFamilyCard'
import { classifyKakaoId } from './contactQr'
import { awayForRange, noteOn } from '../../../lib/status'
import { seasonLabel, unitTerms, usesSemesters, type Partition } from '../../../lib/partition'

// ── Pure export helpers ──────────────────────────────────────────────────────
// Everything here is side-effect free so it can be unit-tested. The thin DOM bits
// (clipboard write, window.open, XLSX.writeFile) stay in the component.

export type Lang = 'ko' | 'en'

// Filename for the Excel export: kccp-attendance-{group?}-{YYYY-MM-DD}.xlsx.
// The optional group label is slugged of whitespace; an empty group is omitted.
export function exportFilename(group: string, date: string): string {
  const g = group.trim().replace(/\s+/g, '')
  return `kccp-attendance-${g ? `${g}-` : ''}${date}.xlsx`
}

// "Notes" column for the Full Log sheet — the legacy concatenation of flag labels.
function logNotes(e: LogEntry, lang: Lang): string {
  const L =
    lang === 'ko'
      ? { first: '첫출석', manual: '수동', guest: '방문자' }
      : { first: 'First visit', manual: 'Manual', guest: 'Guest' }
  const parts: string[] = []
  if (e.firstVisit) parts.push(L.first)
  if (e.memberRole === 'manual') parts.push(L.manual)
  if (e.memberRole === 'visitor' || e.memberRole === 'guest') parts.push(L.guest)
  return parts.join(' ')
}

// "2026-06-07" -> "06/07/2026" (MM/DD/YYYY) - the date-column format of the legacy sheet.
export function formatGridDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

// A 동산 term can form after its semester begins. The 2026 여름동산 groups were assigned on
// 2026-06-07, so the summer export starts there — the earlier summer Sundays (05/10–05/31)
// predate the 동산 assignments and are dropped. Keyed by semesterKey so it self-limits to
// this one term; every other term uses the full semester window.
const TERM_START_OVERRIDES: Record<string, string> = {
  '2026-summer': '2026-06-07',
}

// Some terms close their attendance sheet before the semester boundary. 2026 여름 worship runs
// through 8/2, so the summer columns end there (the later 8/9 Sunday is dropped). When an end
// override is set the export shows the term's *full* column set up to that date — including
// Sundays still in the future, which render blank (see isFutureDate) and fill in with O/X as
// each date passes. Terms without an override stay clamped to `today` as before. Keyed by
// semesterKey.
const TERM_END_OVERRIDES: Record<string, string> = {
  '2026-summer': '2026-08-02',
}

// Worship Sundays shown in the export for the term containing `today`: the semester Sundays
// (semesterSundays), clamped to the term's effective start (TERM_START_OVERRIDES) and run
// through the term-end override when set — otherwise only through `today`. ISO ascending.
export function exportSundays(today: string, semesterDates?: CalendarLike, partition: Partition = 'youth'): string[] {
  // 예배 doesn't stop just because `today` falls between two configured 학기 — the moment a
  // term ends the sheet rolls over to the gap's own table instead of freezing on the finished
  // term's columns. Like a term, the gap shows its *whole* Sunday set (upcoming ones blank
  // until they pass), so the transition sheet is a real table from its first day rather than
  // an empty one. Only possible once an admin's saved term dates leave a break.
  const transition = transitionBounds(today, semesterDates, partition)
  if (transition) return transitionSundays(transition, transition.end)
  // Once an administrator saves explicit term dates, they are the source of truth and
  // the sheet exposes the whole configured term (future Sundays remain blank until they
  // occur). Before that, preserve the one-off legacy 2026 overrides below.
  // 장년부는 저장된 학기 일정이 없어도 (그런 것이 없는 부다) 상·하반기 경계가 고정이므로
  // 언제나 이 길로 온다 — 아래 2026 예외들은 대학·청년부의 옛 기록을 위한 것이다.
  if (semesterDates || partition === 'adult') {
    const { end } = semesterBounds(today, semesterDates, partition)
    return semesterSundays(today, end, semesterDates, partition)
  }
  const key = semesterKey(today)
  // With an end override the columns are fixed for the whole term (upcoming Sundays included,
  // shown blank); without one they run only through today.
  const end = TERM_END_OVERRIDES[key] ?? today
  const dates = semesterSundays(today, end)
  const start = TERM_START_OVERRIDES[key]
  return start ? dates.filter((d) => d >= start) : dates
}

// A worship Sunday after `today` hasn't happened yet: its O/X cell and its 총 출석 stay blank
// until the date passes and attendance comes in. ISO date strings compare lexicographically.
export function isFutureDate(date: string, today: string): boolean {
  return date > today
}

// A cell-merge range in SheetJS form ({s}tart/{e}nd, 0-based row/col). Mirrors XLSX.Range
// so it can be assigned straight to a worksheet's `!merges`.
export interface CellMerge {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

// A solid cell fill (0-based row/col), rgb as ARGB hex (e.g. "FFB6D7A8").
export interface CellFill {
  r: number
  c: number
  rgb: string
}

export interface SheetData {
  aoa: (string | number)[][]
  merges: CellMerge[]
  fills: CellFill[]
}

// How one member × date cell renders, master-sheet style. 'note' opens a grey marked-out
// run (한국 귀국 / 이주 / 돌아옴 / 새가족 …) spanning `span` columns; the covered cells that
// follow are 'inNote' so renderers can merge them. 'blank' = pre-등록일자, upcoming, or a
// date the 동산 has no data for yet.
// `dongsan` is the 동산모임 mark for the same date, when there is one — a second, smaller
// fact sitting in the same cell. 구글 시트 연동이 들어오기 전에는 언제나 undefined다.
export type CellMark =
  | { kind: 'present'; dongsan?: DongsanMark }
  | { kind: 'absent'; dongsan?: DongsanMark }
  | { kind: 'blank' }
  | { kind: 'note'; note: string; span: number }
  | { kind: 'inNote' }

// 동산모임에 왔는가. 예배와 **따로 적히는 사실**이라 없을 수도 있다 (그날 동산모임을 적지
// 않았거나, 그 시트가 아직 붙지 않았거나).
export type DongsanMark = 'present' | 'absent'

// One member row inside an attendance block: their attended dates (by name), per-date cell
// marks, and the count of shown dates they attended (예배 총 출석).
export interface AttendanceMemberRow {
  member: Member
  present: Set<string>
  marks: CellMark[]
  total: number
}

// Dates before a member's 등록일자 don't apply to them — not an absence, not part of
// their counts. Members without a registration date are scored on every date.
export function beforeRegistration(m: Member, date: string): boolean {
  return !!m.registration_date && date < m.registration_date
}

// 상태 표기 (한국 귀국 / 방학 …) covering `date`, from the member's mark list — see
// lib/status.ts. Re-exported here so the sheet's callers keep one import.
export { isAwayNote, awayOn, awayForRange } from '../../../lib/status'

export interface AttendanceSection {
  subgroup: string
  rows: AttendanceMemberRow[]
  // Present count per shown date; '' when the date is upcoming or the 동산 has no data
  // for it yet (attendance not taken) — the column stays blank until data comes in.
  totals: (number | '')[]
}

export interface AttendanceModel {
  dates: string[]
  dateLabels: string[]
  sections: AttendanceSection[]
}

export interface AttendanceLabels {
  unassigned: string
  newFamily: string // 새가족 — the derived pre-registration note for new members
}

// Shared spine of the Excel sheet, the PDF report and the on-screen grid: the roster split
// into blocks (by 동산, or by `groupBy` when given — e.g. a transition-period sheet groups
// by 부서 only, since 동산 assignments don't cleanly apply between configured 학기) and
// scored against an explicit list of `dates` (the current semester's Sundays). Members
// without a bucket land last, under `unassigned`. Roster order is preserved within each
// bucket. `today` drives the blank-until-data rules: upcoming Sundays and Sundays where the
// bucket has no check-ins yet render blank (no O/X) — so e.g. today's column stays empty
// until the afternoon's check-ins actually land — while status-mark spans render even across them.
export function buildAttendanceModel(
  members: Member[],
  log: LogEntry[],
  dates: string[],
  today: string,
  labels: AttendanceLabels,
  groupBy: (m: Member) => string = (m) => m.subgroup || labels.unassigned,
  // 동산모임 출석 (/api/roster의 dongsanLog). 예배 출석과 같은 칸에 작게 덧붙는다.
  dongsanLog: LogEntry[] = [],
): AttendanceModel {
  // 한국 귀국 / 이주 for the whole shown stretch → not part of this sheet at all.
  const roster = dates.length
    ? members.filter((m) => !awayForRange(m, dates[0], dates[dates.length - 1]))
    : members

  // name -> every date that name attended (the denormalized log carries the name).
  const attended = new Map<string, Set<string>>()
  for (const e of log) {
    let set = attended.get(e.name)
    if (!set) {
      set = new Set<string>()
      attended.set(e.name, set)
    }
    set.add(e.date)
  }

  // 동산모임도 같은 방식으로 이름 → 날짜. 예배와 겹치지 않는 별개의 집합이다.
  const attendedDongsan = new Map<string, Set<string>>()
  for (const e of dongsanLog) {
    let set = attendedDongsan.get(e.name)
    if (!set) {
      set = new Set<string>()
      attendedDongsan.set(e.name, set)
    }
    set.add(e.date)
  }
  // 그 동산모임이 적힌 날짜들. 여기 없는 날짜는 "안 왔다"가 아니라 "아무도 적지 않았다"라서
  // 칸에 아무것도 덧붙이지 않는다 — 시트의 빈칸을 결석으로 읽지 않는 것과 같은 규칙이다.
  const dongsanDates = new Set<string>()
  for (const e of dongsanLog) dongsanDates.add(e.date)

  const order: string[] = []
  const byKey = new Map<string, Member[]>()
  for (const m of roster) {
    const key = groupBy(m) || labels.unassigned
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = []
      byKey.set(key, bucket)
      order.push(key)
    }
    bucket.push(m)
  }

  const sections = order.map((subgroup) => {
    const sectionMembers = byKey.get(subgroup)!
    const presents = sectionMembers.map((m) => attended.get(m.name) ?? new Set<string>())
    // A date with zero check-ins across the 동산 = attendance not taken (yet) → blank column.
    const hasData = dates.map((d) => presents.some((p) => p.has(d)))

    const rows: AttendanceMemberRow[] = sectionMembers.map((m, mi) => {
      const present = presents[mi]
      const inDongsan = attendedDongsan.get(m.name)
      const marks: CellMark[] = dates.map((d, di) => {
        const note = noteOn(m, d) ?? (isActiveNewFamily(m) && beforeRegistration(m, d) ? labels.newFamily : null)
        if (note) return { kind: 'note', note, span: 1 }
        if (beforeRegistration(m, d)) return { kind: 'blank' }
        if (isFutureDate(d, today) || !hasData[di]) return { kind: 'blank' }
        const dongsan: DongsanMark | undefined = dongsanDates.has(d)
          ? inDongsan?.has(d) ? 'present' : 'absent'
          : undefined
        return present.has(d) ? { kind: 'present', dongsan } : { kind: 'absent', dongsan }
      })
      // Coalesce consecutive same-note cells into one span (the master sheet's merged grey cell).
      for (let i = 0; i < marks.length; i++) {
        const head = marks[i]
        if (head.kind !== 'note') continue
        let j = i + 1
        while (j < marks.length) {
          const next = marks[j]
          if (next.kind !== 'note' || next.note !== head.note) break
          marks[j] = { kind: 'inNote' }
          j++
        }
        head.span = j - i
        i = j - 1
      }
      const total = marks.reduce((n, c) => n + (c.kind === 'present' ? 1 : 0), 0)
      return { member: m, present, marks, total }
    })

    const totals = dates.map((d, i): number | '' =>
      isFutureDate(d, today) || !hasData[i] ? '' : rows.reduce((n, r) => n + (r.marks[i].kind === 'present' ? 1 : 0), 0),
    )
    return { subgroup, rows, totals }
  })
  return { dates, dateLabels: dates.map(formatGridDate), sections }
}

// buildAttendanceModel's groupBy for one kind of period: by 동산 inside a 학기, by 부서 alone
// during a transition gap — 동산 assignments are term-scoped and don't cleanly apply between
// two terms.
export function periodGroupBy(
  kind: 'semester' | 'transition',
  unassigned: string,
): (m: Member) => string {
  return (m: Member) => (kind === 'transition' ? m.group_name : m.subgroup) || unassigned
}

// periodGroupBy for the period containing `today` (no configured 학기 covers it → transition).
//
// 장년부에는 학기가 없으니 **학기 사이라는 상태도 없다** — 전환 기간에는 부서로 묶느라 셀 구분이
// 통째로 사라졌고, 부서가 하나뿐인 장년부에서는 그게 곧 "전체가 한 덩어리"였다. 그 부는 언제나
// 셀로 나눈다.
export function attendanceGroupBy(
  today: string,
  semesterDates: CalendarLike,
  unassigned: string,
  partition: Partition = 'youth',
): (m: Member) => string {
  const transition = usesSemesters(partition) && !!transitionBounds(today, semesterDates)
  return periodGroupBy(transition ? 'transition' : 'semester', unassigned)
}

// Human label for the semester containing `today`, e.g. "2026 여름 학기" / "Summer 2026" —
// or, between two configured 학기, a transition-period label carrying the gap's own date
// range, so it's obvious at a glance which stretch of 예배 the table covers.
export function semesterLabel(today: string, lang: Lang, semesterDates?: CalendarLike, partition: Partition = 'youth'): string {
  const transition = transitionBounds(today, semesterDates, partition)
  if (transition) {
    const range = `${formatGridDate(transition.start)}–${formatGridDate(transition.end)}`
    return lang === 'ko' ? `학기 사이 (전환 기간) · ${range}` : `Between terms · ${range}`
  }
  const { year, season } = semesterBounds(today, semesterDates, partition)
  return seasonLabel(year, season, lang, partition)
}

// Per-동산 header palette, matching the legacy sheet: blocks cycle green -> blue -> yellow ->
// red, each a light shade (이름 labels) + a medium shade (date headers, 동산 name, 총 출석). The
// 예배 총 출석 header is a constant pink; the KEY legend a teal. Colors are ARGB hex.
export interface BlockColors {
  light: string
  medium: string
}
const COLOR_FAMILIES: BlockColors[] = [
  { light: 'FFD9EAD3', medium: 'FFB6D7A8' }, // green
  { light: 'FFCFE2F3', medium: 'FF9FC5E8' }, // blue
  { light: 'FFFFF2CC', medium: 'FFFFE599' }, // yellow
  { light: 'FFF4CCCC', medium: 'FFEA9999' }, // red
]
export const HEADER_TOTAL_FILL = 'FFEAD1DC' // 예배 총 출석 column header
export const KEY_FILL = 'FF76A5AF' // KEY legend label
export const NOTE_FILL = 'FFCCCCCC' // grey marked-out status cells (한국 귀국 / 이주 / 새가족 / 기타)

// The color family for the nth 동산 block (cycles through the palette).
export function blockColors(index: number): BlockColors {
  return COLOR_FAMILIES[index % COLOR_FAMILIES.length]
}

// ARGB hex ("FFB6D7A8") -> CSS hex ("#B6D7A8"), dropping the alpha byte.
export function cssColor(argb: string): string {
  return `#${argb.slice(2)}`
}

// 내보내는 엑셀의 글자 크기. 시트의 기본값은 11pt인데 출석부는 한 줄에 주일이 스무 칸까지
// 가는 표라, 그대로 두면 열 너비가 밀려 한 화면에 안 들어간다. 교회가 쓰는 원본 시트도 10pt다.
export const EXPORT_FONT_SIZE = 10

// 다 만들어진 워크시트의 모든 칸에 글자 크기만 얹는다. **시트를 다 꾸민 뒤 마지막에** 부른다 —
// 색·정렬·굵기를 넣는 쪽은 `cell.s`를 통째로 갈아 끼우므로, 먼저 부르면 크기가 지워진다.
// 여기서는 반대로 이미 있는 font를 펼쳐 담아 머리줄의 Arial/굵게가 살아남는다.
// `!merges`/`!cols` 같은 시트 속성은 칸이 아니므로 건너뛴다.
export function applyFontSize(ws: Record<string, unknown>, sz: number = EXPORT_FONT_SIZE): void {
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith('!')) continue
    const cell = ws[addr] as { s?: { font?: Record<string, unknown> } } | undefined
    if (!cell || typeof cell !== 'object') continue
    cell.s = { ...cell.s, font: { ...cell.s?.font, sz } }
  }
}

// Sheet 1 - "Attendance". Reproduces the church's legacy spreadsheet: members are split
// into 동산 (subgroup) blocks; each block has a single date-header row, O = present / X =
// absent cells — with status marks (한국 귀국 / 이주 / 새가족 …) as grey merged note cells,
// exactly like the master sheet — a per-member 예배 총 출석 count and a 총 출석 totals row.
// A KEY legend (O 출석 / X 결석 / grey 기타) closes the sheet. Date columns are the term's
// worship Sundays (see exportSundays — the summer term starts at the 동산 formation date;
// the original's 동산모임 column is dropped, the system only records 예배 worship check-ins).
// Returns the array-of-rows, the cell-merges and the header/note fills (ARGB).
export function gridSheet(
  members: Member[],
  log: LogEntry[],
  lang: Lang,
  today: string,
  semesterDates?: CalendarLike,
  partition: Partition = 'youth',
): SheetData {
  return attendanceSheet(
    members,
    log,
    lang,
    exportSundays(today, semesterDates, partition),
    today,
    attendanceGroupBy(today, semesterDates, sheetLabels(lang, partition).unassigned, partition),
    partition,
  )
}

// The Attendance sheet's own labels, shared by gridSheet and the archive workbooks.
// `unassigned` names the block of people with no 동산/셀 yet, so it follows the 부's
// vocabulary (lib/partition.ts unitTerms) — everything else reads the same either way.
export function sheetLabels(lang: Lang, partition: Partition = 'youth') {
  const { unassigned } = unitTerms(partition, lang)
  return lang === 'ko'
    ? { name: '이름', memberTotal: '예배 총 출석', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', etc: '기타', unassigned, newFamily: '새가족' }
    : { name: 'Name', memberTotal: 'Worship Total', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', etc: 'Other', unassigned, newFamily: 'New family' }
}

// gridSheet's body over an explicit date list and grouping — the form the archive exports
// use, where the columns are a *past* term's Sundays rather than the current one's. `today`
// still drives the blank-until-data rules; an archive passes the period's own end so nothing
// inside it counts as upcoming.
export function attendanceSheet(
  members: Member[],
  log: LogEntry[],
  lang: Lang,
  dates: string[],
  today: string,
  groupBy?: (m: Member) => string,
  partition: Partition = 'youth',
): SheetData {
  const L = sheetLabels(lang, partition)

  const model = buildAttendanceModel(
    members,
    log,
    dates,
    today,
    { unassigned: L.unassigned, newFamily: L.newFamily },
    groupBy,
  )
  const nDates = model.dates.length

  const aoa: (string | number)[][] = []
  const merges: CellMerge[] = []
  const fills: CellFill[] = []

  model.sections.forEach((section, si) => {
    if (si > 0) aoa.push([]) // blank row between 동산 blocks
    const { light, medium } = blockColors(si)

    const headerRow = aoa.length
    aoa.push(['', L.name, L.memberTotal, ...model.dateLabels]) // single header row: labels + dates
    // Color the header band: 이름 labels light, 예배 총 출석 pink, date columns medium.
    fills.push(
      { r: headerRow, c: 0, rgb: light },
      { r: headerRow, c: 1, rgb: light },
      { r: headerRow, c: 2, rgb: HEADER_TOTAL_FILL },
    )
    for (let c = 3; c < 3 + nDates; c++) fills.push({ r: headerRow, c, rgb: medium })

    // Member rows - 동산 name sits in column A of the first member (as in the sample).
    const firstMemberRow = aoa.length
    section.rows.forEach((r, i) => {
      const rowAt = aoa.length
      aoa.push([
        i === 0 ? section.subgroup : '',
        r.member.name,
        r.total,
        ...r.marks.map((c) => (c.kind === 'present' ? 'O' : c.kind === 'absent' ? 'X' : c.kind === 'note' ? c.note : '')),
      ])
      // Status marks: one grey cell merged across the dates the note covers.
      r.marks.forEach((c, di) => {
        if (c.kind !== 'note') return
        if (c.span > 1) merges.push({ s: { r: rowAt, c: 3 + di }, e: { r: rowAt, c: 3 + di + c.span - 1 } })
        for (let k = 0; k < c.span; k++) fills.push({ r: rowAt, c: 3 + di + k, rgb: NOTE_FILL })
      })
    })
    if (section.rows.length) fills.push({ r: firstMemberRow, c: 0, rgb: medium }) // 동산 name cell

    aoa.push([]) // blank spacer before the totals row
    const totalsAt = aoa.length
    // 총 출석: present count per date; upcoming / no-data-yet Sundays stay blank.
    aoa.push([L.total, '', '', ...section.totals])
    merges.push({ s: { r: totalsAt, c: 0 }, e: { r: totalsAt, c: 1 } }) // 총 출석 label spans A:B
    fills.push({ r: totalsAt, c: 0, rgb: medium }, { r: totalsAt, c: 1, rgb: medium })
  })

  // KEY legend: O = 출석, X = 결석, grey = 기타 (status marks).
  const keyRow = aoa.length + 2
  aoa.push([], [], [L.key], ['O', L.present], ['X', L.absent], ['', L.etc])
  fills.push({ r: keyRow, c: 0, rgb: KEY_FILL }, { r: keyRow + 3, c: 0, rgb: NOTE_FILL })

  return { aoa, merges, fills }
}

// Sheet 2 — "Full Log" as an array-of-rows (header first), newest first. Columns:
// Name, Group, 동산/셀, Date, Time, Total, Notes.
export function logRows(members: Member[], log: LogEntry[], lang: Lang, partition: Partition = 'youth'): (string | number)[][] {
  const { unit } = unitTerms(partition, lang)
  const head =
    lang === 'ko'
      ? ['이름', '부서', unit, '날짜', '시간', '합계', '비고']
      : ['Name', 'Group', unit, 'Date', 'Time', 'Total', 'Notes']

  // Per-member total = distinct attendance dates (matches the grid Total column).
  const totals = new Map<string, number>()
  for (const r of buildGrid(members, log).rows) totals.set(r.member.name, r.total)

  const rows: (string | number)[][] = [head]
  for (const e of [...log].sort((a, b) => b.ts - a.ts)) {
    rows.push([e.name, e.group, e.subgroup, e.date, e.time, totals.get(e.name) ?? 0, logNotes(e, lang)])
  }
  return rows
}

// ── 새가족 information export (Excel) ────────────────────────────────────────
// 교회가 실제로 쓰는 '대청 새가족 리스트' 스프레드시트를 그대로 옮긴 것 — 같은 열이 같은
// 순서로, 같은 색으로 나온다. 내보낸 줄을 그 시트에 그대로 이어 붙이는 것이 이 파일의 쓰임
// 이라, 열이 하나만 어긋나도 사람이 손으로 옮겨 적게 된다. 한 줄에 한 사람, 부서(group_name)
// 마다 시트 하나. XLSX.writeFile 쪽은 AdminNewFamily.tsx에 있고 여기는 순수 함수로 남는다.

// 시트의 머리줄. 두 부가 같은 모양을 쓴다 — 동산/셀이 나오는 칸이 없어서 부서마다 달라질
// 것이 없다.
export function newFamilyHeader(): string[] {
  return [
    '이름', '등록일', '성별', '생년월일', '전화번호', '이메일/카톡아이디',
    '학교/직장, 학과', '세례', '목사님 심방', '노트',
  ]
}

// 시트가 칠해 놓은 색 그대로 (구글 시트 표준 팔레트). SheetJS가 받는 ARGB 문자열이다.
export const NEW_FAMILY_FILL = {
  header: 'FF6FA8DC', // 머리줄 파랑
  male: 'FFCFE2F3', // 성별 '남'
  female: 'FFF4CCCC', // 성별 '여'
} as const

// 성별 칸(열 2)의 인덱스 — 색을 칠하는 유일한 본문 칸이다.
const GENDER_COL = 2

// 성별 칸의 색. 시트가 남/여를 색으로 갈라 놓아 이름을 하나씩 읽지 않아도 눈에 들어온다.
// 값은 '남'/'여'로 저장되지만 카드에서 온 문자열이 섞일 수 있어 포함 여부로 가른다
// (newFamilyCard.ts의 동그라미 규칙과 같다). 비어 있으면 칠하지 않는다 — 색이 없는 것이
// 곧 '안 적혀 있다'는 뜻이다.
export function genderFill(gender: string | null | undefined): string | null {
  const g = gender || ''
  if (g.includes('남')) return NEW_FAMILY_FILL.male
  if (g.includes('여')) return NEW_FAMILY_FILL.female
  return null
}

// ISO "YYYY-MM-DD" -> a local Date (matches how SheetJS serializes date cells) so the
// exported 등록일/생년월일 columns are real Excel dates, not text. '' when blank/unparseable.
function excelDate(iso: string | null | undefined): Date | '' {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return ''
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// 한 새가족의 10개 칸. 시트와 다르게 담는 칸이 셋 있어 적어 둔다:
//  · **이메일/카톡아이디는 한 칸이다** — 시트가 그렇게 적고(`philiplee0421`과
//    `hakyounglee08@gmail.com`이 같은 열에 있다), 종이 카드의 그 칸에도 아이디·이메일·전화가
//    섞여 들어오기 때문(contactQr.ts classifyKakaoId). 그래서 갈라 담지 않고 **적힌 그대로**
//    옮긴다 — 다듬으면 종이와 대조할 수 없다. 칸이 비어 있을 때만 members.email로 메운다.
//  · **세례 칸은 세례여부 + 신앙기간을 '; '로 잇는다** — 시트가 그렇게 적는다
//    ("세례; 5년 이상", "유아,입교; 모태신앙"). 신앙기간이 나가는 자리는 여기뿐이다.
//  · 노트는 메모(notes)다 — 편집 창의 그 칸이지 신앙기간이 아니다.
// 주소·동네 열은 없앴다: 시트에 없고, 앱은 그 값을 아예 모은 적이 없어 늘 빈 칸이었다.
export function newFamilyRow(m: Member): (string | number | Date)[] {
  const kakao = classifyKakaoId(m.kakao_id)
  return [
    m.name || '',
    excelDate(m.registration_date),
    m.gender || '',
    excelDate(m.birth_date),
    m.phone || '',
    kakao.raw || m.email || '',
    splitAffiliation(m.school_or_work || '').detail,
    [m.baptism_status, m.faith_duration].map((v) => (v || '').trim()).filter(Boolean).join('; '),
    m.pastoral_visit_requested ? 'O' : 'X',
    m.notes || '',
  ]
}

// 시트는 등록일 오름차순이다 — 새로 온 사람이 아래에 붙는 명단이라, 내보낸 줄을 맨 아래에
// 그대로 이어 붙일 수 있다 (탭 화면의 최신순과는 반대 방향). 등록일이 없는 사람은 맨 아래로.
function byRegistrationDate(a: Member, b: Member): number {
  const da = a.registration_date || '9999-99-99'
  const db = b.registration_date || '9999-99-99'
  return da.localeCompare(db) || a.name.localeCompare(b.name)
}

export interface NewFamilySheet {
  name: string
  aoa: (string | number | Date)[][]
  /** 칠할 칸들 (머리줄 전체 + 성별 칸). 색만 담고, 굵기·정렬은 쓰는 쪽이 얹는다. */
  fills: { r: number; c: number; rgb: string }[]
}

// Split into one sheet per 부서 (group_name), matching the legacy roster's 청년부/대학부
// tabs — only groups actually present in `members` get a sheet, in first-seen order. A
// blank/missing group_name falls back to a placeholder name (Excel rejects blank sheet names).
export function newFamilySheets(members: Member[]): NewFamilySheet[] {
  const order: string[] = []
  const byGroup = new Map<string, Member[]>()
  for (const m of members) {
    const key = m.group_name || '미지정'
    let bucket = byGroup.get(key)
    if (!bucket) {
      bucket = []
      byGroup.set(key, bucket)
      order.push(key)
    }
    bucket.push(m)
  }
  const header = newFamilyHeader()
  return order.map((name) => {
    const rows = [...byGroup.get(name)!].sort(byRegistrationDate)
    // 타입을 적어 준다: NEW_FAMILY_FILL이 `as const`라 그냥 두면 rgb가 그 한 색의 리터럴
    // 타입으로 좁혀져, 아래에서 성별 색을 밀어 넣을 수 없다.
    const fills: NewFamilySheet['fills'] = header.map((_, c) => ({ r: 0, c, rgb: NEW_FAMILY_FILL.header }))
    rows.forEach((m, i) => {
      const rgb = genderFill(m.gender)
      if (rgb) fills.push({ r: i + 1, c: GENDER_COL, rgb })
    })
    return { name, aoa: [header, ...rows.map(newFamilyRow)], fills }
  })
}

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Human-readable header date. ISO "2026-06-07" → "Sunday, June 7, 2026" (en) or
// "2026년 6월 7일 (일)" (ko). Parsed as a plain calendar date (no timezone shift).
export function formatHeaderDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  // Day-of-week via UTC to avoid local-timezone drift on the date boundary.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (lang === 'ko') return `${y}년 ${m}월 ${d}일 (${WEEKDAYS_KO[dow]})`
  return `${WEEKDAYS_EN[dow]}, ${MONTHS_EN[m - 1]} ${d}, ${y}`
}

// The 부서/동산 filter label shown in the Kakao/print header. Empty filter → "전체"/"All".
export function filterLabel(group: string, subgroup: string, lang: Lang): string {
  const parts = [group, subgroup].filter(Boolean)
  if (parts.length === 0) return lang === 'ko' ? '전체' : 'All'
  return parts.join(' · ')
}

export interface KakaoOpts {
  group: string
  subgroup: string
  lang: Lang
}

// Build the plain-text KakaoTalk attendance summary for `today`, respecting the active
// language and the current 부서/동산 filter. `members`/`log` are already scoped/filtered.
export function kakaoSummary(members: Member[], log: LogEntry[], today: string, opts: KakaoOpts): string {
  const { lang } = opts
  const L =
    lang === 'ko'
      ? { header: '📋 KCCP 출석 현황', count: (n: number) => `총 ${n}명 출석`, present: '✅ 출석:', visitor: '👥 방문 / 기타:', visitorTag: '방문자' }
      : { header: '📋 KCCP Attendance', count: (n: number) => `${n} present`, present: '✅ Present:', visitor: '👥 Visitors / Other:', visitorTag: 'visitor' }

  const todays = log.filter((e) => e.date === today)
  const memberNames = new Set(members.map((m) => m.name))

  // Regulars vs. visitors/others: an entry whose name isn't in the scoped member
  // roster, or is flagged visitor/guest, lands in the second list.
  const seenPresent = new Set<string>()
  const present: string[] = []
  const seenVisitor = new Set<string>()
  const visitors: string[] = []
  for (const e of [...todays].sort((a, b) => a.ts - b.ts)) {
    const isVisitor = e.memberRole === 'visitor' || e.memberRole === 'guest' || !memberNames.has(e.name)
    if (isVisitor) {
      if (seenVisitor.has(e.name)) continue
      seenVisitor.add(e.name)
      visitors.push(e.name)
    } else {
      if (seenPresent.has(e.name)) continue
      seenPresent.add(e.name)
      present.push(e.name)
    }
  }

  const lines: string[] = []
  lines.push(L.header)
  lines.push(`📅 ${formatHeaderDate(today, lang)} (${filterLabel(opts.group, opts.subgroup, lang)})`)
  lines.push(L.count(present.length))
  lines.push('')
  lines.push(L.present)
  if (present.length === 0) lines.push('—')
  else present.forEach((n, i) => lines.push(`${i + 1}. ${n}`))

  if (visitors.length > 0) {
    lines.push('')
    lines.push(L.visitor)
    visitors.forEach((n, i) => lines.push(`${i + 1}. ${n} (${L.visitorTag})`))
  }

  return lines.join('\n')
}

export interface ReportOpts {
  group: string
  subgroup: string
  today: string
  lang: Lang
  semesterDates?: CalendarLike
  // 로그인한 부 — 동산/셀 어휘를 고른다. 없으면 대학·청년부.
  partition?: Partition
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Full standalone HTML document for the PDF report. Mirrors the Excel "Attendance" sheet:
// one color-coded table per 동산 (single date-header row), O = present / X = absent cells, a
// per-member 예배 총 출석 count and a 총 출석 totals row, then a KEY legend. Date columns are the
// term's worship Sundays through `today` (see exportSundays); per-동산 colors match the legacy
// sheet. Self-contained (inline CSS), client-rendered; opens the print / Save-as-PDF dialog on load.
export function reportHtml(members: Member[], log: LogEntry[], opts: ReportOpts): string {
  const { lang } = opts
  const { unassigned: reportUnassigned } = unitTerms(opts.partition ?? 'youth', lang)
  const L =
    lang === 'ko'
      ? { title: 'KCCP 출석부', name: '이름', memberTotal: '예배 총 출석', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', etc: '기타', unassigned: reportUnassigned, newFamily: '새가족', save: 'PDF로 저장', empty: '출석 기록이 없습니다' }
      : { title: 'KCCP Attendance', name: 'Name', memberTotal: 'Worship Total', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', etc: 'Other', unassigned: reportUnassigned, newFamily: 'New family', save: 'Save as PDF', empty: 'No attendance records' }

  const model = buildAttendanceModel(
    members,
    log,
    exportSundays(opts.today, opts.semesterDates, opts.partition ?? 'youth'),
    opts.today,
    { unassigned: L.unassigned, newFamily: L.newFamily },
    attendanceGroupBy(opts.today, opts.semesterDates, L.unassigned, opts.partition ?? 'youth'),
  )
  const pink = cssColor(HEADER_TOTAL_FILL)

  const blocks = model.sections
    .map((s, si) => {
      const { light: lightArgb, medium: mediumArgb } = blockColors(si)
      const light = cssColor(lightArgb)
      const medium = cssColor(mediumArgb)
      const dateHead = model.dateLabels.map((d) => `<th style="background:${medium}">${escapeHtml(d)}</th>`).join('')
      const rows = s.rows
        .map((r) => {
          const cells = r.marks
            .map((c) => {
              if (c.kind === 'note') return `<td class="etc" colspan="${c.span}">${escapeHtml(c.note)}</td>`
              if (c.kind === 'inNote') return ''
              if (c.kind === 'present') return '<td class="o">O</td>'
              if (c.kind === 'absent') return '<td class="x">X</td>'
              return '<td></td>'
            })
            .join('')
          return `<tr><td class="name">${escapeHtml(r.member.name)}</td><td class="num">${r.total}</td>${cells}</tr>`
        })
        .join('')
      const totals = s.totals.map((n) => `<td class="num">${n}</td>`).join('')
      return `<section class="block">
  <h2 style="background:${medium}">${escapeHtml(s.subgroup)}</h2>
  <table>
    <thead>
      <tr><th class="name" style="background:${light}">${escapeHtml(L.name)}</th><th class="num" style="background:${pink}">${escapeHtml(L.memberTotal)}</th>${dateHead}</tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="total" colspan="2" style="background:${medium}">${escapeHtml(L.total)}</td>${totals}</tr></tfoot>
  </table>
</section>`
    })
    .join('')

  const content = model.sections.length ? blocks : `<p class="empty">${escapeHtml(L.empty)}</p>`

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(exportFilename(opts.group, opts.today).replace(/\.xlsx$/, ''))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; margin: 20px; color: #1f2937; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #6b7280; font-size: 13px; margin-bottom: 18px; }
  .block { margin-bottom: 22px; break-inside: avoid; }
  h2 { display: inline-block; font-size: 13px; font-weight: 700; margin: 0 0 6px; padding: 3px 12px; border-radius: 4px; color: #1f2937; }
  table { border-collapse: collapse; font-size: 11px; width: 100%; }
  th, td { border: 1px solid #b7b7b7; padding: 3px 6px; text-align: center; white-space: nowrap; }
  thead th { font-weight: 700; }
  td.name { text-align: left; }
  td.num, th.num { font-weight: 700; }
  td.o { color: #16a34a; font-weight: 700; }
  td.x { color: #dc2626; }
  td.etc { background: #CCCCCC; }
  td.total { text-align: left; font-weight: 700; }
  tfoot td.num { background: #fff; }
  tr { break-inside: avoid; }
  .key { margin-top: 8px; font-size: 12px; color: #374151; display: flex; gap: 16px; align-items: center; }
  .key .kchip { color: #fff; padding: 2px 10px; border-radius: 3px; }
  .empty { color: #9ca3af; }
  .actions { margin-bottom: 16px; }
  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: none; background: #4f46e5; color: #fff; cursor: pointer; }
  @page { size: landscape; margin: 12mm; }
  @media print { .actions { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">${escapeHtml(L.save)}</button></div>
  <h1>${escapeHtml(L.title)}</h1>
  <div class="sub">${escapeHtml(semesterLabel(opts.today, lang, opts.semesterDates, opts.partition ?? 'youth'))} · ${escapeHtml(formatHeaderDate(opts.today, lang))} · ${escapeHtml(filterLabel(opts.group, opts.subgroup, lang))}</div>
  ${content}
  <div class="key"><b class="kchip" style="background:${cssColor(KEY_FILL)}">${escapeHtml(L.key)}</b><span><b>O</b> ${escapeHtml(L.present)}</span><span><b>X</b> ${escapeHtml(L.absent)}</span><span><b class="kchip" style="background:${cssColor(NOTE_FILL)};color:#1f2937">&nbsp;&nbsp;&nbsp;</b> ${escapeHtml(L.etc)}</span></div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 350) })</script>
</body>
</html>`
}

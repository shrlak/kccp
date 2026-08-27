import type { Member, LogEntry } from '../../../lib/api'
import { seasonLabel, seasonName, seasonsOf, usesSemesters, type Partition } from '../../../lib/partition'
import {
  addIsoDays,
  calendarOf,
  termRange,
  type CalendarLike,
} from '../../../lib/semester'
import type { Season } from './newFamily'
import { sundaysBetween, termRangeFor } from './newFamily'
import {
  attendanceSheet,
  formatGridDate,
  logRows,
  periodGroupBy,
  sheetLabels,
  type Lang,
  type SheetData,
} from './exports'

// ── 지난 학기 / 연도 출석부 (archive exports) ─────────────────────────────────
// Once a 학기 (or the gap between two 학기) is over, its sheet stops changing — it becomes a
// record. The 출석부 tab lists every finished stretch here and hands it back as a downloadable
// Excel workbook: one term per sheet, plus a full log. Years are the same thing at a coarser
// grain — a 학년도 (2026–27, fall→fall) and a calendar year (2026) each collect the terms and
// gaps they contain into one workbook.
//
// Everything below is pure so it can be unit-tested; the XLSX.writeFile side lives in
// ArchiveSection.tsx, exactly as with gridSheet/ExportMenu.
//
// 동산 편성 is cleared the day a 학기 ends (the server's term rollover), so before wiping it
// the server freezes that term's assignment into config.dongsan_history and hands it back on
// the roster. A finished 학기's sheet is grouped by *that* snapshot when one exists — the
// snapshot is that term's whole truth, so today's 편성 never leaks back into a finished sheet;
// terms from before the snapshots existed fall back to the member's current 동산, which is the
// best the data allows. A 학년도/역년 workbook is just several of those sheets, so each term
// inside it keeps its own 동산 블록.
//
// Each period also carries its own roster (periodRoster): a finished stretch is a record of
// who was actually there, so someone who joined afterwards is left out of it and picks up in
// the next 학기 — or the next year's workbook — instead.

export type PeriodKind = 'semester' | 'transition'

// One stretch of the calendar: a configured 학기, or the gap between two of them.
export interface Period {
  kind: PeriodKind
  key: string // '2026-summer' | 'gap-2026-08-09'
  start: string // ISO, inclusive
  end: string // ISO, inclusive
  year: number
  season?: Season // semesters only
}

// Every period of calendar year `year`, chronological and gap-free: the wraparound gap that
// opened when last year's 가을학기 ended, 봄학기, its trailing gap, 여름학기, its trailing gap,
// 가을학기. The gap *after* 가을학기 belongs to the next year's list (it opens this December
// but is the run-up to next 봄학기), so consecutive years tile without overlapping.
export function periodsInYear(year: number, semesterDates?: CalendarLike, partition: Partition = 'youth'): Period[] {
  // Calendar order (봄 → 여름 → 가을), not the settings editor's academic display order.
  // 장년부는 상반기·하반기 둘뿐이고 (partition.ts seasonsOf), 그 둘이 한 해를 빈 곳 없이
  // 덮으므로 아래 gap 계산은 언제나 빈 결과를 낸다 — 그 부에는 전환 기간이 없다.
  const seasons: Season[] = seasonsOf(partition)
  const out: Period[] = []
  let prevEnd = termRangeFor(year - 1, seasons[seasons.length - 1], semesterDates, partition).end
  for (const season of seasons) {
    const { start, end } = termRangeFor(year, season, semesterDates, partition)
    const gapStart = addIsoDays(prevEnd, 1)
    const gapEnd = addIsoDays(start, -1)
    // Back-to-back terms (the defaults) leave no gap at all — then there's no period to add.
    if (gapStart <= gapEnd) {
      out.push({ kind: 'transition', key: `gap-${gapStart}`, start: gapStart, end: gapEnd, year })
    }
    out.push({ kind: 'semester', key: `${year}-${season}`, start, end, year, season })
    prevEnd = end
  }
  return out
}

// Every period overlapping [from, to], chronological. Spans as many calendar years as the
// range covers (+1, so a range ending inside a year-crossing gap still picks that gap up).
export function periodsBetween(from: string, to: string, semesterDates?: CalendarLike, partition: Partition = 'youth'): Period[] {
  const firstYear = Number(from.slice(0, 4))
  const lastYear = Number(to.slice(0, 4))
  const out: Period[] = []
  for (let y = firstYear; y <= lastYear + 1; y++) out.push(...periodsInYear(y, semesterDates, partition))
  return out.filter((p) => p.end >= from && p.start <= to).sort((a, b) => a.start.localeCompare(b.start))
}

// A period narrowed to [start, end] — a year's workbook shows only the slice of each term
// that falls inside that year.
export function clipPeriod(p: Period, start: string, end: string): Period {
  return { ...p, start: p.start > start ? p.start : start, end: p.end < end ? p.end : end }
}

// The 학년도 (US academic year) a date belongs to: the year whose 가을학기 opened it. Runs
// 가을 → 다음 가을 직전, so every date belongs to exactly one 학년도 (gaps included).
export function academicYearOf(date: string, semesterDates?: CalendarLike): number {
  const cal = calendarOf(semesterDates)
  const year = Number(date.slice(0, 4))
  return date >= termRange(year, 'fall', cal).start ? year : year - 1
}

export function academicYearBounds(year: number, semesterDates?: CalendarLike): { start: string; end: string } {
  const cal = calendarOf(semesterDates)
  return {
    start: termRange(year, 'fall', cal).start,
    end: addIsoDays(termRange(year + 1, 'fall', cal).start, -1),
  }
}

export interface RangeStats {
  records: number // attendance rows inside the range
  sundays: number // distinct worship dates that actually have attendance
}

export function rangeStats(log: LogEntry[], start: string, end: string): RangeStats {
  const days = new Set<string>()
  let records = 0
  for (const e of log) {
    if (e.date < start || e.date > end) continue
    records++
    days.add(e.date)
  }
  return { records, sundays: days.size }
}

export type ArchiveKind = PeriodKind | 'academicYear' | 'calendarYear'

// One downloadable archive: a finished 학기/전환 기간, a finished 학년도, or a finished
// calendar year. `periods` are the sheets its workbook carries (one per term/gap with data).
export interface ArchiveEntry extends RangeStats {
  id: string
  kind: ArchiveKind
  start: string
  end: string
  year: number
  season?: Season
  periods: Period[]
}

// The term/gap sheets a multi-period archive (year) is made of: everything overlapping the
// range, clipped to it, keeping only the ones that carry attendance — an all-blank 학기 from
// before the system was in use isn't worth a sheet.
function periodSheetsIn(
  log: LogEntry[],
  start: string,
  end: string,
  semesterDates?: CalendarLike,
  partition: Partition = 'youth',
): Period[] {
  return periodsBetween(start, end, semesterDates, partition)
    .map((p) => clipPeriod(p, start, end))
    .filter((p) => rangeStats(log, p.start, p.end).records > 0)
}

// Everything downloadable as of `today`, newest first: each finished 학기 and 전환 기간 that
// recorded attendance, then each finished 학년도 and calendar year. A period only shows up
// once it is fully over — the term still in progress is what the 내보내기 button already
// exports. Empty stretches (no attendance at all) are skipped.
export function archiveEntries(
  log: LogEntry[],
  today: string,
  semesterDates?: CalendarLike,
  partition: Partition = 'youth',
): ArchiveEntry[] {
  if (log.length === 0) return []
  const first = log.reduce((min, e) => (e.date < min ? e.date : min), log[0].date)
  const entries: ArchiveEntry[] = []

  for (const p of periodsBetween(first, today, semesterDates, partition)) {
    if (p.end >= today) continue
    const stats = rangeStats(log, p.start, p.end)
    if (stats.records === 0) continue
    entries.push({
      id: p.key,
      kind: p.kind,
      start: p.start,
      end: p.end,
      year: p.year,
      season: p.season,
      periods: [p],
      ...stats,
    })
  }

  // 학년도(가을~여름)는 학사 일정을 따르는 부에만 있다. 장년부의 한 해는 상반기·하반기
  // 둘로만 나뉘고 그 둘이 곧 역년이므로, 학년도를 따로 만들면 역년과 같은 것이 두 번 나온다.
  if (usesSemesters(partition)) {
    for (let y = academicYearOf(first, semesterDates); y <= academicYearOf(today, semesterDates); y++) {
      const { start, end } = academicYearBounds(y, semesterDates)
      if (end >= today) continue
      const stats = rangeStats(log, start, end)
      if (stats.records === 0) continue
      entries.push({
        id: `ay-${y}`,
        kind: 'academicYear',
        start,
        end,
        year: y,
        periods: periodSheetsIn(log, start, end, semesterDates, partition),
        ...stats,
      })
    }
  }

  for (let y = Number(first.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) {
    const start = `${y}-01-01`
    const end = `${y}-12-31`
    if (end >= today) continue
    const stats = rangeStats(log, start, end)
    if (stats.records === 0) continue
    entries.push({
      id: `cy-${y}`,
      kind: 'calendarYear',
      start,
      end,
      year: y,
      periods: periodSheetsIn(log, start, end, semesterDates, partition),
      ...stats,
    })
  }

  return entries.sort((a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start))
}

// The 학기/전환 기간 archives (one term each) and the 학년도/역년 archives (whole years) —
// the 출석부 tab lists them as two separate groups.
export function isYearArchive(e: ArchiveEntry): boolean {
  return e.kind === 'academicYear' || e.kind === 'calendarYear'
}

// ── Labels ───────────────────────────────────────────────────────────────────

// 이름표의 주인은 lib/partition.ts다 (부마다 토막을 뭐라 부르는지가 거기 있으므로).
export { seasonLabel }

// "06/07/2026 – 08/08/2026" — the same MM/DD/YYYY the sheet's date columns use.
export function rangeLabel(start: string, end: string): string {
  return `${formatGridDate(start)} – ${formatGridDate(end)}`
}

export function periodLabel(p: Period, lang: Lang, partition: Partition = 'youth'): string {
  if (p.kind === 'semester' && p.season) return seasonLabel(p.year, p.season, lang, partition)
  return lang === 'ko' ? '학기 사이 (전환 기간)' : 'Between terms'
}

export function archiveLabel(e: ArchiveEntry, lang: Lang, partition: Partition = 'youth'): string {
  if (e.kind === 'academicYear') {
    const next = String(e.year + 1).slice(2)
    return lang === 'ko' ? `${e.year}–${next} 학년도` : `${e.year}–${next} Academic Year`
  }
  if (e.kind === 'calendarYear') return lang === 'ko' ? `${e.year}년` : `${e.year}`
  return periodLabel({ kind: e.kind, key: e.id, start: e.start, end: e.end, year: e.year, season: e.season }, lang, partition)
}

// Filename for a downloaded archive, mirroring exportFilename's shape:
// kccp-attendance-{group?}-{2026-summer | transition-2026-08-09 | 2026-2027 | 2026}.xlsx
export function archiveFilename(e: ArchiveEntry, group: string): string {
  const g = group.trim().replace(/\s+/g, '')
  const tag =
    e.kind === 'semester' && e.season
      ? `${e.year}-${e.season}`
      : e.kind === 'transition'
        ? `transition-${e.start}`
        : e.kind === 'academicYear'
          ? `${e.year}-${e.year + 1}`
          : `${e.year}`
  return `kccp-attendance-${g ? `${g}-` : ''}${tag}.xlsx`
}

// Excel worksheet title for one period. Sheet names cap at 31 chars and reject : \ / ? * [ ],
// so the gap's dates use dots — and the whole thing is trimmed to fit.
export function sheetTitle(p: Period, lang: Lang, partition: Partition = 'youth'): string {
  const short = (iso: string) => iso.slice(5).replace('-', '.')
  const season = p.season ? seasonName(p.season, partition, lang) : ''
  const raw =
    p.kind === 'semester' && p.season
      ? lang === 'ko'
        ? partition === 'adult'
          ? `${p.year} ${season}`
          : `${p.year} ${season}학기`
        : `${season} ${p.year}`
      : lang === 'ko'
        ? `학기 사이 ${short(p.start)}-${short(p.end)}`
        : `Between ${short(p.start)}-${short(p.end)}`
  return raw.slice(0, 31)
}

// Excel rejects duplicate sheet names — a year workbook can hold two gaps whose trimmed
// titles collide, so later duplicates get a numeric suffix.
export function uniqueSheetNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.map((name) => {
    if (!seen.has(name)) {
      seen.add(name)
      return name
    }
    let n = 2
    let next = `${name.slice(0, 28)} ${n}`
    while (seen.has(next)) next = `${name.slice(0, 28)} ${++n}`
    seen.add(next)
    return next
  })
}

// ── Workbook ─────────────────────────────────────────────────────────────────

export interface ArchiveSheet {
  name: string
  data: SheetData
}

export interface ArchiveWorkbook {
  sheets: ArchiveSheet[] // one Attendance-style sheet per term/gap, chronological
  log: (string | number)[][] // the "Full Log" sheet, scoped to the archive's range
}

// The grouping for one archived period: a 학기 with a frozen 동산 편성 groups by *that*
// (the live assignment was cleared when the term ended), any other 학기 by the member's
// current 동산, and a gap by 부서 — the same rule the live sheet follows.
//
// When a snapshot exists it is the term's *only* source of 동산: someone it doesn't cover was
// unassigned back then, so they land under 동산 미지정 rather than under whatever 동산 they
// were put in during a later term. Otherwise a finished 학기 would sprout blocks that did not
// exist while it ran, and re-downloading the same term after a reassignment would hand back a
// different sheet.
export function archiveGroupBy(
  period: Period,
  unassigned: string,
  history?: DongsanHistory | null,
): (m: Member) => string {
  const frozen = period.kind === 'semester' ? history?.[period.key]?.subgroups : undefined
  if (!frozen) return periodGroupBy(period.kind, unassigned)
  return (m: Member) => frozen[m.id] || unassigned
}

// The per-term 동산 snapshots the server hands back on the roster, keyed by term key.
export type DongsanHistory = Record<string, { endedAt?: string; subgroups: Record<string, string> }>

// ── 기간별 명단 (period rosters) ──────────────────────────────────────────────

// name → the earliest date that name appears in the log. The archive uses it as a stand-in
// 등록일 for the members whose registration_date was never filled in: someone whose very
// first check-in lands after a period ended was not part of that period.
export function firstSeenByName(log: LogEntry[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of log) {
    const seen = out.get(e.name)
    if (!seen || e.date < seen) out.set(e.name, e.date)
  }
  return out
}

// What periodRoster needs to judge one period, built once per workbook.
export interface PeriodRosterIndex {
  attended: Set<string> // names with at least one check-in inside the period
  frozen?: Record<string, string> // that 학기's 동산 snapshot, when there is one
  firstSeen: Map<string, string> // name → first check-in ever (the 등록일 stand-in)
}

// Was this member part of `period`? A finished stretch's sheet should hold the people who
// were actually in it, and nobody else:
//  · 그 기간에 출석했거나 그 학기 동산 스냅샷에 이름이 있으면 — 있었다는 증거 — 무조건 포함.
//  · 등록일이 있으면 기간이 끝나기 전에 등록한 사람만. 그 뒤에 등록한 사람은 이 기간이 아니라
//    다음 학기(또는 다음 연도 워크북)에서 처음 나온다.
//  · 등록일이 없으면 첫 출석일이 그 기준을 대신하고, 출석 기록조차 없으면 지난 기간에서 뺀다 —
//    지금 명단에만 있는 사람이 몇 해 전 학기 시트에 끼어들지 않도록.
export function memberInPeriod(m: Member, period: Period, index: PeriodRosterIndex): boolean {
  if (index.attended.has(m.name)) return true
  if (index.frozen?.[m.id]) return true
  const joined = m.registration_date || index.firstSeen.get(m.name)
  return !!joined && joined <= period.end
}

// One period's roster, in roster order. `log` is the whole log, not the period's slice — the
// dates outside the period are what tell us when someone first showed up.
export function periodRoster(
  members: Member[],
  period: Period,
  log: LogEntry[],
  history?: DongsanHistory | null,
  firstSeen: Map<string, string> = firstSeenByName(log),
): Member[] {
  const attended = new Set<string>()
  for (const e of log) if (e.date >= period.start && e.date <= period.end) attended.add(e.name)
  const frozen = period.kind === 'semester' ? history?.[period.key]?.subgroups : undefined
  return members.filter((m) => memberInPeriod(m, period, { attended, frozen, firstSeen }))
}

// The people a whole archive covers: the union of its periods' rosters, in roster order. The
// Full Log sheet scores its 합계 column over exactly these, so a year workbook's totals agree
// with the term sheets above it. Falls back to the full roster if an archive somehow carries
// no periods, so the log never comes out with every total zeroed.
function archiveRoster(members: Member[], rosters: Member[][]): Member[] {
  if (rosters.length === 0) return members
  const ids = new Set<string>()
  for (const roster of rosters) for (const m of roster) ids.add(m.id)
  return members.filter((m) => ids.has(m.id))
}

// Everything a downloaded archive contains. Each period carries its own roster (the people
// who were in it) and is scored over *its own* worship Sundays — the whole set, with dates
// the church didn't meet (or didn't record) staying blank — and grouped by 동산 for a 학기
// (its frozen 편성 when there is one), by 부서 for a gap.
export function archiveWorkbook(
  entry: ArchiveEntry,
  members: Member[],
  log: LogEntry[],
  lang: Lang,
  history?: DongsanHistory | null,
  partition: Partition = 'youth',
): ArchiveWorkbook {
  const { unassigned } = sheetLabels(lang, partition)
  const names = uniqueSheetNames(entry.periods.map((p) => sheetTitle(p, lang, partition)))
  // Computed once over the whole log, then shared by every period of the workbook.
  const firstSeen = firstSeenByName(log)
  const rosters = entry.periods.map((p) => periodRoster(members, p, log, history, firstSeen))
  const sheets = entry.periods.map((p, i) => ({
    name: names[i],
    data: attendanceSheet(
      rosters[i],
      log.filter((e) => e.date >= p.start && e.date <= p.end),
      lang,
      sundaysBetween(p.start, p.end),
      // The period is over, so its own end stands in for "today": nothing inside it is
      // upcoming, and every recorded Sunday scores O/X.
      p.end,
      archiveGroupBy(p, unassigned, history),
      partition,
    ),
  }))
  const scoped = log.filter((e) => e.date >= entry.start && e.date <= entry.end)
  return { sheets, log: logRows(archiveRoster(members, rosters), scoped, lang, partition) }
}

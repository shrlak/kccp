import { describe, it, expect } from 'vitest'
import {
  periodsInYear,
  periodsBetween,
  clipPeriod,
  academicYearOf,
  academicYearBounds,
  rangeStats,
  archiveEntries,
  isYearArchive,
  archiveLabel,
  archiveFilename,
  periodLabel,
  rangeLabel,
  sheetTitle,
  uniqueSheetNames,
  archiveWorkbook,
  archiveGroupBy,
  firstSeenByName,
  periodRoster,
  type ArchiveEntry,
  type Period,
} from './archive'
import type { Member, LogEntry } from '../../../lib/api'
import type { SemesterDates } from '../../../lib/semester'

// The church's actual saved schedule: terms with real breaks between them
// (05/10–06/06, 08/09–09/05, 12/14–12/31).
const dates: SemesterDates = {
  spring: { start: '01-01', end: '05-09' },
  summer: { start: '06-07', end: '08-08' },
  fall: { start: '09-06', end: '12-13' },
}

const member = (id: string, name: string, subgroup = '건영동산', extra: Partial<Member> = {}): Member => ({
  id, name, group_name: '청년부', subgroup, member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: false, notes: '', ...extra,
})
const entry = (name: string, date: string, ts = 1, subgroup = '건영동산'): LogEntry => ({
  name, group: '청년부', subgroup, date, time: '01:15:23 PM', ts,
})

describe('periodsInYear', () => {
  it('tiles the year gap-free: the run-up to 봄, each term, and the breaks between them', () => {
    expect(periodsInYear(2026, dates)).toEqual([
      // Opened when 2025 가을 ended (12/14/2025) and runs to the day before 봄 starts.
      { kind: 'transition', key: 'gap-2025-12-14', start: '2025-12-14', end: '2025-12-31', year: 2026 },
      { kind: 'semester', key: '2026-spring', start: '2026-01-01', end: '2026-05-09', year: 2026, season: 'spring' },
      { kind: 'transition', key: 'gap-2026-05-10', start: '2026-05-10', end: '2026-06-06', year: 2026 },
      { kind: 'semester', key: '2026-summer', start: '2026-06-07', end: '2026-08-08', year: 2026, season: 'summer' },
      { kind: 'transition', key: 'gap-2026-08-09', start: '2026-08-09', end: '2026-09-05', year: 2026 },
      { kind: 'semester', key: '2026-fall', start: '2026-09-06', end: '2026-12-13', year: 2026, season: 'fall' },
    ])
  })
  it('consecutive years tile without overlapping — 가을의 뒷 공백은 다음 해 목록에만', () => {
    const y2026 = periodsInYear(2026, dates)
    const y2027 = periodsInYear(2027, dates)
    expect(y2026[y2026.length - 1].end).toBe('2026-12-13')
    expect(y2027[0]).toEqual({ kind: 'transition', key: 'gap-2026-12-14', start: '2026-12-14', end: '2026-12-31', year: 2027 })
  })
  it('emits no transition periods when the terms run back-to-back (the defaults)', () => {
    expect(periodsInYear(2026).every((p) => p.kind === 'semester')).toBe(true)
  })
})

describe('periodsBetween', () => {
  it('returns only the periods overlapping the range, chronologically', () => {
    expect(periodsBetween('2026-06-20', '2026-09-10', dates).map((p) => p.key)).toEqual([
      '2026-summer',
      'gap-2026-08-09',
      '2026-fall',
    ])
  })
  it('picks up a gap that crosses the new year', () => {
    expect(periodsBetween('2026-12-20', '2027-01-05', dates).map((p) => p.key)).toEqual([
      'gap-2026-12-14',
      '2027-spring',
    ])
  })
})

describe('clipPeriod', () => {
  it('narrows a period to the requested window, leaving inner bounds alone', () => {
    const p = periodsInYear(2026, dates)[1] // 봄학기 01/01–05/09
    expect(clipPeriod(p, '2026-02-01', '2026-12-31')).toMatchObject({ start: '2026-02-01', end: '2026-05-09' })
    expect(clipPeriod(p, '2026-01-01', '2026-03-01')).toMatchObject({ start: '2026-01-01', end: '2026-03-01' })
  })
})

describe('academicYear', () => {
  it('runs 가을 → 다음 가을 직전, so every date lands in exactly one 학년도', () => {
    expect(academicYearBounds(2026, dates)).toEqual({ start: '2026-09-06', end: '2027-09-05' })
    expect(academicYearOf('2026-09-06', dates)).toBe(2026)
    expect(academicYearOf('2026-09-05', dates)).toBe(2025) // still last 학년도
    expect(academicYearOf('2027-06-01', dates)).toBe(2026) // 여름 of the 2026–27 year
  })
})

describe('rangeStats', () => {
  const log = [entry('A', '2026-06-07'), entry('B', '2026-06-07'), entry('A', '2026-06-14'), entry('A', '2026-09-06')]
  it('counts records and distinct worship dates inside the range only', () => {
    expect(rangeStats(log, '2026-06-07', '2026-08-08')).toEqual({ records: 3, sundays: 2 })
    expect(rangeStats(log, '2026-09-06', '2026-12-13')).toEqual({ records: 1, sundays: 1 })
    expect(rangeStats(log, '2026-01-01', '2026-05-09')).toEqual({ records: 0, sundays: 0 })
  })
})

describe('archiveEntries', () => {
  // Attendance across 여름학기, the gap after it, and 가을학기 of 2026.
  const log = [
    entry('A', '2026-06-07'), entry('B', '2026-06-07'), entry('A', '2026-07-05'),
    entry('A', '2026-08-16'), // transition-period 예배
    entry('A', '2026-09-06'), entry('A', '2026-11-01'),
  ]

  it('lists nothing while the first term is still running', () => {
    expect(archiveEntries(log, '2026-07-06', dates)).toEqual([])
  })

  it('adds the term the day after it ends', () => {
    expect(archiveEntries(log, '2026-08-08', dates)).toEqual([]) // last day — not over yet
    const after = archiveEntries(log, '2026-08-09', dates)
    expect(after.map((e) => e.id)).toEqual(['2026-summer'])
    expect(after[0]).toMatchObject({ kind: 'semester', start: '2026-06-07', end: '2026-08-08', records: 3, sundays: 2 })
  })

  it('archives a finished transition gap as its own entry', () => {
    const ids = archiveEntries(log, '2026-09-06', dates).filter((e) => !isYearArchive(e)).map((e) => e.id)
    expect(ids).toEqual(['gap-2026-08-09', '2026-summer'])
    // 가을학기 opening that same day also closed the 2025–26 학년도, so the year archive
    // for it lands alongside them.
    expect(archiveEntries(log, '2026-09-06', dates).some((e) => e.id === 'ay-2025')).toBe(true)
  })

  it('skips periods with no attendance at all', () => {
    // 2026 봄학기 ended before any attendance existed → not offered as an archive.
    expect(archiveEntries(log, '2026-12-31', dates).some((e) => e.id === '2026-spring')).toBe(false)
  })

  it('adds the calendar year once it is over, with every period it contains as a sheet', () => {
    const entries = archiveEntries(log, '2027-01-01', dates)
    const year = entries.find((e) => e.id === 'cy-2026')!
    expect(year).toMatchObject({ kind: 'calendarYear', start: '2026-01-01', end: '2026-12-31', records: 6 })
    // Only the periods that carry attendance become sheets (봄학기 and its gap are dropped).
    expect(year.periods.map((p) => p.key)).toEqual(['2026-summer', 'gap-2026-08-09', '2026-fall'])
  })

  it('adds the 학년도 once its next 가을 starts, spanning fall → the following summer', () => {
    expect(archiveEntries(log, '2027-01-01', dates).some((e) => e.id === 'ay-2026')).toBe(false)
    const entries = archiveEntries(log, '2027-09-06', dates)
    const ay = entries.find((e) => e.id === 'ay-2026')!
    expect(ay).toMatchObject({ kind: 'academicYear', start: '2026-09-06', end: '2027-09-05' })
    expect(ay.periods.map((p) => p.key)).toEqual(['2026-fall'])
    // 2025–26 covers the 여름학기 and the gap that preceded 2026 가을.
    const prev = entries.find((e) => e.id === 'ay-2025')!
    expect(prev.periods.map((p) => p.key)).toEqual(['2026-summer', 'gap-2026-08-09'])
  })

  it('sorts newest first and splits terms from years', () => {
    const entries = archiveEntries(log, '2027-09-06', dates)
    const ends = entries.map((e) => e.end)
    expect([...ends].sort((a, b) => b.localeCompare(a))).toEqual(ends)
    expect(entries.filter(isYearArchive).map((e) => e.id).sort()).toEqual(['ay-2025', 'ay-2026', 'cy-2026'])
  })

  it('returns nothing for an empty log', () => {
    expect(archiveEntries([], '2027-01-01', dates)).toEqual([])
  })
})

describe('labels and filenames', () => {
  const entries = archiveEntries(
    [entry('A', '2026-06-07'), entry('A', '2026-08-16'), entry('A', '2026-09-06')],
    '2027-09-06',
    dates,
  )
  const byId = (id: string) => entries.find((e) => e.id === id)!

  it('names each archive kind in both languages', () => {
    expect(archiveLabel(byId('2026-summer'), 'ko')).toBe('2026 여름 학기')
    expect(archiveLabel(byId('2026-summer'), 'en')).toBe('Summer 2026')
    expect(archiveLabel(byId('gap-2026-08-09'), 'ko')).toBe('학기 사이 (전환 기간)')
    expect(archiveLabel(byId('ay-2026'), 'ko')).toBe('2026–27 학년도')
    expect(archiveLabel(byId('ay-2026'), 'en')).toBe('2026–27 Academic Year')
    expect(archiveLabel(byId('cy-2026'), 'ko')).toBe('2026년')
    expect(archiveLabel(byId('cy-2026'), 'en')).toBe('2026')
  })

  it('formats the range the way the sheet formats its date columns', () => {
    expect(rangeLabel('2026-06-07', '2026-08-08')).toBe('06/07/2026 – 08/08/2026')
  })

  it('builds a filename per archive kind, carrying the 부서 filter like the other exports', () => {
    expect(archiveFilename(byId('2026-summer'), '')).toBe('kccp-attendance-2026-summer.xlsx')
    expect(archiveFilename(byId('2026-summer'), '청년부')).toBe('kccp-attendance-청년부-2026-summer.xlsx')
    expect(archiveFilename(byId('gap-2026-08-09'), '')).toBe('kccp-attendance-transition-2026-08-09.xlsx')
    expect(archiveFilename(byId('ay-2026'), '')).toBe('kccp-attendance-2026-2027.xlsx')
    expect(archiveFilename(byId('cy-2026'), '')).toBe('kccp-attendance-2026.xlsx')
  })

  it('keeps Excel sheet titles short, legal and unique', () => {
    const summer = periodsInYear(2026, dates)[3]
    const gap = periodsInYear(2026, dates)[4]
    expect(periodLabel(summer, 'ko')).toBe('2026 여름 학기')
    expect(sheetTitle(summer, 'ko')).toBe('2026 여름학기')
    expect(sheetTitle(summer, 'en')).toBe('Summer 2026')
    expect(sheetTitle(gap, 'ko')).toBe('학기 사이 08.09-09.05')
    for (const p of periodsInYear(2026, dates)) {
      expect(sheetTitle(p, 'ko').length).toBeLessThanOrEqual(31)
      expect(sheetTitle(p, 'ko')).not.toMatch(/[:\\/?*[\]]/)
    }
    expect(uniqueSheetNames(['A', 'B', 'A', 'A'])).toEqual(['A', 'B', 'A 2', 'A 3'])
  })
})

describe('archiveWorkbook', () => {
  const members = [
    member('1', 'A'),
    member('2', 'B', '중호동산'),
    member('3', 'C', '건영동산', { registration_date: '2026-10-04' }), // joined in 가을
  ]
  const log = [
    entry('A', '2026-06-07'), entry('B', '2026-06-07', 2, '중호동산'),
    entry('A', '2026-08-16'), entry('B', '2026-08-16', 4, '중호동산'),
    entry('A', '2026-09-06'), entry('C', '2026-10-04', 6),
  ]
  const entries = archiveEntries(log, '2027-01-01', dates)

  it('gives a semester archive one sheet of that term only, over its full Sunday set', () => {
    const wb = archiveWorkbook(entries.find((e) => e.id === '2026-summer')!, members, log, 'ko')
    expect(wb.sheets.map((s) => s.name)).toEqual(['2026 여름학기'])
    const header = wb.sheets[0].data.aoa[0]
    // 06/07 → 08/02: every Sunday of the term, not just the ones with data.
    expect(header.slice(0, 3)).toEqual(['', '이름', '예배 총 출석'])
    expect(header[3]).toBe('06/07/2026')
    expect(header[header.length - 1]).toBe('08/02/2026')
    // 동산 blocks (건영동산 first, then 중호동산) — a term groups by 동산.
    const first = wb.sheets[0].data.aoa.find((r) => r[1] === 'A')!
    expect(first[0]).toBe('건영동산')
    expect(first[2]).toBe(1) // A attended one Sunday of the term
    // C registered after the term ended → not in it at all.
    expect(wb.sheets[0].data.aoa.some((r) => r[1] === 'C')).toBe(false)
  })

  it('groups a transition-period archive by 부서 instead of 동산', () => {
    const wb = archiveWorkbook(entries.find((e) => e.id === 'gap-2026-08-09')!, members, log, 'ko')
    const rows = wb.sheets[0].data.aoa.filter((r) => r[1] === 'A' || r[1] === 'B')
    expect(rows[0][0]).toBe('청년부') // the block label is the 부서
    expect(wb.sheets[0].data.aoa.some((r) => r[0] === '건영동산')).toBe(false)
  })

  it('gives a year archive one sheet per period that carries attendance, plus the full log', () => {
    const wb = archiveWorkbook(entries.find((e) => e.id === 'cy-2026')!, members, log, 'ko')
    expect(wb.sheets.map((s) => s.name)).toEqual(['2026 여름학기', '학기 사이 08.09-09.05', '2026 가을학기'])
    // Full Log: header + every record of the year, newest first.
    expect(wb.log[0]).toEqual(['이름', '부서', '동산', '날짜', '시간', '합계', '비고'])
    expect(wb.log.length).toBe(1 + log.length)
  })

  it('scores O/X across the whole archived period — nothing is treated as upcoming', () => {
    const wb = archiveWorkbook(entries.find((e) => e.id === '2026-summer')!, members, log, 'ko')
    const aRow = wb.sheets[0].data.aoa.find((r) => r[1] === 'A')!
    expect(aRow[3]).toBe('O') // 06/07 present
    // The remaining Sundays have no attendance at all → attendance wasn't taken → blank.
    expect(aRow.slice(4).every((c) => c === '')).toBe(true)
  })
})

describe('archiveWorkbook with a frozen 동산 편성', () => {
  // 학기가 끝나면 서버가 동산 편성을 비우므로 (term rollover), 지난 학기 시트는 비워지기 전에
  // 얼려둔 스냅샷으로 묶여야 한다 — 지금 명단의 subgroup은 모두 비어 있다.
  const members = [
    member('1', 'A', ''),
    member('2', 'B', ''),
    member('3', 'C', ''),
  ]
  const log = [
    entry('A', '2026-06-07', 1, ''), entry('B', '2026-06-07', 2, ''),
    entry('C', '2026-06-14', 3, ''),
  ]
  const entries = archiveEntries(log, '2026-09-06', dates)
  const summer = entries.find((e) => e.id === '2026-summer')!
  const history = {
    '2026-summer': { endedAt: '2026-08-09', subgroups: { '1': '건영동산', '2': '건영동산', '3': '중호동산' } },
  }

  it('groups the term by the 동산 people were in, not by their (now empty) current one', () => {
    const wb = archiveWorkbook(summer, members, log, 'ko', history)
    // 블록 이름은 각 동산 첫 멤버 행의 A열 (KEY 범례 행이 아니라 총계가 숫자인 행).
    const blocks = wb.sheets[0].data.aoa.filter((r) => r[0] && typeof r[2] === 'number').map((r) => r[0])
    expect(blocks).toEqual(['건영동산', '중호동산'])
    expect(archiveGroupBy(summer.periods[0], '동산 미지정', history)(members[0])).toBe('건영동산')
  })

  it('falls back to 동산 미지정 for a member the snapshot never covered', () => {
    const groupBy = archiveGroupBy(summer.periods[0], '동산 미지정', history)
    expect(groupBy(member('9', 'Z', ''))).toBe('동산 미지정')
    // 지금 편성이 있어도 그 학기 스냅샷이 기준 — 나중에 들어간 동산이 끝난 학기 시트에
    // 블록으로 끼어들면 안 된다.
    expect(groupBy(member('9', 'Z', '새동산'))).toBe('동산 미지정')
  })

  it("keeps a finished term's blocks stable when someone is reassigned later", () => {
    const before = archiveWorkbook(summer, members, log, 'ko', history)
    // A가 이번 학기에 새 동산으로 옮겨져도 지난 여름학기 시트는 그대로여야 한다.
    const reassigned = [member('1', 'A', '새동산'), members[1], members[2]]
    const after = archiveWorkbook(summer, reassigned, log, 'ko', history)
    expect(after.sheets[0].data.aoa).toEqual(before.sheets[0].data.aoa)
    const blocks = after.sheets[0].data.aoa.filter((r) => r[0] && typeof r[2] === 'number').map((r) => r[0])
    expect(blocks).toEqual(['건영동산', '중호동산'])
  })

  it('uses the current 동산 when no snapshot exists for that term (pre-rollover archives)', () => {
    const assigned = [member('1', 'A', '건영동산'), member('3', 'C', '중호동산')]
    const wb = archiveWorkbook(summer, assigned, log, 'ko')
    // 블록 이름은 각 동산 첫 멤버 행의 A열 (KEY 범례 행이 아니라 총계가 숫자인 행).
    const blocks = wb.sheets[0].data.aoa.filter((r) => r[0] && typeof r[2] === 'number').map((r) => r[0])
    expect(blocks).toEqual(['건영동산', '중호동산'])
  })

  it('never applies a snapshot to a transition gap — those group by 부서', () => {
    const gap = entries.find((e) => e.id === 'gap-2026-08-09')
    if (gap) expect(archiveGroupBy(gap.periods[0], '동산 미지정', history)(members[0])).toBe('청년부')
  })
})

describe('firstSeenByName', () => {
  it('takes the earliest date per name, whatever order the log arrives in', () => {
    const seen = firstSeenByName([entry('A', '2026-09-13', 2), entry('A', '2026-06-07'), entry('B', '2026-08-16', 3)])
    expect(seen.get('A')).toBe('2026-06-07')
    expect(seen.get('B')).toBe('2026-08-16')
    expect(seen.get('Z')).toBeUndefined()
  })
})

describe('기간별 명단 (periodRoster)', () => {
  const summer: Period = {
    kind: 'semester', key: '2026-summer', start: '2026-06-07', end: '2026-08-08', year: 2026, season: 'summer',
  }
  const fall: Period = {
    kind: 'semester', key: '2026-fall', start: '2026-09-06', end: '2026-12-13', year: 2026, season: 'fall',
  }
  const log = [entry('A', '2026-06-07'), entry('A', '2026-09-13', 2), entry('C', '2026-09-13', 3)]
  const roster = [
    member('1', 'A', ''), // 등록일 없음, 여름부터 출석
    member('2', 'B', '', { registration_date: '2026-10-04' }), // 가을에 등록
    member('3', 'C', ''), // 등록일 없음, 첫 출석이 가을
    member('4', 'D', ''), // 등록일도 출석 기록도 없음
    member('5', 'E', '', { registration_date: '2026-01-15' }), // 봄 등록, 출석은 없음
  ]

  it('leaves out anyone who joined after the term ended', () => {
    expect(periodRoster(roster, summer, log).map((m) => m.name)).toEqual(['A', 'E'])
  })

  it('picks them up in the next term instead', () => {
    expect(periodRoster(roster, fall, log).map((m) => m.name)).toEqual(['A', 'B', 'C', 'E'])
  })

  it("keeps a member the term's 동산 snapshot covers, even with no 등록일 or 출석", () => {
    const history = { '2026-summer': { endedAt: '2026-08-09', subgroups: { '4': '건영동산' } } }
    expect(periodRoster(roster, summer, log, history).map((m) => m.name)).toEqual(['A', 'D', 'E'])
  })

  it('never lets a snapshot vouch for someone during a transition gap', () => {
    const gap: Period = { kind: 'transition', key: 'gap-2026-08-09', start: '2026-08-09', end: '2026-09-05', year: 2026 }
    const history = { '2026-summer': { endedAt: '2026-08-09', subgroups: { '4': '건영동산' } } }
    expect(periodRoster(roster, gap, log, history).map((m) => m.name)).toEqual(['A', 'E'])
  })
})

describe('연도 워크북은 학기별 동산·명단을 그대로 유지한다', () => {
  // A는 여름 건영동산 → 가을 중호동산으로 옮겼고, B는 가을에 등록했다.
  const members = [member('1', 'A', ''), member('2', 'B', '', { registration_date: '2026-09-20' })]
  const log = [entry('A', '2026-06-07', 1, ''), entry('A', '2026-09-13', 2, ''), entry('B', '2026-09-20', 3, '')]
  const history = {
    '2026-summer': { endedAt: '2026-08-09', subgroups: { '1': '건영동산' } },
    '2026-fall': { endedAt: '2026-12-14', subgroups: { '1': '중호동산', '2': '새가족동산' } },
  }
  const year = archiveEntries(log, '2027-01-01', dates).find((e) => e.id === 'cy-2026')!
  const wb = archiveWorkbook(year, members, log, 'ko', history)
  const sheet = (name: string) => wb.sheets.find((s) => s.name === name)!.data.aoa

  it('groups each sheet by the 동산 that term actually ran with', () => {
    const blocks = (name: string) =>
      sheet(name).filter((r) => r[0] && typeof r[2] === 'number').map((r) => r[0])
    expect(blocks('2026 여름학기')).toEqual(['건영동산'])
    expect(blocks('2026 가을학기')).toEqual(['중호동산', '새가족동산'])
  })

  it('starts a later registrant at the term they joined, not the ones before it', () => {
    expect(sheet('2026 여름학기').map((r) => r[1])).not.toContain('B')
    expect(sheet('2026 가을학기').map((r) => r[1])).toContain('B')
    expect(sheet('2026 여름학기').map((r) => r[1])).toContain('A')
  })

  it('scores the Full Log 합계 over the archive’s own people', () => {
    expect(wb.log.find((r) => r[0] === 'B')![5]).toBe(1)
  })
})

describe('archive entry shape', () => {
  it('exposes the stats the list row renders', () => {
    const [e] = archiveEntries([entry('A', '2026-06-07'), entry('B', '2026-06-07')], '2026-08-09', dates)
    const shape: ArchiveEntry = e
    expect(shape.records).toBe(2)
    expect(shape.sundays).toBe(1)
  })
})

describe('장년부의 한 해 — 상반기·하반기, 전환 기간 없음', () => {
  it('periodsInYear가 두 토막으로 한 해를 빈 곳 없이 덮는다', () => {
    const ps = periodsInYear(2026, undefined, 'adult')
    expect(ps.map((p) => [p.kind, p.start, p.end])).toEqual([
      ['semester', '2026-01-01', '2026-06-30'],
      ['semester', '2026-07-01', '2026-12-31'],
    ])
  })

  it('저장된 학기 일정을 무시한다 — 장년부의 경계는 고정이다', () => {
    const custom = { fall: { start: '08-15', end: '12-31' }, spring: { start: '01-01', end: '05-09' }, summer: { start: '06-01', end: '07-31' } }
    expect(periodsInYear(2026, custom, 'adult').map((p) => p.start)).toEqual(['2026-01-01', '2026-07-01'])
  })

  it('아카이브에 학년도가 없다 — 상·하반기와 역년만', () => {
    const log = [
      { id: 1, name: '가', date: '2026-03-01', ts: 0 },
      { id: 2, name: '가', date: '2026-09-06', ts: 0 },
    ] as unknown as LogEntry[]
    const kinds = archiveEntries(log, '2027-02-01', undefined, 'adult').map((e) => e.kind)
    expect(kinds).not.toContain('academicYear')
    expect(kinds).toContain('calendarYear')
    expect(kinds.filter((k) => k === 'semester')).toHaveLength(2)
  })
})

import { describe, it, expect } from 'vitest'
import {
  trendSeries,
  groupSeries,
  monthlySummary,
  semesterSummary,
  weeklyRecap,
  recapText,
  newFamilyRegistrations,
  newFamilyTrend,
  newFamilyMonthly,
  newFamilyTotals,
} from './analytics'
import type { Member, LogEntry } from '../../../lib/api'

const m = (name: string, group = '청년부', subgroup = '호연'): Member => ({
  id: name, name, group_name: group, subgroup, member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
const e = (name: string, date: string, group = '청년부', firstVisit = false): LogEntry => ({
  name, group, subgroup: '호연', date, time: '', ts: 0, firstVisit,
})

describe('trendSeries', () => {
  it('counts distinct attendees per date, ascending', () => {
    const log = [e('A', '2026-06-07'), e('B', '2026-06-07'), e('A', '2026-05-31')]
    expect(trendSeries(log)).toEqual([
      { date: '2026-05-31', count: 1 },
      { date: '2026-06-07', count: 2 },
    ])
  })
  it('de-dupes a member counted twice on one date', () => {
    const log = [e('A', '2026-06-07'), e('A', '2026-06-07')]
    expect(trendSeries(log)).toEqual([{ date: '2026-06-07', count: 1 }])
  })
  it('is empty for an empty log', () => {
    expect(trendSeries([])).toEqual([])
  })
})

describe('groupSeries', () => {
  const members = [m('A', '대학부'), m('B', '청년부'), m('C', '청년부')]
  const log = [
    e('A', '2026-06-07', '대학부'),
    e('B', '2026-06-07', '청년부'),
    e('C', '2026-06-07', '청년부'),
    e('A', '2026-05-31', '대학부'),
  ]

  it('produces a per-date count array per 부서 in preferred order', () => {
    const s = groupSeries(members, log)
    expect(s.dates).toEqual(['2026-05-31', '2026-06-07'])
    expect(s.groups).toEqual(['대학부', '청년부'])
    expect(s.counts['대학부']).toEqual([1, 1])
    expect(s.counts['청년부']).toEqual([0, 2])
  })
  it('counts by the log group label', () => {
    const s = groupSeries([m('A', '대학부')], [e('A', '2026-06-07', '대학부')])
    expect(s.counts['대학부']).toEqual([1])
  })
})

describe('monthlySummary', () => {
  const log = [
    e('A', '2026-06-07', '청년부', true),
    e('B', '2026-06-07'),
    e('A', '2026-06-14'),
    e('C', '2026-05-31'),
  ]
  it('aggregates sundays, attendees, and first-visits per month, newest first', () => {
    const rows = monthlySummary([], log)
    expect(rows.map((r) => r.month)).toEqual(['2026-06', '2026-05'])
    expect(rows[0]).toEqual({ month: '2026-06', sundays: 2, attendees: 2, firstVisits: 1 })
    expect(rows[1]).toEqual({ month: '2026-05', sundays: 1, attendees: 1, firstVisits: 0 })
  })
})

describe('semesterSummary', () => {
  const log = [
    e('A', '2026-03-01'), // H1
    e('B', '2026-06-30'), // H1
    e('A', '2026-07-01', '청년부', true), // H2
    e('C', '2025-11-02'), // 2025 H2
  ]
  it('splits at month 6/7 and labels the half, newest first', () => {
    const rows = semesterSummary([], log)
    expect(rows.map((r) => r.key)).toEqual(['2026-H2', '2026-H1', '2025-H2'])
    expect(rows[0]).toMatchObject({ year: 2026, half: 2, sundays: 1, attendees: 1, firstVisits: 1 })
    expect(rows[1]).toMatchObject({ year: 2026, half: 1, sundays: 2, attendees: 2, firstVisits: 0 })
    expect(rows[2]).toMatchObject({ year: 2025, half: 2 })
  })
})

describe('weeklyRecap', () => {
  it('returns the last 7 dates newest-first with counts', () => {
    const log = Array.from({ length: 9 }, (_, i) => e('A', `2026-04-${String(i + 1).padStart(2, '0')}`))
    const rows = weeklyRecap(log)
    expect(rows).toHaveLength(7)
    expect(rows[0].date).toBe('2026-04-09')
    expect(rows[6].date).toBe('2026-04-03')
  })
  it('counts distinct attendance and first-visits per date', () => {
    const log = [e('A', '2026-06-07', '청년부', true), e('B', '2026-06-07'), e('A', '2026-06-07')]
    expect(weeklyRecap(log)).toEqual([{ date: '2026-06-07', attendance: 2, firstVisits: 1 }])
  })
})

describe('recapText', () => {
  it('formats rows as date · attendance · ★firstVisits lines', () => {
    const text = recapText([
      { date: '2026-06-07', attendance: 42, firstVisits: 3 },
      { date: '2026-05-31', attendance: 40, firstVisits: 0 },
    ])
    expect(text).toBe('2026-06-07 · 42 · ★3\n2026-05-31 · 40 · ★0')
  })
})

describe('immutability', () => {
  it('does not mutate the input log', () => {
    const log = [e('A', '2026-06-07'), e('B', '2026-05-31')]
    const snapshot = JSON.stringify(log)
    trendSeries(log)
    groupSeries([m('A')], log)
    monthlySummary([], log)
    semesterSummary([], log)
    weeklyRecap(log)
    expect(JSON.stringify(log)).toBe(snapshot)
  })
})

// ── 새가족 ────────────────────────────────────────────────────────────────
// nf(): 새가족 한 명. 등록일이 없는 새가족(카드에 날짜가 안 적힌 사람)이 실제로 있으므로
// 그 경우도 그대로 표현할 수 있게 둔다.
const nf = (name: string, registration_date: string | null, edu = false): Member => ({
  ...m(name),
  is_new_member: true,
  registration_date,
  new_member_edu_week1: edu,
  new_member_edu_week2: edu,
})
// 로그 한 줄에 memberId를 달아 준다 — 새가족 판정의 진짜 열쇠.
const eid = (member: Member, date: string): LogEntry => ({ ...e(member.name, date), memberId: member.id })

describe('newFamilyRegistrations', () => {
  it('counts registrations per month, oldest first, filling the empty months', () => {
    const members = [nf('A', '2026-01-04'), nf('B', '2026-01-18'), nf('C', '2026-03-01'), m('기존')]
    expect(newFamilyRegistrations(members)).toEqual([
      { month: '2026-01', count: 2 },
      { month: '2026-02', count: 0 },
      { month: '2026-03', count: 1 },
    ])
  })
  it('spans a year boundary', () => {
    expect(newFamilyRegistrations([nf('A', '2025-12-07'), nf('B', '2026-01-11')])).toEqual([
      { month: '2025-12', count: 1 },
      { month: '2026-01', count: 1 },
    ])
  })
  it('drops 새가족 with no 등록일, and is empty with no dated 새가족', () => {
    expect(newFamilyRegistrations([nf('A', null), m('기존')])).toEqual([])
  })
})

describe('newFamilyTrend', () => {
  const a = nf('A', '2026-05-31')
  const b = nf('B', '2026-06-07')
  const old = m('기존')
  it('counts 새가족 attendees per date alongside the date total', () => {
    const log = [eid(a, '2026-06-07'), eid(b, '2026-06-07'), eid(old, '2026-06-07'), eid(a, '2026-05-31')]
    expect(newFamilyTrend([a, b, old], log)).toEqual([
      { date: '2026-05-31', count: 1, newFamily: 1, total: 1 },
      { date: '2026-06-07', count: 2, newFamily: 2, total: 3 },
    ])
  })
  it('falls back to the name for rows with no memberId', () => {
    const log = [e('A', '2026-06-07'), e('기존', '2026-06-07')]
    expect(newFamilyTrend([a, old], log)).toEqual([{ date: '2026-06-07', count: 1, newFamily: 1, total: 2 }])
  })

  // 교육 단계로 가르기 — 새가족 교육 탭의 네 갈래와 같은 규칙.
  const done = nf('이수', '2026-05-31', true)
  const w1 = { ...nf('1주차', '2026-05-31'), new_member_edu_week1: true }
  const w2 = { ...nf('2주차', '2026-05-31'), new_member_edu_week2: true }
  const none = nf('미수강', '2026-05-31')
  const cohortMembers = [done, w1, w2, none, old]
  const cohortLog = [eid(done, '2026-06-07'), eid(w1, '2026-06-07'), eid(w2, '2026-06-07'), eid(none, '2026-06-07'), eid(old, '2026-06-07')]

  it('splits by education stage, keeping the 새가족 총계 and the date total beside it', () => {
    for (const [edu, name] of [['both', '이수'], ['week1', '1주차'], ['week2', '2주차'], ['none', '미수강']] as const) {
      expect(newFamilyTrend(cohortMembers, cohortLog, edu), name).toEqual([
        { date: '2026-06-07', count: 1, newFamily: 4, total: 5 },
      ])
    }
  })
  it('counts every 새가족 with the default (all)', () => {
    expect(newFamilyTrend(cohortMembers, cohortLog)).toEqual([{ date: '2026-06-07', count: 4, newFamily: 4, total: 5 }])
  })
  it('never lets a plain member fall into 미수강 — the stages live inside 새가족', () => {
    // 기존 멤버도 교육 칸이 비어 있지만 새가족이 아니므로 어느 갈래에도 들어가지 않는다.
    expect(newFamilyTrend([none, old], [eid(none, '2026-06-07'), eid(old, '2026-06-07')], 'none')).toEqual([
      { date: '2026-06-07', count: 1, newFamily: 1, total: 2 },
    ])
  })
})

describe('newFamilyMonthly', () => {
  it('pairs registrations with attendance and the share of that month', () => {
    const a = nf('A', '2026-06-07')
    const old = m('기존')
    const log = [eid(a, '2026-06-07'), eid(old, '2026-06-07'), eid(old, '2026-06-14')]
    expect(newFamilyMonthly([a, old], log)).toEqual([
      { month: '2026-06', registered: 1, attendees: 1, share: 50 },
    ])
  })
  it('keeps a month that has registrations but no attendance yet', () => {
    const a = nf('A', '2026-07-05')
    expect(newFamilyMonthly([a], [])).toEqual([{ month: '2026-07', registered: 1, attendees: 0, share: 0 }])
  })
  it('is newest month first', () => {
    const a = nf('A', '2026-05-03')
    const b = nf('B', '2026-06-07')
    expect(newFamilyMonthly([a, b], []).map((r) => r.month)).toEqual(['2026-06', '2026-05'])
  })
})

describe('newFamilyTotals', () => {
  const term = { start: '2026-06-01', end: '2026-08-31' }
  const inTerm = nf('A', '2026-06-07')
  const before = nf('B', '2026-03-01', true)
  const undated = nf('C', null)
  const old = m('기존')
  const members = [inTerm, before, undated, old]

  it('separates the term, the undated, and the 교육 이수', () => {
    const totals = newFamilyTotals(members, [], term)
    expect(totals.total).toBe(3)
    expect(totals.thisTerm).toBe(1)
    expect(totals.undated).toBe(1)
    expect(totals.eduDone).toBe(1)
  })
  it('counts 새가족 seen in the last 4 recorded Sundays only', () => {
    const log = [
      eid(before, '2026-05-03'), // 5주 전 — 창 밖
      eid(inTerm, '2026-06-07'),
      eid(inTerm, '2026-06-14'),
      eid(old, '2026-06-21'),
      eid(old, '2026-06-28'),
      eid(old, '2026-07-05'),
    ]
    const totals = newFamilyTotals(members, log, term)
    expect(totals.recent).toBe(1)
    expect(totals.recentWeeks).toBe(4)
  })
  it('reports how many Sundays were actually counted when the log is shorter', () => {
    expect(newFamilyTotals(members, [eid(inTerm, '2026-06-07')], term).recentWeeks).toBe(1)
  })
})

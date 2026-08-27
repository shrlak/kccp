import { describe, it, expect } from 'vitest'
import {
  todaysCheckins,
  weeklyComparison,
  presentNamesToday,
  checkinCandidates,
  todayKind,
  countTodayKinds,
  filterTodayByKind,
  presentToday,
  cameToday,
} from './today'
import type { LogEntry, Member } from '../../../lib/api'

const e = (name: string, date: string, ts: number, firstVisit = false): LogEntry => ({
  name, group: '', subgroup: '', date, time: '', ts, firstVisit,
})
const member = (id: string, name: string): Member => ({
  id, name, group_name: '', subgroup: '', member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})

const log: LogEntry[] = [
  e('A', '2026-06-07', 3),
  e('B', '2026-06-07', 1),
  e('A', '2026-05-31', 0),
  e('C', '2026-05-31', 0),
]

describe('today helpers', () => {
  it('todaysCheckins filters by date, newest first', () => {
    expect(todaysCheckins(log, '2026-06-07').map((x) => x.name)).toEqual(['A', 'B'])
  })
  it('todaysCheckins is empty when none match', () => {
    expect(todaysCheckins(log, '2026-06-14')).toEqual([])
  })
  it('weeklyComparison: today vs the most recent prior date', () => {
    expect(weeklyComparison(log, '2026-06-07')).toEqual({ thisWeek: 2, lastWeek: 2, delta: 0 })
  })
  it('weeklyComparison: no prior date → lastWeek 0', () => {
    expect(weeklyComparison(log, '2026-05-31')).toEqual({ thisWeek: 2, lastWeek: 0, delta: 2 })
  })
})

describe('manual check-in helpers', () => {
  it('presentNamesToday collects distinct names present on the date', () => {
    const s = presentNamesToday(log, '2026-06-07')
    expect([...s].sort()).toEqual(['A', 'B'])
    expect(s.has('C')).toBe(false)
  })
  it('checkinCandidates filters by query and sorts by name', () => {
    const members = [member('1', 'Chan'), member('2', 'Anna'), member('3', 'Bob')]
    expect(checkinCandidates(members, '').map((m) => m.name)).toEqual(['Anna', 'Bob', 'Chan'])
    expect(checkinCandidates(members, 'an').map((m) => m.name)).toEqual(['Anna', 'Chan'])
  })
})

describe('오늘 명단을 종류로 가르기', () => {
  const visitor = { ...e('방문', '2026-06-07', 5), memberRole: 'visitor' }
  const newbie = e('새신자', '2026-06-07', 4)
  const regular = e('기존', '2026-06-07', 3)
  const entries = [visitor, newbie, regular]
  const newMemberNames = new Set(['새신자'])

  it('todayKind: 방문자 → visitor, 오늘 등록한 새가족 → newFamily, 나머지는 member', () => {
    expect(todayKind(visitor, newMemberNames)).toBe('visitor')
    expect(todayKind(newbie, newMemberNames)).toBe('newFamily')
    expect(todayKind(regular, newMemberNames)).toBe('member')
  })
  it('방문자가 새가족 명단에도 있으면 방문자로 센다 (checkinTag와 같은 우선순위)', () => {
    expect(todayKind(visitor, new Set(['방문']))).toBe('visitor')
  })
  it('countTodayKinds: 0인 종류도 자리를 지킨다', () => {
    expect(countTodayKinds(entries, newMemberNames)).toEqual({ newFamily: 1, visitor: 1, member: 1 })
    expect(countTodayKinds([], newMemberNames)).toEqual({ newFamily: 0, visitor: 0, member: 0 })
  })
  it('filterTodayByKind: all은 그대로, 나머지는 그 종류만 (순서 유지)', () => {
    expect(filterTodayByKind(entries, newMemberNames, 'all')).toEqual(entries)
    expect(filterTodayByKind(entries, newMemberNames, 'newFamily').map((x) => x.name)).toEqual(['새신자'])
    expect(filterTodayByKind(entries, newMemberNames, 'visitor').map((x) => x.name)).toEqual(['방문'])
    expect(filterTodayByKind(entries, newMemberNames, 'member').map((x) => x.name)).toEqual(['기존'])
  })
})

describe('오늘 왔는가', () => {
  const m = { ...member('m1', '김지체'), id: 'm1' }
  const withId: LogEntry = { ...e('김지체', '2026-06-07', 2), memberId: 'm1' }
  // 멤버가 지워져 member_id가 NULL이 된 예전 줄 — 이름으로만 되찾을 수 있다.
  const nameOnly: LogEntry = { ...e('박이름', '2026-06-07', 1), memberId: null }

  it('id로 찾는다', () => {
    expect(cameToday(m, presentToday([withId], '2026-06-07'))).toBe(true)
  })
  it('id가 없는 예전 줄은 이름으로 되찾는다', () => {
    expect(cameToday(member('m9', '박이름'), presentToday([nameOnly], '2026-06-07'))).toBe(true)
  })
  it('다른 날 출석은 오늘이 아니다', () => {
    expect(cameToday(m, presentToday([withId], '2026-06-14'))).toBe(false)
  })
  it('아무 줄도 없으면 아무도 오지 않았다', () => {
    expect(cameToday(m, presentToday([], '2026-06-07'))).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { computeStats, leaderDashboard } from './stats'
import type { Member, LogEntry } from '../../../lib/api'

const m = (name: string): Member => ({
  id: name, name, group_name: '청년부', subgroup: '호연', member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
const e = (name: string, date: string): LogEntry => ({
  name, group: '청년부', subgroup: '호연', date, time: '', ts: 0,
})

const members = [m('A'), m('B'), m('C')]
const log = [e('A', '2026-06-07'), e('B', '2026-06-07'), e('A', '2026-05-31')]

describe('computeStats', () => {
  it('counts today attendees, members, records, and distinct days', () => {
    expect(computeStats(members, log, '2026-06-07')).toEqual({ today: 2, members: 3, records: 3, days: 2 })
  })
  it('today is 0 when no one is in', () => {
    expect(computeStats(members, log, '2026-06-14').today).toBe(0)
  })
})

describe('leaderDashboard', () => {
  it('computes present/absent + absent names for today', () => {
    const d = leaderDashboard(members, log, '2026-06-07')
    expect(d.total).toBe(3)
    expect(d.present).toBe(2)
    expect(d.absent).toBe(1)
    expect(d.absentNames).toEqual(['C'])
  })
  it('avgRate averages attendance over the last (≤4) recorded dates', () => {
    // 2026-05-31: 1/3 ≈ 33%, 2026-06-07: 2/3 ≈ 67% → avg ≈ 50%
    expect(leaderDashboard(members, log, '2026-06-07').avgRate).toBe(50)
  })
  it('avgRate is 0 with no members', () => {
    expect(leaderDashboard([], log, '2026-06-07').avgRate).toBe(0)
  })
  it('excludes members from dates before their 등록일자', () => {
    // C registered 2026-06-01 → 05-31 denominator is 2 (1/2 = 50%), 06-07 is 3 (2/3 ≈ 67%) → avg ≈ 58%
    const withReg = [m('A'), m('B'), { ...m('C'), registration_date: '2026-06-01' }]
    expect(leaderDashboard(withReg, log, '2026-06-07').avgRate).toBe(58)
  })
})

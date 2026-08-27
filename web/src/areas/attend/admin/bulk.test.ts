import { describe, it, expect } from 'vitest'
import { memberIdsPresentOn, toggleId } from './bulk'
import type { LogEntry } from '../../../lib/api'

const e = (memberId: string, date: string): LogEntry => ({
  memberId, name: 'X', group: '', subgroup: '', date, time: '', ts: 0,
})

describe('memberIdsPresentOn', () => {
  const log: LogEntry[] = [e('m1', '2026-06-07'), e('m2', '2026-06-07'), e('m1', '2026-05-31')]
  it('collects member ids present on the date', () => {
    expect([...memberIdsPresentOn(log, '2026-06-07')].sort()).toEqual(['m1', 'm2'])
  })
  it('is empty for a date with no entries', () => {
    expect(memberIdsPresentOn(log, '2026-06-14').size).toBe(0)
  })
  it('ignores entries without a member id', () => {
    expect(memberIdsPresentOn([{ ...e('', '2026-06-07'), memberId: null }], '2026-06-07').size).toBe(0)
  })
})

describe('toggleId', () => {
  it('adds an absent id and removes a present one, immutably', () => {
    const a = new Set<string>(['x'])
    const b = toggleId(a, 'y')
    expect([...b].sort()).toEqual(['x', 'y'])
    expect([...a]).toEqual(['x']) // original unchanged
    expect([...toggleId(b, 'x')]).toEqual(['y'])
  })
})

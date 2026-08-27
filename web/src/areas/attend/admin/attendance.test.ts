import { describe, it, expect } from 'vitest'
import { memberHistory, hasEntryOn } from './attendance'
import type { LogEntry } from '../../../lib/api'

const e = (id: number | undefined, memberId: string, date: string, ts: number): LogEntry => ({
  id, memberId, name: 'X', group: '', subgroup: '', date, time: '', ts,
})

const log: LogEntry[] = [
  e(1, 'm1', '2026-05-31', 10),
  e(2, 'm1', '2026-06-07', 20),
  e(3, 'm2', '2026-06-07', 21),
  e(undefined, 'm1', '2026-06-14', 30), // no row id → not editable
]

describe('memberHistory', () => {
  it('returns the member\'s entries with an id, newest date first', () => {
    expect(memberHistory(log, 'm1').map((x) => x.id)).toEqual([2, 1])
  })
  it('excludes other members', () => {
    expect(memberHistory(log, 'm2').map((x) => x.id)).toEqual([3])
  })
  it('is empty for an unknown member', () => {
    expect(memberHistory(log, 'nope')).toEqual([])
  })
})

describe('hasEntryOn', () => {
  it('detects an existing member+date entry', () => {
    expect(hasEntryOn(log, 'm1', '2026-06-07')).toBe(true)
    expect(hasEntryOn(log, 'm1', '2026-06-08')).toBe(false)
    expect(hasEntryOn(log, 'm2', '2026-05-31')).toBe(false)
  })
})

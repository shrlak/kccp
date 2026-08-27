import { describe, it, expect } from 'vitest'
import { buildGrid, shortDate } from './sheet'
import type { Member, LogEntry } from '../../../lib/api'

const member = (id: string, name: string): Member => ({
  id, name, group_name: '', subgroup: '', member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
const entry = (name: string, date: string, ts: number): LogEntry => ({
  name, group: '', subgroup: '', date, time: '', ts,
})

describe('buildGrid', () => {
  const members = [member('1', 'A'), member('2', 'B')]
  const log = [entry('A', '2026-06-07', 2), entry('A', '2026-05-31', 1), entry('B', '2026-06-07', 3)]

  it('collects ascending distinct dates', () => {
    expect(buildGrid(members, log).dates).toEqual(['2026-05-31', '2026-06-07'])
  })
  it('computes per-member totals and presence by name', () => {
    const { rows } = buildGrid(members, log)
    expect(rows[0].total).toBe(2)
    expect(rows[0].present.has('2026-05-31')).toBe(true)
    expect(rows[1].total).toBe(1)
    expect(rows[1].present.has('2026-05-31')).toBe(false)
  })
  it('a member with no attendance has total 0', () => {
    expect(buildGrid([member('3', 'C')], log).rows[0].total).toBe(0)
  })
})

describe('shortDate', () => {
  it('formats month/day without leading zeros', () => {
    expect(shortDate('2026-06-07')).toBe('6/7')
    expect(shortDate('2026-12-25')).toBe('12/25')
  })
})

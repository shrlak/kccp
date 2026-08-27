import { describe, it, expect } from 'vitest'
import type { LogEntry } from '../../../lib/api'
import { isVisitorEntry, visitorsByDate, visitCounts } from './visitors'

const guest = (name: string, date: string, ts: number, role = 'visitor'): LogEntry => ({
  name, group: '', subgroup: '', date, time: '10:01', ts, memberRole: role, memberId: null,
})
const member = (name: string, date: string, ts: number): LogEntry => ({
  name, group: '대학부', subgroup: '1동산', date, time: '10:00', ts,
})

describe('isVisitorEntry', () => {
  it('matches visitor and legacy guest roles, not members', () => {
    expect(isVisitorEntry(guest('박방문', '2026-06-28', 1))).toBe(true)
    expect(isVisitorEntry(guest('박방문', '2026-06-28', 1, 'guest'))).toBe(true)
    expect(isVisitorEntry(member('김지체', '2026-06-28', 1))).toBe(false)
  })
})

describe('visitorsByDate', () => {
  it('keeps only visitor rows, grouped by date newest-first, arrival order within a date', () => {
    const log = [
      member('김지체', '2026-07-05', 10),
      guest('나중이', '2026-06-28', 22),
      guest('먼저니', '2026-06-28', 21),
      guest('박방문', '2026-07-05', 30),
    ]
    const groups = visitorsByDate(log)
    expect(groups.map((g) => g.date)).toEqual(['2026-07-05', '2026-06-28'])
    expect(groups[0].entries.map((e) => e.name)).toEqual(['박방문'])
    // Within a date the earlier check-in comes first regardless of input order.
    expect(groups[1].entries.map((e) => e.name)).toEqual(['먼저니', '나중이'])
  })

  it('collapses same-name duplicates on one date to the first check-in', () => {
    const groups = visitorsByDate([
      guest('박방문', '2026-06-28', 5),
      guest('박방문', '2026-06-28', 9),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].entries).toHaveLength(1)
    expect(groups[0].entries[0].ts).toBe(5)
  })

  it('returns [] when the log has no visitors', () => {
    expect(visitorsByDate([member('김지체', '2026-07-05', 1)])).toEqual([])
  })
})

describe('visitCounts', () => {
  it('counts distinct visit dates per name', () => {
    const groups = visitorsByDate([
      guest('박방문', '2026-06-21', 1),
      guest('박방문', '2026-06-28', 2),
      guest('한번이', '2026-06-28', 3),
    ])
    const counts = visitCounts(groups)
    expect(counts.get('박방문')).toBe(2)
    expect(counts.get('한번이')).toBe(1)
  })
})

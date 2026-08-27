import type { Member, LogEntry } from '../../../lib/api'

export interface GridRow {
  member: Member
  total: number
  present: Set<string>
}
export interface Grid {
  dates: string[]
  rows: GridRow[]
}

// Build a members × dates attendance grid from the scoped roster. Attendance is matched
// to members by name (the denormalized log carries the name). Dates are ascending.
export function buildGrid(members: Member[], log: LogEntry[]): Grid {
  const dates = [...new Set(log.map((e) => e.date))].sort()
  const byName = new Map<string, Set<string>>()
  for (const e of log) {
    let set = byName.get(e.name)
    if (!set) {
      set = new Set<string>()
      byName.set(e.name, set)
    }
    set.add(e.date)
  }
  const rows: GridRow[] = members.map((member) => {
    const present = byName.get(member.name) ?? new Set<string>()
    return { member, total: present.size, present }
  })
  return { dates, rows }
}

// "2026-06-07" → "6/7" (month/day, no leading zeros) for compact column headers.
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

// "2026-06" → "26.6" — compact axis label for the 월별 charts. 연도를 떼지 않는 이유는
// 12개월 창이 늘 해를 한 번 넘기 때문이다 — "1"이 어느 해 1월인지 보여야 한다.
export function shortMonth(iso: string): string {
  const [y, m] = iso.split('-')
  return `${y.slice(2)}.${parseInt(m, 10)}`
}

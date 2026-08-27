import type { LogEntry } from '../../../lib/api'

// A 방문자 (guest) attendance row: kiosk/public guest check-ins carry member_role
// 'visitor' ('guest' on legacy rows) and no member link.
export function isVisitorEntry(e: LogEntry): boolean {
  return e.memberRole === 'visitor' || e.memberRole === 'guest'
}

export interface VisitorDateGroup {
  date: string
  entries: LogEntry[]
}

// Every 방문자 check-in — past and today — grouped by date, newest date first; within a
// date in order of arrival (earliest first). The server dedupes guest check-ins by
// name+date on insert, but restored backups may not be — a same-name duplicate on one
// date keeps its first check-in.
export function visitorsByDate(log: LogEntry[]): VisitorDateGroup[] {
  const byDate = new Map<string, LogEntry[]>()
  const seen = new Set<string>()
  for (const e of log.filter(isVisitorEntry).sort((a, b) => a.ts - b.ts)) {
    const key = `${e.date}|${e.name}`
    if (!e.name || seen.has(key)) continue
    seen.add(key)
    const list = byDate.get(e.date) ?? []
    list.push(e)
    byDate.set(e.date, list)
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, entries]) => ({ date, entries }))
}

// Distinct visit dates per visitor name — powers the 재방문 (returning) badge.
export function visitCounts(groups: VisitorDateGroup[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const g of groups) for (const e of g.entries) counts.set(e.name, (counts.get(e.name) ?? 0) + 1)
  return counts
}

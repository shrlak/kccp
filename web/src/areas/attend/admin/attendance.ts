import type { LogEntry } from '../../../lib/api'

// A member's attendance history (by member id), newest date first. Only entries that
// carry a stable row id are returned — those are the ones the editor can remove.
export function memberHistory(log: LogEntry[], memberId: string): LogEntry[] {
  return log
    .filter((e) => e.memberId === memberId && e.id !== undefined)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.ts - a.ts))
}

// Whether the member already has an entry on the given date (drives the add guard).
export function hasEntryOn(log: LogEntry[], memberId: string, date: string): boolean {
  return log.some((e) => e.memberId === memberId && e.date === date)
}

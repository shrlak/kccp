import type { LogEntry } from '../../../lib/api'

// Member ids already present on the given date — shown as ✓ (and excluded from the add).
export function memberIdsPresentOn(log: LogEntry[], date: string): Set<string> {
  const present = new Set<string>()
  for (const e of log) {
    if (e.date === date && e.memberId) present.add(e.memberId)
  }
  return present
}

// Toggle one id in a selection set, returning a new set (immutable update).
export function toggleId(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

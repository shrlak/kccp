import type { Member, LogEntry } from '../../../lib/api'
import { ADULT_GROUP } from '../../../lib/partition'

// group ('') = all groups; subgroup ('') = all 동산 within the chosen group.
export interface Filter {
  group: string
  subgroup: string
}

export const NO_FILTER: Filter = { group: '', subgroup: '' }

// Preferred department order; anything else falls to the end, alphabetically. Both 부's
// 부서 are listed — a roster only ever contains one 부's people (the server scopes it), so
// this is just a stable ordering, not a claim that they appear together.
const GROUP_ORDER = ['대학부', '청년부', ADULT_GROUP, 'EM', 'Adult Ministry']
const groupRank = (g: string) => {
  const i = GROUP_ORDER.indexOf(g)
  return i === -1 ? GROUP_ORDER.length : i
}

// Distinct, non-empty groups present among the members, in the preferred order.
export function groupsOf(members: Member[]): string[] {
  const set = new Set(members.map((m) => m.group_name).filter(Boolean))
  return [...set].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b))
}

// Distinct, non-empty 동산 for a group (or across all groups when group is ''), sorted.
export function subgroupsOf(members: Member[], group: string): string[] {
  const set = new Set(
    members.filter((m) => !group || m.group_name === group).map((m) => m.subgroup).filter(Boolean),
  )
  return [...set].sort((a, b) => a.localeCompare(b))
}

export function filterMembers(members: Member[], f: Filter): Member[] {
  return members.filter((m) => (!f.group || m.group_name === f.group) && (!f.subgroup || m.subgroup === f.subgroup))
}

export function filterLog(log: LogEntry[], f: Filter): LogEntry[] {
  return log.filter((e) => (!f.group || e.group === f.group) && (!f.subgroup || e.subgroup === f.subgroup))
}

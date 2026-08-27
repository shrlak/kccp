import type { LogEntry } from '../../../lib/api'
import { groupsOfPartition, type Partition } from '../../../lib/partition'

// ── Today's printable check-in sheet (pure model) ────────────────────────────
// A numbered roll sheet for a single 부서: 60 slots laid out in 4 columns of 15.
// Members who checked in today drop into the slots in the order they checked in.
// The DOM/canvas rendering + image download live in todaySheetImage.ts.

// The departments that each get their own sheet page — 대학부/청년부 for the KM panel,
// 장년부 alone for the 장년부 panel. Callers pass the logged-in 부.
export function todaySheetGroups(partition: Partition = 'youth'): string[] {
  return groupsOfPartition(partition)
}

export const TODAY_SHEET_SLOTS = 60
export const TODAY_SHEET_COLUMNS = 4
export const TODAY_SHEET_ROWS = TODAY_SHEET_SLOTS / TODAY_SHEET_COLUMNS // 15

// A check-in's special status, surfaced with an icon on the sheet: 새가족 (new family
// member) or 방문자 (guest/visitor). Regular members carry no tag.
export type TodaySheetTag = 'newFamily' | 'visitor' | null

export interface TodayRosterEntry {
  name: string
  tag: TodaySheetTag
}

// A single check-in's tag: 방문자 by the log row's guest role, 새가족 by the roster
// flag (name in `newMemberNames`); regular members carry no tag. Callers pass only the
// 새가족 who registered *on that day* (registeredOnDate), so the 새가족 mark means "newly
// registered today" — 새가족 from earlier weeks show up unmarked, like any other member.
// Shared between the exported 출석부 and the 오늘 tab's live list so both mark people
// identically.
export function checkinTag(e: LogEntry, newMemberNames: ReadonlySet<string>): TodaySheetTag {
  if (e.memberRole === 'visitor' || e.memberRole === 'guest') return 'visitor'
  if (newMemberNames.has(e.name)) return 'newFamily'
  return null
}

// The people who checked in today for `group`, in order of check-in (earliest first),
// deduped — a member who checked in twice keeps their first (earliest) slot. Each entry
// is tagged 방문자 (a visitor/guest role) or 새가족 (their name is in `newMemberNames`).
export function todayGroupRoster(
  log: LogEntry[],
  today: string,
  group: string,
  newMemberNames: ReadonlySet<string>,
): TodayRosterEntry[] {
  const seen = new Set<string>()
  const entries: TodayRosterEntry[] = []
  for (const e of log.filter((e) => e.date === today && e.group === group).sort((a, b) => a.ts - b.ts)) {
    if (!e.name || seen.has(e.name)) continue
    seen.add(e.name)
    entries.push({ name: e.name, tag: checkinTag(e, newMemberNames) })
  }
  return entries
}

export interface TodaySheetSlot {
  num: number
  name: string
  tag: TodaySheetTag
}

// The 60 numbered slots filled column-major: slots 1–15 run down the first column,
// 16–30 the second, and so on. Empty (not-yet-checked-in) slots have name '' and no tag.
export function todaySheetSlots(entries: TodayRosterEntry[]): TodaySheetSlot[] {
  return Array.from({ length: TODAY_SHEET_SLOTS }, (_, i) => ({
    num: i + 1,
    name: entries[i]?.name ?? '',
    tag: entries[i]?.tag ?? null,
  }))
}

// Image filename: kccp-today-{group}-{YYYY-MM-DD}.{ext}.
export function todaySheetFilename(group: string, date: string, ext: 'png' | 'jpg'): string {
  const g = group.trim().replace(/\s+/g, '')
  return `kccp-today-${g ? `${g}-` : ''}${date}.${ext}`
}

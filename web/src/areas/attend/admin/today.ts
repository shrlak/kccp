import type { LogEntry, Member } from '../../../lib/api'
import { checkinTag } from './todaySheet'

// Today's check-ins, newest first.
export function todaysCheckins(log: LogEntry[], today: string): LogEntry[] {
  return log.filter((e) => e.date === today).sort((a, b) => b.ts - a.ts)
}

// Names already present today — used to mark/disable them in the manual check-in picker.
export function presentNamesToday(log: LogEntry[], today: string): Set<string> {
  return new Set(log.filter((e) => e.date === today).map((e) => e.name))
}

// ── 오늘 명단을 종류로 가르기 ─────────────────────────────────────────────────
// 오늘 온 사람은 세 종류다: 오늘 등록한 **새가족**, **방문자**, 그리고 나머지 **기존 멤버**.
// 가르는 기준은 `checkinTag` 하나 — 오늘 탭의 이름표, 내보내는 출석부 이미지, 그리고 이
// 분류가 같은 함수를 보므로 **칩으로 고른 묶음과 화면에 붙은 이름표가 어긋나지 않는다**.
// (그래서 여기서 말하는 새가족은 '오늘 등록한' 새가족이다 — 지난주에 등록하고 오늘 온
//  사람은 새가족 교육 탭의 '오늘 출석' 필터가 맡는다.)
export type TodayKind = 'newFamily' | 'visitor' | 'member'
export type TodayKindFilter = 'all' | TodayKind

export function todayKind(e: LogEntry, newMemberNames: ReadonlySet<string>): TodayKind {
  return checkinTag(e, newMemberNames) ?? 'member'
}

// 칩에 적을 수. 0인 종류도 자리를 지킨다 — 종류는 닫힌 집합이라 칩이 나타났다 사라지면
// 매번 다시 찾게 된다.
export function countTodayKinds(
  entries: LogEntry[],
  newMemberNames: ReadonlySet<string>,
): Record<TodayKind, number> {
  const counts: Record<TodayKind, number> = { newFamily: 0, visitor: 0, member: 0 }
  for (const e of entries) counts[todayKind(e, newMemberNames)]++
  return counts
}

export function filterTodayByKind(
  entries: LogEntry[],
  newMemberNames: ReadonlySet<string>,
  filter: TodayKindFilter,
): LogEntry[] {
  if (filter === 'all') return entries
  return entries.filter((e) => todayKind(e, newMemberNames) === filter)
}

// ── 오늘 왔는가 ───────────────────────────────────────────────────────────────
// 출석 줄에서 사람을 되찾는 일은 id로 한다. 이름은 예전 줄(멤버가 지워져 member_id가
// NULL이 된 행)을 위한 대비책일 뿐이다 — 명단은 동명이인을 이름에 괄호를 붙여 가르므로
// (김서현(대학부) / 김서현(청년부)) 그 이름이 곧 그 사람의 이름이다.
export interface PresentToday {
  ids: ReadonlySet<string>
  names: ReadonlySet<string>
}

export function presentToday(log: LogEntry[], today: string): PresentToday {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const e of log) {
    if (e.date !== today) continue
    if (e.memberId) ids.add(e.memberId)
    if (e.name) names.add(e.name)
  }
  return { ids, names }
}

export function cameToday(m: Pick<Member, 'id' | 'name'>, present: PresentToday): boolean {
  return present.ids.has(m.id) || present.names.has(m.name)
}

// Members for the manual check-in picker: name-matches the query, sorted by name.
export function checkinCandidates(members: Member[], query: string): Member[] {
  const q = query.trim().toLowerCase()
  return members
    .filter((m) => !q || m.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface WeekDelta {
  thisWeek: number
  lastWeek: number
  delta: number
}

// Distinct attendees today vs. the most recent prior check-in date (e.g. last Sunday).
export function weeklyComparison(log: LogEntry[], today: string): WeekDelta {
  const countOn = (d: string) => new Set(log.filter((e) => e.date === d).map((e) => e.name)).size
  const priorDates = [...new Set(log.map((e) => e.date))].filter((d) => d < today).sort()
  const thisWeek = countOn(today)
  const lastWeek = priorDates.length ? countOn(priorDates[priorDates.length - 1]) : 0
  return { thisWeek, lastWeek, delta: thisWeek - lastWeek }
}

import type { DongsanNames, DongsanLeaders, DongsanLeaderEntry, Member } from '../../../lib/api'

// Pure, immutable editing helpers for the 동산-names map ({ [group]: string[] }).
// Each function returns a NEW map (and new inner array for the touched group) so React
// state updates stay referentially honest. Unknown groups are treated as empty lists.

function listFor(names: DongsanNames, group: string): string[] {
  return names[group] ?? []
}

// Rename the 동산 at `idx` within `group`. Out-of-range indices are no-ops.
export function renameAt(names: DongsanNames, group: string, idx: number, value: string): DongsanNames {
  const list = listFor(names, group)
  if (idx < 0 || idx >= list.length) return names
  const next = list.slice()
  next[idx] = value
  return { ...names, [group]: next }
}

// Append a new empty 동산 slot to `group` (creating the group if it doesn't exist).
export function addDongsan(names: DongsanNames, group: string): DongsanNames {
  return { ...names, [group]: [...listFor(names, group), ''] }
}

// Remove the 동산 at `idx` within `group`. Out-of-range indices are no-ops.
export function removeAt(names: DongsanNames, group: string, idx: number): DongsanNames {
  const list = listFor(names, group)
  if (idx < 0 || idx >= list.length) return names
  return { ...names, [group]: list.filter((_, i) => i !== idx) }
}

// Trim every name and drop blank entries — what we persist on Save.
export function cleanNames(names: DongsanNames): DongsanNames {
  const out: DongsanNames = {}
  for (const group of Object.keys(names)) {
    out[group] = listFor(names, group)
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
  }
  return out
}

// ── 동산지기 / 부동산지기 display roles (feature 2.18) ──────────────────────
// Pure helpers mirroring the legacy getDongsanRole()/editor logic. The leaders map is
// keyed by group (or "합동" in summer mode) → 동산 name → { leader, subLeaders }.

export type DongsanRole = '동산지기' | '부동산지기' | null

const EMPTY_ENTRY: DongsanLeaderEntry = { leader: '', subLeaders: [] }

// The 동산지기/부동산지기 role for `name` in their 동산, or null. In summer mode the "합동"
// key wins when present; otherwise we fall through to the per-group lookup (exact legacy
// getDongsanRole behaviour).
export function getDongsanRole(
  name: string,
  group: string,
  subgroup: string,
  leaders: DongsanLeaders | undefined,
  summerMode: boolean,
): DongsanRole {
  if (!leaders || !subgroup) return null
  const match = (entry: DongsanLeaderEntry | undefined): DongsanRole => {
    if (!entry) return null
    if (entry.leader === name) return '동산지기'
    if ((entry.subLeaders ?? []).includes(name)) return '부동산지기'
    return null
  }
  if (summerMode) {
    const combined = leaders['합동']?.[subgroup]
    if (combined) return match(combined)
  }
  if (!group) return null
  return match(leaders[group]?.[subgroup])
}

// Roster order with 동산지기 first and 부동산지기 next within each 동산 block. Mirrors
// buildAttendanceModel's grouping (by subgroup, first-seen block order) so the on-screen
// 출석부 hoists leaders without ever reordering members across 동산 blocks; within a block
// the partition is stable — untitled members keep their original relative order.
export function orderByDongsanRole(
  members: Member[],
  roleOf: (name: string, group: string, subgroup: string) => DongsanRole,
): Member[] {
  const blocks = new Map<string, Member[]>()
  for (const m of members) {
    const key = m.subgroup || ''
    const block = blocks.get(key)
    if (block) block.push(m)
    else blocks.set(key, [m])
  }
  const out: Member[] = []
  for (const block of blocks.values()) {
    const ranks = block.map((m) => {
      const role = roleOf(m.name, m.group_name, m.subgroup || '')
      return role === '동산지기' ? 0 : role === '부동산지기' ? 1 : 2
    })
    for (const rank of [0, 1, 2]) {
      block.forEach((m, i) => {
        if (ranks[i] === rank) out.push(m)
      })
    }
  }
  return out
}

// The stored entry for a 동산 (defaulting to empty), used to seed the editor.
export function leaderEntry(leaders: DongsanLeaders, group: string, subgroup: string): DongsanLeaderEntry {
  return leaders[group]?.[subgroup] ?? EMPTY_ENTRY
}

// Flat, de-duped list of every 동산 name across all groups — the summer-mode 합동 list.
export function summerDongsanList(names: DongsanNames): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of Object.keys(names)) {
    for (const n of names[group] ?? []) {
      if (n && !seen.has(n)) {
        seen.add(n)
        out.push(n)
      }
    }
  }
  return out
}

// Member names in a 동산, de-duped + sorted. `group` null matches across all groups
// (summer-mode 합동); otherwise it must match the member's 부서.
export function membersInDongsan(members: Member[], group: string | null, subgroup: string): string[] {
  const names = members
    .filter((m) => (group === null || m.group_name === group) && (m.subgroup || '') === (subgroup || ''))
    .map((m) => m.name)
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
}

// 드롭다운에 놓을 이름들. 원칙은 "그 동산/셀에 속한 사람"이지만, **이미 지기로 적혀 있는
// 사람은 그 동산 밖에 있더라도 남긴다.** 그러지 않으면 셀 명단과 셀장 명단이 어긋난 순간
// (장년부 이관 때 실제로 그랬다 — 명단에는 다른 셀인데 셀장 표에는 이 셀의 셀장) 드롭다운이
// 빈칸으로 보여 "지기가 없다"고 오해하게 되고, 한 번 저장하면 그 이름이 조용히 지워진다.
export function leaderOptions(members: string[], entry: DongsanLeaderEntry): string[] {
  const extra = [entry.leader, ...entry.subLeaders].filter((n) => n && !members.includes(n))
  return members.concat(Array.from(new Set(extra)))
}

// 이름 고르기 상자가 보여 줄 것 — 이 동산/셀 사람들이 먼저, 검색어를 쳤을 때만 그 아래로
// 부의 나머지가 따라온다. 아무것도 치지 않았는데 삼백 명이 쏟아지면 정작 그 셀 사람을
// 고르기가 어려워지므로, 기본은 좁게 두되 치면 길이 열린다.
export function pickerHits(
  query: string,
  inCell: string[],
  allNames: string[],
): { cell: string[]; outside: string[] } {
  const q = query.trim().toLowerCase()
  const match = (n: string) => n.toLowerCase().includes(q)
  return {
    cell: inCell.filter(match),
    outside: q ? allNames.filter((n) => match(n) && !inCell.includes(n)) : [],
  }
}

// Immutable edit of a single 동산's entry — set the leader.
export function withLeader(entry: DongsanLeaderEntry, name: string): DongsanLeaderEntry {
  return { ...entry, leader: name }
}

// Immutable edit — set the 부동산지기 in dropdown slot `idx` ('' clears the slot). A name
// picked into one slot vacates any other slot holding it, and blanks are dropped, so the
// stored list stays a de-duped array of at most one entry per slot.
export function setSubLeaderAt(entry: DongsanLeaderEntry, idx: number, name: string): DongsanLeaderEntry {
  const slots = entry.subLeaders.slice()
  while (slots.length <= idx) slots.push('')
  if (name) {
    for (let i = 0; i < slots.length; i++) if (slots[i] === name) slots[i] = ''
  }
  slots[idx] = name
  return { ...entry, subLeaders: slots.filter((n) => n !== '') }
}

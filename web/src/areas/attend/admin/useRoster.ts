import { useQuery } from '@tanstack/react-query'
import { getRoster, type Member, type RosterResponse } from '../../../lib/api'
import { easternNow } from '../../../lib/checkinWindow'
import { awayOn } from '../../../lib/status'

export type RosterData = RosterResponse & { staffMembers: Member[]; hiddenMembers: Member[] }

// The role-scoped roster from /api/roster. Enabled only once the admin is verified.
// Staff accounts (is_staff=true) are split out of `members` into `staffMembers` so
// every consumer of `data.members` automatically excludes them from counts, attendance,
// analytics, and check-in pickers — without needing per-component changes.
//
// **Hidden members are split off the same way.** Someone carrying an open-ended status mark
// (졸업 · 타교회 정착 · 한국 귀국 · 이주 …) is off the roster: not in a count, not in the
// 오늘 list, the 출석부, 새가족, 새가족 교육, 통계, 동산 pickers or the 키오스크. Doing it
// here rather than per-tab is what makes that true everywhere at once — a new screen that
// reads `data.members` is correct without knowing the rule exists.
//
// They are not thrown away: `hiddenMembers` backs the 멤버 탭's 숨긴 멤버 section (clear the
// mark or give it an end date and they come straight back), and the 학기 아카이브 rebuilds
// the full list on purpose, so a finished term's Excel still contains everyone who was
// actually there — see ArchiveSection.
//
// The split itself, separate from the query so tests can build roster data the same way the
// app does — a fixture that hand-wrote `hiddenMembers` would be testing itself, not the rule.
export function splitRoster(data: RosterResponse, today: string = easternNow().date): RosterData {
  const roster = data.members.filter((m) => !m.is_staff)
  return {
    ...data,
    members: roster.filter((m) => !awayOn(m, today)),
    hiddenMembers: roster.filter((m) => awayOn(m, today)),
    staffMembers: data.members.filter((m) => m.is_staff),
  }
}

// This one query backs the 출석부, 오늘 탭, 멤버별 출석기록 and analytics alike, so its
// freshness settings are what keep them all showing the same attendance. Changes made
// on this device refetch through refreshRoster(); changes from another device arrive as
// a live ping (useAttendanceLive). Everything below is the fallback for pings that never
// land (offline, blocked websocket, backgrounded tab): never serve the cached roster
// without revalidating, poll while the tab is in the foreground, and refetch the moment
// the tab is focused or the network comes back.
export const useRoster = (enabled: boolean) =>
  useQuery({
    queryKey: ['roster'],
    queryFn: getRoster,
    enabled,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    select: (data): RosterData => splitRoster(data),
  })

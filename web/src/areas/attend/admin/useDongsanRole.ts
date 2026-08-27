import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDongsanLeaders } from '../../../lib/api'
import { getDongsanRole } from './dongsan'
import { useAppConfig } from '../../../lib/useAppConfig'

// A resolver `(name, group, subgroup) => DongsanRole` for the 👑/⭐ badge. Pulls the
// leaders map + summer-mode flag from cached queries. If the (cutover-gated) endpoint
// isn't reachable, `leaders` stays undefined and every lookup returns null — badges
// simply don't render, so the Members/Today tabs degrade gracefully.
export function useDongsanRole() {
  const { data: cfg } = useAppConfig()
  const { data: leaders } = useQuery({
    queryKey: ['dongsanLeaders'],
    queryFn: getDongsanLeaders,
    retry: false,
    staleTime: 5 * 60_000,
  })
  const summer = !!cfg?.summerMode
  return useMemo(
    () => (name: string, group: string, subgroup: string) => getDongsanRole(name, group, subgroup, leaders, summer),
    [leaders, summer],
  )
}

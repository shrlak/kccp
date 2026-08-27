import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { i18n } from '../../../lib/i18n'
import { easternNow } from '../../../lib/checkinWindow'
import type { LogEntry, Member, RosterResponse } from '../../../lib/api'

// Isolate AdminVisitors from the roster query — the tab is a pure view over data.log.
const rosterData: { data: (RosterResponse & { staffMembers: Member[] }) | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
}
vi.mock('./useRoster', () => ({ useRoster: () => rosterData }))

import { AdminVisitors } from './AdminVisitors'

beforeAll(async () => { await i18n.init() })

const guestRow = (name: string, date: string, ts: number, group = ''): LogEntry => ({
  name, group, subgroup: '', date, time: '10:01', ts, memberRole: 'visitor', memberId: null,
})
const memberRow = (name: string, date: string, ts: number): LogEntry => ({
  name, group: '대학부', subgroup: '1동산', date, time: '10:00', ts,
})

function setLog(log: LogEntry[]) {
  rosterData.data = {
    role: 'super_admin',
    members: [],
    staffMembers: [],
    log,
  } as unknown as RosterResponse & { staffMembers: Member[] }
}

describe('AdminVisitors — 방문자 tab', () => {
  it('lists visitors under their date (today included), excluding member rows', () => {
    const today = easternNow().date
    setLog([
      memberRow('김지체', today, 1),
      guestRow('박방문', today, 2, '대학부'),
      guestRow('이손님', '2026-06-28', 3),
    ])
    render(<AdminVisitors />)

    // Both visitors show, each under its own date header; the member row is excluded.
    expect(screen.getByText('박방문')).toBeInTheDocument()
    expect(screen.getByText('이손님')).toBeInTheDocument()
    expect(screen.queryByText('김지체')).toBeNull()
    expect(screen.getByText(today)).toBeInTheDocument()
    expect(screen.getByText('2026-06-28')).toBeInTheDocument()
  })

  it('badges a returning visitor with their visit count', () => {
    setLog([
      guestRow('박방문', '2026-06-21', 1),
      guestRow('박방문', '2026-06-28', 2),
    ])
    render(<AdminVisitors />)
    expect(screen.getAllByText('재방문 2회')).toHaveLength(2)
  })

  it('shows the empty state when the log has no visitors', () => {
    setLog([memberRow('김지체', '2026-06-28', 1)])
    render(<AdminVisitors />)
    expect(screen.getByText('방문자 기록이 없습니다')).toBeInTheDocument()
  })
})

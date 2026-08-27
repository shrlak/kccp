import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'
import { easternNow } from '../../../lib/checkinWindow'
import { addIsoDays } from '../../../lib/semester'
import type { LogEntry, Member, RosterResponse } from '../../../lib/api'

// Isolate AdminToday from its data hooks (which run their own queries).
const rosterData: { data: (RosterResponse & { staffMembers: Member[] }) | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
}
vi.mock('./useRoster', () => ({ useRoster: () => rosterData }))

import { AdminToday } from './AdminToday'

beforeAll(async () => { await i18n.init() })

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

const member = (id: string, name: string): Member => ({
  id, name, group_name: '대학부', subgroup: '1동산', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
// A 방문자 row as the API returns it: no 부서/동산, member_role "visitor", no member link.
const guestRow = (name: string, date: string, ts: number): LogEntry => ({
  name, group: '', subgroup: '', date, time: '10:01', ts, firstVisit: false, memberRole: 'visitor', memberId: null,
})
const memberRow = (m: Member, date: string, ts: number): LogEntry => ({
  name: m.name, group: m.group_name, subgroup: m.subgroup, date, time: '10:00', ts, firstVisit: false,
})

describe('AdminToday — 방문자(guests) in the 오늘 tab', () => {
  it('shows guest names and counts them in the total alongside members', () => {
    // Use the same "today" source AdminToday does, so the rows always land on today
    // regardless of when the suite runs.
    const today = easternNow().date
    const m1 = member('m1', '김지체')
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [m1],
      staffMembers: [],
      log: [memberRow(m1, today, 2), guestRow('박방문', today, 3)],
    } as unknown as RosterResponse & { staffMembers: Member[] }

    renderWithProviders(<AdminToday />)

    // The guest appears in today's list alongside the member...
    expect(screen.getByText('박방문')).toBeInTheDocument()
    expect(screen.getByText('김지체')).toBeInTheDocument()
    // The redundant three-card summary does not appear on the Today tab.
    expect(screen.queryByText('전체 멤버 수')).not.toBeInTheDocument()
    expect(screen.queryByText('예배 주일 수')).not.toBeInTheDocument()
    // ...and the 오늘 header count includes the guest (member + guest = 2).
    expect(
      screen.getByText((_, el) => el?.textContent === '오늘 출석 · 2' && el.tagName === 'SPAN'),
    ).toBeInTheDocument()
  })
})

describe('AdminToday — 새가족 / 방문자 status labels in the 오늘 tab', () => {
  it('tags 새가족 and 방문자 with readable labels and a legend', () => {
    const today = easternNow().date
    const nf = { ...member('m2', '새신자'), is_new_member: true, registration_date: today }
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [nf],
      staffMembers: [],
      log: [{ ...memberRow(nf, today, 2), firstVisit: true }, guestRow('박방문', today, 3)],
    } as unknown as RosterResponse & { staffMembers: Member[] }

    renderWithProviders(<AdminToday />)

    expect(screen.getAllByText('새가족').length).toBeGreaterThan(0)
    expect(screen.getAllByText('방문자').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('상태 안내')).toBeInTheDocument()
  })

  it('marks only the 새가족 who registered today, not earlier newcomers', () => {
    const today = easternNow().date
    const fresh = { ...member('m3', '오늘등록새신자'), is_new_member: true, registration_date: today }
    const prior = { ...member('m4', '지난주새신자'), is_new_member: true, registration_date: addIsoDays(today, -7) }
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [fresh, prior],
      staffMembers: [],
      log: [memberRow(fresh, today, 2), memberRow(prior, today, 3)],
    } as unknown as RosterResponse & { staffMembers: Member[] }

    renderWithProviders(<AdminToday />)

    expect(screen.getByText('오늘등록새신자').closest('li')).toHaveTextContent('새가족')
    expect(screen.getByText('지난주새신자').closest('li')).not.toHaveTextContent('새가족')
  })

  it('leaves a regular member unmarked even on their first recorded visit', () => {
    const today = easternNow().date
    const m1 = member('m1', '김지체')
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [m1],
      staffMembers: [],
      log: [{ ...memberRow(m1, today, 2), firstVisit: true }],
    } as unknown as RosterResponse & { staffMembers: Member[] }

    renderWithProviders(<AdminToday />)

    const regularRow = screen.getByText('김지체').closest('li')
    expect(regularRow).not.toHaveTextContent('새가족')
    expect(regularRow).not.toHaveTextContent('방문자')
  })
})

// 오늘 온 사람이 200명이면 이름표만으로는 새가족을 찾을 수 없다 — 칩으로 좁힌다.
// 가르는 기준은 이름표와 같은 checkinTag 하나라, 고른 칩과 붙은 이름표가 어긋나지 않는다.
describe('AdminToday — 오늘 명단을 종류로 좁혀 보기', () => {
  function renderMixed() {
    const today = easternNow().date
    const nf = { ...member('m2', '오늘등록새신자'), is_new_member: true, registration_date: today }
    const regular = member('m1', '김지체')
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [nf, regular],
      staffMembers: [],
      log: [memberRow(nf, today, 3), memberRow(regular, today, 2), guestRow('박방문', today, 1)],
    } as unknown as RosterResponse & { staffMembers: Member[] }
    return renderWithProviders(<AdminToday />)
  }

  it('종류마다 그 수를 적은 칩을 낸다', () => {
    renderMixed()
    expect(screen.getByRole('button', { name: '전체 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새가족 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '방문자 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '기존 멤버 1' })).toBeInTheDocument()
  })

  it('새가족 칩은 오늘 등록한 새가족만 남긴다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderMixed()

    await userEvent.click(screen.getByRole('button', { name: '새가족 1' }))
    expect(screen.getByText('오늘등록새신자')).toBeInTheDocument()
    expect(screen.queryByText('김지체')).not.toBeInTheDocument()
    expect(screen.queryByText('박방문')).not.toBeInTheDocument()
  })

  it('방문자 · 기존 멤버 칩도 각자 자기 묶음만 남긴다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderMixed()

    await userEvent.click(screen.getByRole('button', { name: '방문자 1' }))
    expect(screen.getByText('박방문')).toBeInTheDocument()
    expect(screen.queryByText('오늘등록새신자')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '기존 멤버 1' }))
    expect(screen.getByText('김지체')).toBeInTheDocument()
    expect(screen.queryByText('박방문')).not.toBeInTheDocument()
  })

  it('그 종류가 오늘 아무도 없으면 "아직 출석이 없습니다"가 아니라 그 사실을 말한다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const today = easternNow().date
    const regular = member('m1', '김지체')
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [regular],
      staffMembers: [],
      log: [memberRow(regular, today, 2)],
    } as unknown as RosterResponse & { staffMembers: Member[] }
    renderWithProviders(<AdminToday />)

    await userEvent.click(screen.getByRole('button', { name: '새가족 0' }))
    expect(screen.getByText('이 종류로 온 사람이 없습니다')).toBeInTheDocument()
    expect(screen.queryByText('아직 출석이 없습니다')).not.toBeInTheDocument()
  })
})

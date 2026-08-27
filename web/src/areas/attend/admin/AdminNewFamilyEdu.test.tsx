import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'
import { easternNow } from '../../../lib/checkinWindow'
import type { LogEntry, Member, RosterResponse } from '../../../lib/api'
import { splitRoster, type RosterData } from './useRoster'

const rosterData: { data: RosterData | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
}
vi.mock('./useRoster', async (orig) => ({
  ...(await orig<typeof import('./useRoster')>()),
  useRoster: () => rosterData,
}))

vi.mock('../../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../lib/api')>()),
  getConfig: vi.fn().mockResolvedValue({ groupColors: {} }),
}))

import { AdminNewFamilyEdu } from './AdminNewFamilyEdu'

beforeAll(async () => { await i18n.init() })

const today = easternNow().date

const member = (id: string, name: string): Member => ({
  id, name, group_name: '청년부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: true, notes: '', registration_date: today,
})

const row = (m: Member): LogEntry => ({
  memberId: m.id, name: m.name, group: m.group_name, subgroup: m.subgroup,
  date: today, time: '10:00', ts: 1, firstVisit: false,
})

function renderAs(role: string, members: Member[] = [member('m1', '새가족하나')], log: LogEntry[] = []) {
  rosterData.data = splitRoster({
    role, canBulkSubgroup: true, canClearAttendance: true, members, log,
  } as unknown as RosterResponse)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider><AdminNewFamilyEdu /></ToastProvider>
    </QueryClientProvider>,
  )
}

// 새가족 교육은 주일에 그 자리에 있는 사람과 하는 일이라, "오늘 누가 와 있나"가 먼저다.
describe('AdminNewFamilyEdu — 오늘 출석으로 가르기', () => {
  const here = member('m1', '오늘온새가족')
  const away = member('m2', '오늘안온새가족')

  it('칩에 오늘 온 사람 수와 안 온 사람 수를 적는다', () => {
    renderAs('super_admin', [here, away], [row(here)])

    expect(screen.getByRole('button', { name: '오늘 출석 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '오늘 미출석 1' })).toBeInTheDocument()
  })

  it('오늘 출석을 고르면 온 사람만, 미출석을 고르면 안 온 사람만 남는다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin', [here, away], [row(here)])

    // 처음에는 둘 다 보인다.
    expect(screen.getByText('오늘온새가족')).toBeInTheDocument()
    expect(screen.getByText('오늘안온새가족')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '오늘 출석 1' }))
    expect(screen.getByText('오늘온새가족')).toBeInTheDocument()
    expect(screen.queryByText('오늘안온새가족')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '오늘 미출석 1' }))
    expect(screen.queryByText('오늘온새가족')).not.toBeInTheDocument()
    expect(screen.getByText('오늘안온새가족')).toBeInTheDocument()
  })

  it('오늘 온 사람의 카드에 표가 붙는다 — 칩과 같은 기준이라 목록을 좁히지 않아도 보인다', () => {
    renderAs('super_admin', [here, away], [row(here)])

    expect(screen.getByText('오늘온새가족').closest('li')).toHaveTextContent('오늘 출석')
    expect(screen.getByText('오늘안온새가족').closest('li')).not.toHaveTextContent('오늘 출석')
  })
})

// 교육을 다 마친 사람이 목록에서 사라지면 '수강 완료'로 걸러도 아무도 안 나온다 — 정작 누가
// 이수했는지를 이 탭에서 볼 수 없었다. 그래서 이수는 더 이상 목록에서 사람을 내리지 않는다.
describe('AdminNewFamilyEdu — 수강 완료도 목록에 남는다', () => {
  const done = { ...member('m1', '이수완료'), new_member_edu_week1: true, new_member_edu_week2: true }
  // 지난 학기에 등록하고 두 주를 다 마친 사람 — 예전 규칙이라면 사라졌을 자리.
  const oldDone = {
    ...member('m2', '지난학기이수완료'),
    registration_date: '2026-01-05',
    new_member_edu_week1: true,
    new_member_edu_week2: true,
  }
  const none = member('m3', '교육전')

  it('교육을 마친 사람도 그대로 보인다 — 지난 학기 등록이어도', () => {
    renderAs('super_admin', [done, oldDone, none])

    expect(screen.getByText('이수완료')).toBeInTheDocument()
    expect(screen.getByText('지난학기이수완료')).toBeInTheDocument()
  })

  it("'수강 완료'로 걸러면 이수한 사람들이 나온다", async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin', [done, oldDone, none])

    await userEvent.click(screen.getByRole('button', { name: '수강 완료' }))
    expect(screen.getByText('이수완료')).toBeInTheDocument()
    expect(screen.getByText('지난학기이수완료')).toBeInTheDocument()
    expect(screen.queryByText('교육전')).not.toBeInTheDocument()
  })
})

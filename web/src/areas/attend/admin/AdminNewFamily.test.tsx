import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'
import type { Member } from '../../../lib/api'

// 새가족 탭: 이번 학기 등록자와, 교육이 남아 이전 학기에서 넘어온 새가족이 학기별로
// 나뉘어 보이는지 — 그리고 교육을 마친 사람은 더 이상 보이지 않는지.

const member = (id: string, reg: string | null, extra: Partial<Member> = {}): Member => ({
  id, name: id, group_name: '대학부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: true, notes: '', registration_date: reg, ...extra,
})

// today = 2026-06-08 → 기본 학기 경계에서 여름학기(05-10 ~ 08-14).
vi.mock('../../../lib/checkinWindow', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/checkinWindow')>('../../../lib/checkinWindow')
  return { ...actual, easternNow: () => ({ date: '2026-06-08', time: '10:00', ts: 0 }) }
})

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, getConfig: vi.fn().mockResolvedValue({ groupColors: {} }) }
})

const roster = vi.fn()
vi.mock('./useRoster', () => ({ useRoster: () => roster() }))

beforeAll(async () => { await i18n.init() })
beforeEach(() => { vi.clearAllMocks() })

async function renderTab(members: Member[]) {
  roster.mockReturnValue({
    data: { role: 'super_admin', members, log: [], staffMembers: [] },
    isLoading: false,
    isError: false,
  })
  const { AdminNewFamily } = await import('./AdminNewFamily')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider><AdminNewFamily /></ToastProvider>
    </QueryClientProvider>,
  )
}

// 각 학기 섹션은 학기 이름이 붙은 랜드마크다. 이름은 아래 '월별 등록' 롤업에도 나오므로,
// 카드 목록에 있는지는 반드시 해당 섹션 안에서 확인한다.
const term = (name: string) => screen.getByRole('region', { name })

describe('AdminNewFamily 학기 분리', () => {
  it('carries an unfinished 새가족 over from an earlier term, into its own 학기 section', async () => {
    await renderTab([
      member('이번학기', '2026-06-07'),
      member('봄학기미이수', '2026-02-01', { new_member_edu_week1: true }),
    ])

    expect(within(term('2026 여름학기')).getByText('이번학기')).toBeInTheDocument()
    expect(within(term('2026 봄학기')).getByText('봄학기미이수')).toBeInTheDocument()
    // 두 사람이 서로의 섹션에 섞이지 않는다.
    expect(within(term('2026 여름학기')).queryByText('봄학기미이수')).toBeNull()
    expect(screen.getByText('이전 학기 1명')).toBeInTheDocument()
  })

  it('keeps an earlier term 새가족 listed after both education weeks are done', async () => {
    await renderTab([
      member('이번학기', '2026-06-07'),
      member('봄학기이수완료', '2026-02-01', { new_member_edu_week1: true, new_member_edu_week2: true }),
    ])

    expect(within(term('2026 여름학기')).getByText('이번학기')).toBeInTheDocument()
    // 교육을 마쳐도 자기 등록 학기 섹션에 그대로 남는다 — 새가족 표시를 해제해야 내려간다.
    expect(within(term('2026 봄학기')).getByText('봄학기이수완료')).toBeInTheDocument()
  })

  it('keeps this term’s 새가족 listed even after they finish the education', async () => {
    await renderTab([member('이수완료', '2026-06-07', { new_member_edu_week1: true, new_member_edu_week2: true })])

    expect(within(term('2026 여름학기')).getByText('이수완료')).toBeInTheDocument()
    expect(screen.queryByText('교육 미완료')).toBeNull()
  })
})

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'
import type { DongsanLink, DongsanLinksState } from '../../../lib/api'

const getDongsanLinks = vi.fn()
vi.mock('../../../lib/api', () => ({
  getDongsanLinks: () => getDongsanLinks(),
  createDongsanLink: vi.fn(),
  revokeDongsanLink: vi.fn(),
}))

import { DongsanLinksSection } from './DongsanLinks'

beforeAll(async () => { await i18n.init() })
beforeEach(() => {
  getDongsanLinks.mockReset().mockResolvedValue({ links: [], term: '', sheetGroups: [], auto: true })
})

function link(group: string, term: string, token = `${term}-${group}`): DongsanLink {
  return { token, group, subgroup: '', term, createdAt: 1 }
}

function renderSection(state: Partial<DongsanLinksState> = {}) {
  getDongsanLinks.mockResolvedValue({ links: [], term: '2026-fall', sheetGroups: [], auto: true, ...state })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DongsanLinksSection partition="youth" />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('동산 리더 링크 — 학기를 따라 나고 진다', () => {
  // 낼 수 있는 링크는 부서 두 개뿐이다 — 동산마다 따로 내는 길은 두지 않는다.
  it('학기 중에는 그 학기의 부서 링크가 자리에 놓인다', async () => {
    renderSection({ links: [link('대학부', '2026-fall'), link('청년부', '2026-fall')] })

    // 어느 학기의 링크인지가 자리에 적힌다 (주소에도 들어 있다).
    expect(await screen.findAllByText('2026 가을 학기')).toHaveLength(2)
    expect(screen.getByText('대학부 전체')).toBeInTheDocument()
    expect(screen.getByText('청년부 전체')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '복사' })).toHaveLength(2)
    // 학기가 있는 부에서는 사람이 링크를 만들지 않는다 — 서버가 학기에 맞춰 낸다.
    expect(screen.queryByRole('button', { name: '링크 만들기' })).not.toBeInTheDocument()
  })

  // 여름 동산 출석은 시트가 갖고 온다 — 같은 동산을 둘로 적으면 다음 동기화가 덮어쓴다.
  it('시트가 담당하는 부서에는 링크가 없다', async () => {
    renderSection({ sheetGroups: ['대학부', '청년부'] })

    expect(await screen.findAllByText('구글 시트가 담당합니다')).toHaveLength(2)
    expect(screen.getByText('대학부 전체')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '복사' })).not.toBeInTheDocument()
  })

  // 학기 사이에는 적을 학기가 없으니 열어 둘 링크도 없다.
  it('학기 사이에는 링크가 없고, 다음 학기에 난다고 적힌다', async () => {
    renderSection({ term: '' })

    expect(await screen.findAllByText('다음 학기가 시작하면 자동으로 납니다')).toHaveLength(2)
    expect(screen.getByText('대학부 전체')).toBeInTheDocument()
  })

  // 자리로 그려지지 않는 링크(동산별로 내던 시절의 것, 아직 걷히기 전인 지난 학기 것)도 거둘
  // 수 있어야 한다 — 목록에서 지워 버리면 폐기할 방법이 없다.
  it('자리에 없는 링크도 남아서 폐기할 수 있다', async () => {
    renderSection({
      links: [{ token: 'tok1', group: '', subgroup: '지난여름동산', term: '', createdAt: 1 }],
    })

    expect(await screen.findByText('지난여름동산')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '폐기' })).toBeInTheDocument()
  })
})

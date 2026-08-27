import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { i18n } from '../../../lib/i18n'
import type { DongsanBoard } from '../../../lib/api'
import { ToastProvider } from '../../../components/ui/Toast'

const getDongsanBoard = vi.fn()
const markDongsan = vi.fn()
vi.mock('../../../lib/api', () => ({
  getDongsanBoard: (...args: unknown[]) => getDongsanBoard(...args),
  markDongsan: (...args: unknown[]) => markDongsan(...args),
}))

import { DongsanBoardScreen } from './DongsanBoardScreen'

beforeAll(async () => { await i18n.init() })

// 대학부 링크: 두 동산 + 아직 동산이 없는 한 사람, 주일 두 개.
// 이귀국은 기한 없는 '한국 귀국' 표기가 붙어 명단에서 빠진 사람이다.
const board: DongsanBoard = {
  partition: 'youth',
  group: '대학부',
  subgroup: '',
  dates: ['2026-08-02', '2026-08-09'],
  members: [
    { id: 'm1', name: '김출석', group: '대학부', subgroup: '건영동산' },
    { id: 'm2', name: '박결석', group: '대학부', subgroup: '건영동산' },
    { id: 'm3', name: '최윤서', group: '대학부', subgroup: '윤서동산' },
    { id: 'm4', name: '다미지정', group: '대학부', subgroup: '' },
    {
      id: 'm5', name: '이귀국', group: '대학부', subgroup: '건영동산',
      status_marks: [{ note: '한국 귀국', start: '2026-07-01', end: null }],
    },
  ],
  marks: ['m1|2026-08-09'],
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/dongsan/tok123']}>
          <Routes>
            <Route path="/dongsan/:token" element={<DongsanBoardScreen />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getDongsanBoard.mockReset().mockResolvedValue(board)
  markDongsan.mockReset().mockResolvedValue({ status: 'ok', present: true })
})

describe('/dongsan/:token — 부서 담당자의 출석 표', () => {
  it('draws a 동산 table per block, one column per Sunday', async () => {
    renderScreen()

    expect(await screen.findByRole('heading', { name: '대학부 전체' })).toBeInTheDocument()
    expect(getDongsanBoard).toHaveBeenCalledWith('tok123')

    // 동산별 블록 — 동산이 아직 없는 사람도 자기 블록에 남는다.
    expect(screen.getByText('건영동산')).toBeInTheDocument()
    expect(screen.getByText('윤서동산')).toBeInTheDocument()
    expect(screen.getByText('동산 미지정')).toBeInTheDocument()

    // 주일이 열이 된다 (표마다 한 벌씩).
    expect(screen.getAllByRole('columnheader', { name: '8/9' })).toHaveLength(3)

    // 명단에서 빠진 사람은 표에도 없다.
    expect(screen.queryByText('이귀국')).not.toBeInTheDocument()
  })

  it('each cell is an O/X dropdown holding what is already recorded', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    expect((screen.getByRole('combobox', { name: '김출석 2026-08-09' }) as HTMLSelectElement).value).toBe('O')
    expect((screen.getByRole('combobox', { name: '김출석 2026-08-02' }) as HTMLSelectElement).value).toBe('X')
    expect((screen.getByRole('combobox', { name: '박결석 2026-08-09' }) as HTMLSelectElement).value).toBe('X')
  })

  it('picking O saves that person on that Sunday', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    await user.selectOptions(screen.getByRole('combobox', { name: '박결석 2026-08-02' }), 'O')

    await waitFor(() => expect(markDongsan).toHaveBeenCalledWith('tok123', 'm2', '2026-08-02', true))
    // 왕복을 기다리지 않고 화면이 먼저 바뀐다.
    expect((screen.getByRole('combobox', { name: '박결석 2026-08-02' }) as HTMLSelectElement).value).toBe('O')
  })

  it('turning a cell back to X takes the mark away', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    await user.selectOptions(screen.getByRole('combobox', { name: '김출석 2026-08-09' }), 'X')

    await waitFor(() => expect(markDongsan).toHaveBeenCalledWith('tok123', 'm1', '2026-08-09', false))
    expect((screen.getByRole('combobox', { name: '김출석 2026-08-09' }) as HTMLSelectElement).value).toBe('X')
  })

  // 아직 손대지 않은 주일도 전부 X로 보이므로, 그 사실은 합계의 0이 알려 준다.
  it('each column carries its own 합계, so an untouched Sunday reads as 0', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    const gunyeong = screen.getByText('건영동산').closest('section')!
    const totals = within(gunyeong).getByRole('row', { name: /합계/ })
    // 08-02은 아무도 없고(0), 08-09은 김출석 하나(1).
    expect(within(totals).getAllByRole('cell').map((c) => c.textContent)).toEqual(['0', '1'])
  })

  it('a revoked or mistyped link says so instead of showing an empty table', async () => {
    getDongsanBoard.mockRejectedValue(new Error('이 링크는 더 이상 쓸 수 없습니다'))
    renderScreen()

    expect(await screen.findByText('이 링크는 더 이상 쓸 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('puts the failed pick back when the save is rejected', async () => {
    const user = userEvent.setup()
    markDongsan.mockRejectedValue(new Error('nope'))
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    await user.selectOptions(screen.getByRole('combobox', { name: '박결석 2026-08-09' }), 'O')

    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: '박결석 2026-08-09' }) as HTMLSelectElement).value).toBe('X'),
    )
  })
})

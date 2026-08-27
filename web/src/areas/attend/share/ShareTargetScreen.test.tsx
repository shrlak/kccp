import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'

vi.mock('../../../lib/api', () => ({
  // The share link must never reach the admin endpoints — these are here so a regression
  // that swaps them back in shows up as a call on the wrong mock.
  extractCard: vi.fn(),
  kioskNewMember: vi.fn(),
  getCardScanUsage: vi.fn().mockRejectedValue(new Error('admin endpoint — needs a login')),
  extractCardViaShare: vi.fn(),
  shareNewMember: vi.fn(),
  getShareCardScanUsage: vi.fn().mockResolvedValue({
    limit: 60,
    remaining: 57,
    day: '2026-08-03',
    resetsAt: 1,
    updatedAt: 1,
  }),
}))

// CardScanDialog reaches lib/live, which opens a realtime channel on the shared client.
vi.mock('../../../lib/supabase', () => {
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn(), send: vi.fn() }
  return {
    supabase: {
      auth: {
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn().mockResolvedValue({}),
      },
      channel: vi.fn().mockReturnValue(channel),
      removeChannel: vi.fn(),
    },
  }
})

// Canvas isn't available in jsdom, so the photo pipeline is stubbed — what's under test
// is the hand-off and which endpoints it uses, not the encoder.
vi.mock('../admin/cardPhoto', () => ({
  fileToCardImage: vi.fn().mockResolvedValue({ base64: 'img', mediaType: 'image/jpeg' }),
}))

vi.mock('../../../lib/sharedCards', () => ({
  readSharedCards: vi.fn().mockResolvedValue([]),
  clearSharedCards: vi.fn().mockResolvedValue(undefined),
}))

beforeAll(async () => { await i18n.init() })
beforeEach(async () => {
  sessionStorage.clear()
  vi.clearAllMocks()
  // clearAllMocks drops recorded calls but keeps implementations, so re-arm the default
  // "nothing was shared" — otherwise a previous test's photo leaks into the next one.
  const { readSharedCards } = await import('../../../lib/sharedCards')
  ;(readSharedCards as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

const sharedPhoto = (name = 'card.jpg') => new File(['x'], name, { type: 'image/jpeg' })

const extracted = {
  status: 'ok',
  cards: [{ name: '김새가', affiliationCategory: '대학생' }],
  model: 'Gemini 2.5 Flash',
  usage: { limit: 60, remaining: 56, day: '2026-08-03', resetsAt: 1, updatedAt: 1 },
}

async function renderShare() {
  const { ShareTargetScreen } = await import('./ShareTargetScreen')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/share']}>
          <ShareTargetScreen />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ShareTargetScreen — no login required', () => {
  it('never shows a login gate, even with no session at all', async () => {
    await renderShare()

    expect(await screen.findByRole('button', { name: '카드 사진 선택' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Google로 로그인' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('관리자 비밀번호')).not.toBeInTheDocument()
  })

  it('takes a shared photo straight into card review, and consumes the hand-off', async () => {
    const { readSharedCards, clearSharedCards } = await import('../../../lib/sharedCards')
    ;(readSharedCards as ReturnType<typeof vi.fn>).mockResolvedValue([sharedPhoto()])
    const { extractCardViaShare } = await import('../../../lib/api')
    ;(extractCardViaShare as ReturnType<typeof vi.fn>).mockResolvedValue(extracted)
    await renderShare()

    expect(await screen.findByLabelText('이름')).toHaveValue('김새가')
    await waitFor(() => expect(clearSharedCards).toHaveBeenCalled())
  })

  it('reads the card through the unauthenticated endpoint, not the admin one', async () => {
    const { readSharedCards } = await import('../../../lib/sharedCards')
    ;(readSharedCards as ReturnType<typeof vi.fn>).mockResolvedValue([sharedPhoto()])
    const { extractCard, extractCardViaShare } = await import('../../../lib/api')
    ;(extractCardViaShare as ReturnType<typeof vi.fn>).mockResolvedValue(extracted)
    await renderShare()

    await screen.findByLabelText('이름')
    expect(extractCardViaShare).toHaveBeenCalledTimes(1)
    expect(extractCard).not.toHaveBeenCalled()
  })

  it('registers through the unauthenticated endpoint, not the admin one', async () => {
    const { readSharedCards } = await import('../../../lib/sharedCards')
    ;(readSharedCards as ReturnType<typeof vi.fn>).mockResolvedValue([sharedPhoto()])
    const { extractCardViaShare, shareNewMember, kioskNewMember } = await import('../../../lib/api')
    ;(extractCardViaShare as ReturnType<typeof vi.fn>).mockResolvedValue(extracted)
    ;(shareNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    await renderShare()

    await screen.findByLabelText('이름')
    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(shareNewMember).toHaveBeenCalledTimes(1))
    expect(kioskNewMember).not.toHaveBeenCalled()
    expect((shareNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      name: '김새가',
      // 소속 "대학생" maps to the 대학부 부서, same as a registration made inside the panel.
      group: '대학부',
    })
  })

  it('shows the remaining daily allowance from the unauthenticated counter', async () => {
    const { getCardScanUsage, getShareCardScanUsage } = await import('../../../lib/api')
    await renderShare()

    await userEvent.click(await screen.findByRole('button', { name: '카드 사진 선택' }))

    expect(await screen.findByText('오늘 57회 남음')).toBeInTheDocument()
    expect(getShareCardScanUsage).toHaveBeenCalled()
    expect(getCardScanUsage).not.toHaveBeenCalled()
  })
})

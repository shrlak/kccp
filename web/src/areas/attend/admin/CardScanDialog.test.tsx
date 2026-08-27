import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'
import { CardScanDialog } from './CardScanDialog'

vi.mock('../../../lib/api', () => ({
  extractCard: vi.fn(),
  kioskNewMember: vi.fn(),
  getCardScanUsage: vi.fn().mockResolvedValue({
    limit: 60,
    remaining: 57,
    day: '2026-07-19',
    resetsAt: 1_774_158_400_000,
    updatedAt: 1_774_072_000_000,
  }),
}))

// Canvas isn't available in jsdom — return a fixed payload per file so the queue
// logic (not the image pipeline) is what's under test.
vi.mock('./cardPhoto', () => ({
  fileToCardImage: vi.fn().mockResolvedValue({ base64: 'img', mediaType: 'image/jpeg' }),
}))

beforeAll(async () => { await i18n.init() })
beforeEach(() => { vi.clearAllMocks() })

function renderDialog(onClose = vi.fn(), initialFiles?: File[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <CardScanDialog open onClose={onClose} initialFiles={initialFiles} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return onClose
}

// One photo → every card read out of it. 빈 칸이 있어도 등록은 막히지 않는다.
const cardsJson = (...names: string[]) => ({
  status: 'ok',
  cards: names.map((name) => ({ name, affiliationCategory: '대학생', affiliationDetail: 'Pitt' })),
  model: 'Gemini 2.5 Flash',
  usage: {
    limit: 60,
    remaining: 56,
    day: '2026-07-19',
    resetsAt: 1_774_158_400_000,
    updatedAt: 1_774_072_001_000,
  },
})
const cardJson = (name: string) => cardsJson(name)

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

describe('CardScanDialog — multi-card batch', () => {
  it('shows only the number of tries remaining today', async () => {
    renderDialog()

    expect(await screen.findByText('오늘 57회 남음')).toBeInTheDocument()
    expect(screen.queryByText(/사용|used/i)).not.toBeInTheDocument()
  })

  it('walks a two-photo batch card by card: extract → review → 등록 → next, closing after the last', async () => {
    const { extractCard, kioskNewMember } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cardJson('김새가'))
      .mockResolvedValueOnce(cardJson('이새가'))
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    const onClose = renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), [file('a.jpg'), file('b.jpg')])

    // Photo 1 of 2 under review, with the batch position shown.
    expect(await screen.findByText('사진 1 / 2')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('김새가')

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    // Registration lands, then the next photo rolls in for review.
    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('이새가')
    expect(kioskNewMember).toHaveBeenCalledTimes(1)
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ name: '김새가' })

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    // Last card registered → dialog closes.
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(kioskNewMember).toHaveBeenCalledTimes(2)
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[1][0]).toMatchObject({ name: '이새가' })
  })

  it('건너뛰기 skips the current card without registering and moves to the next', async () => {
    const { extractCard, kioskNewMember } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cardJson('김새가'))
      .mockResolvedValueOnce(cardJson('이새가'))
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), [file('a.jpg'), file('b.jpg')])
    await screen.findByText('사진 1 / 2')

    await userEvent.click(screen.getByRole('button', { name: '이 카드 건너뛰기' }))

    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('이새가')
    expect(kioskNewMember).not.toHaveBeenCalled()
  })

  it('a card that fails extraction is reported with its position and the batch moves on', async () => {
    const { extractCard } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('카드를 읽을 수 없습니다'))
      .mockResolvedValueOnce(cardJson('이새가'))
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), [file('a.jpg'), file('b.jpg')])

    // Failure toast names the position; the next photo still arrives for review.
    expect(await screen.findByText('사진 1 / 2 — 카드를 읽을 수 없습니다')).toBeInTheDocument()
    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('이새가')
  })

  it('a single photo keeps the original flow: no position tag, 다시 선택 returns to the picker', async () => {
    const { extractCard } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cardJson('김새가'))
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('a.jpg'))

    expect(await screen.findByLabelText('이름')).toHaveValue('김새가')
    expect(screen.queryByText(/카드 1 \/ 1|사진 1 \/ 1/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '다시 선택' }))

    expect(await screen.findByLabelText('카드 사진 선택')).toBeInTheDocument()
  })

  it('registers every card found in a single photo, one review at a time', async () => {
    const { extractCard, kioskNewMember } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cardsJson('김새가', '이새가', '박새가'))
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    const onClose = renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('stack.jpg'))

    // One photo, three cards: the count is announced and the first card is up.
    expect(await screen.findByText('이 사진에서 카드 3개를 인식했습니다')).toBeInTheDocument()
    expect(await screen.findByText('카드 1 / 3')).toBeInTheDocument()
    // No photo tag — there is only one photo in this batch.
    expect(screen.queryByText(/사진 \d+ \/ \d+/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('김새가')

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('카드 2 / 3')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('이새가')

    // Skipping a card leaves it unregistered but keeps the photo's remaining cards.
    await userEvent.click(screen.getByRole('button', { name: '이 카드 건너뛰기' }))

    expect(await screen.findByText('카드 3 / 3')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('박새가')

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    // Last card of the only photo → dialog closes; the photo was read with one API call.
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(extractCard).toHaveBeenCalledTimes(1)
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].name)).toEqual([
      '김새가',
      '박새가',
    ])
  })

  it('carries both positions across a batch where a photo holds several cards', async () => {
    const { extractCard, kioskNewMember } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cardsJson('김새가', '이새가'))
      .mockResolvedValueOnce(cardsJson('박새가'))
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), [file('a.jpg'), file('b.jpg')])

    expect(await screen.findByText('사진 1 / 2')).toBeInTheDocument()
    expect(await screen.findByText('카드 1 / 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('카드 2 / 2')).toBeInTheDocument()

    // Second card of photo 1 registered → photo 2 is extracted, single card, no card tag.
    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(await screen.findByLabelText('이름')).toHaveValue('박새가')
    expect(screen.queryByText(/카드 \d+ \/ \d+/)).not.toBeInTheDocument()
    expect(extractCard).toHaveBeenCalledTimes(2)
  })

  it('still accepts the older single-card response shape', async () => {
    const { extractCard } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'ok',
      card: { name: '김새가', affiliationCategory: '대학생' },
      usage: cardsJson().usage,
    })
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('a.jpg'))

    expect(await screen.findByLabelText('이름')).toHaveValue('김새가')
  })
})

// 종이 카드는 사람이 손으로 채우는 것이라 빈 칸이 늘 있다. 인식한 카드는 어느 칸이 비어
// 있어도 등록되고, 우리가 대신 채운 값은 등록 전에 화면에 적힌다.
describe('CardScanDialog — 다 안 적힌 카드', () => {
  it('이름도 소속도 없는 카드를 자리표 이름 + 기본 부서로 등록한다', async () => {
    const { extractCard, kioskNewMember } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'ok',
      // 전화만 읽힌 카드 — 이름 칸도, 소속 네모도 비어 있다.
      cards: [{ phone: '412-555-0199' }],
      model: 'Gemini 3.6 Flash',
      usage: cardsJson().usage,
    })
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    const onClose = renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('a.jpg'))

    expect(await screen.findByLabelText('이름')).toHaveValue('')
    // 무엇을 대신 채우는지 등록 전에 보인다.
    expect(screen.getByText(/이름이 비어 있어/)).toBeInTheDocument()
    expect(screen.getByText(/소속이 비어 있어 청년부로 등록됩니다/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(kioskNewMember).toHaveBeenCalledTimes(1)
    const payload = (kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.name).toMatch(/^이름 미기재 \d\d-\d\d \d\d:\d\d:\d\d$/)
    expect(payload.group).toBe('청년부')
    expect(payload.phone).toBe('(412) 555-0199')
  })

  it('이름은 있고 소속만 빈 카드는 이름을 그대로 쓴다', async () => {
    const { extractCard, kioskNewMember } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'ok',
      cards: [{ name: '김새가' }],
      model: 'Gemini 3.6 Flash',
      usage: cardsJson().usage,
    })
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('a.jpg'))
    await screen.findByLabelText('이름')

    expect(screen.queryByText(/이름이 비어 있어/)).not.toBeInTheDocument()
    expect(screen.getByText(/소속이 비어 있어 청년부로 등록됩니다/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(kioskNewMember).toHaveBeenCalledTimes(1))
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      name: '김새가',
      group: '청년부',
    })
  })

  it('한 부서만 맡은 리더는 소속이 빈 카드를 자기 부서로 넣는다', async () => {
    // 서버는 자기 부서 밖으로의 등록을 막는다 (inScopeGroup). 소속 없는 카드를 늘 청년부로
    // 떨어뜨리면 대학부 리더에게는 403이 되고, 빈 칸 때문에 등록이 막히는 일이 그대로 남는다.
    const { useAdminAuth } = await import('../../../stores/useAdminAuth')
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'leader', group: '대학부', subgroup: '호연선규', ministry: '' },
    })
    const { extractCard, kioskNewMember } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'ok',
      cards: [{ name: '김새가' }],
      model: 'Gemini 3.6 Flash',
      usage: cardsJson().usage,
    })
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    try {
      renderDialog()

      await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('a.jpg'))
      await screen.findByLabelText('이름')
      expect(screen.getByText(/소속이 비어 있어 대학부로 등록됩니다/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: '등록' }))

      await waitFor(() => expect(kioskNewMember).toHaveBeenCalledTimes(1))
      expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        name: '김새가',
        group: '대학부',
      })
    } finally {
      useAdminAuth.setState({ status: 'idle', identity: null })
    }
  })

  it('소속이 찍힌 카드에는 안내가 나오지 않는다', async () => {
    const { extractCard } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cardJson('김새가'))
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('a.jpg'))
    await screen.findByLabelText('이름')

    expect(screen.queryByText(/비어 있어/)).not.toBeInTheDocument()
  })
})

// Photos arriving from the phone's share sheet (/share → sw.ts) are handed to the dialog
// already picked, so the flow starts at 인식 rather than at the file input.
describe('CardScanDialog — photos handed over by the share sheet', () => {
  it('extracts straight away without a pick step', async () => {
    const { extractCard } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cardJson('김새가'))
    renderDialog(vi.fn(), [file('shared.jpg')])

    expect(await screen.findByLabelText('이름')).toHaveValue('김새가')
    expect(screen.queryByLabelText('카드 사진 선택')).not.toBeInTheDocument()
    expect(extractCard).toHaveBeenCalledTimes(1)
  })

  it('walks a multi-photo share as one batch', async () => {
    const { extractCard, kioskNewMember } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cardJson('김새가'))
      .mockResolvedValueOnce(cardJson('이새가'))
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderDialog(vi.fn(), [file('a.jpg'), file('b.jpg')])

    expect(await screen.findByLabelText('이름')).toHaveValue('김새가')
    expect(screen.getByText('사진 1 / 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(await screen.findByLabelText('이름')).toHaveValue('이새가')
  })

  it('extracts a shared photo exactly once — a metered call must not fire twice', async () => {
    const { extractCard } = await import('../../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValue(cardJson('김새가'))
    renderDialog(vi.fn(), [file('shared.jpg')])

    await screen.findByLabelText('이름')
    await waitFor(() => expect(extractCard).toHaveBeenCalledTimes(1))
  })
})

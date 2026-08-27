import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'
import { easternNow } from '../../../lib/checkinWindow'
import type { Member } from '../../../lib/api'

// The kiosk tile flow: the result screen is optimistic, so these tests care as much about
// what is on screen *before* the request settles as about what happens after.

const 철수: Member = {
  id: 'm1', name: '김철수', group_name: '대학부', subgroup: '1동산', member_role: '',
  gender: '남', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
}

const today = easternNow().date

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return {
    ...actual,
    getRoster: vi.fn(),
    getConfig: vi.fn().mockResolvedValue({ groupColors: {} }),
    memberCheckin: vi.fn(),
    removeAttendance: vi.fn(),
    guestCheckin: vi.fn(),
    kioskNewMember: vi.fn(),
  }
})

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

beforeAll(async () => { await i18n.init() })
beforeEach(() => { vi.clearAllMocks() })

// A promise the test resolves by hand, so assertions can run while the request is still
// in flight — that window is exactly what the optimistic screen is for.
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function renderKiosk(log: { id?: number; memberId?: string; name: string; date: string }[] = []) {
  const { getRoster } = await import('../../../lib/api')
  ;(getRoster as ReturnType<typeof vi.fn>).mockResolvedValue({
    role: 'welcoming',
    members: [철수],
    log: log.map((e) => ({ group: '대학부', subgroup: '1동산', time: '10:00', ts: 0, ...e })),
  })
  const { KioskView } = await import('./KioskView')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider><KioskView onExit={vi.fn()} /></ToastProvider>
    </QueryClientProvider>,
  )
  return await screen.findByRole('button', { name: '김철수' })
}

describe('KioskView tile check-in', () => {
  it('paints 출석 완료 on the tap itself, before the check-in request answers', async () => {
    const { memberCheckin } = await import('../../../lib/api')
    const call = deferred<{ status: 'ok' }>()
    ;(memberCheckin as ReturnType<typeof vi.fn>).mockReturnValue(call.promise)
    const tile = await renderKiosk()

    await userEvent.click(tile)

    // Still in flight, yet the operator already has their answer.
    expect(screen.getByText('출석 완료!')).toBeInTheDocument()
    expect(memberCheckin).toHaveBeenCalledWith('m1')
    // …and the tile + header count have flipped with it.
    expect(tile.className).toContain('bg-primary')
    expect(screen.getAllByText('1명 출석').length).toBeGreaterThan(0)

    call.resolve({ status: 'ok' })
  })

  it('clears the result screen on a short hold, without waiting on the roster refetch', async () => {
    const { memberCheckin } = await import('../../../lib/api')
    ;(memberCheckin as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    const tile = await renderKiosk()

    await userEvent.click(tile)
    expect(screen.getByText('출석 완료!')).toBeInTheDocument()

    await waitFor(() => expect(screen.queryByText('출석 완료!')).not.toBeInTheDocument(), { timeout: 2000 })
  })

  it('undoes a checked-in member, showing the undo screen straight away', async () => {
    const { removeAttendance } = await import('../../../lib/api')
    const call = deferred<{ status: string }>()
    ;(removeAttendance as ReturnType<typeof vi.fn>).mockReturnValue(call.promise)
    const tile = await renderKiosk([{ id: 7, memberId: 'm1', name: '김철수', date: today }])
    expect(tile.className).toContain('bg-primary')

    await userEvent.click(tile)

    expect(screen.getByText('출석이 취소되었습니다')).toBeInTheDocument()
    expect(removeAttendance).toHaveBeenCalledWith(7)
    expect(tile.className).not.toContain('bg-primary')
    expect(screen.getAllByText('0명 출석').length).toBeGreaterThan(0)

    call.resolve({ status: 'ok' })
  })

  it('rolls the tile back and shows the failure when the request fails', async () => {
    const { memberCheckin } = await import('../../../lib/api')
    ;(memberCheckin as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not authorized'))
    const tile = await renderKiosk()

    await userEvent.click(tile)

    expect(await screen.findByText('출석에 실패했습니다')).toBeInTheDocument()
    expect(screen.getByText('Not authorized')).toBeInTheDocument()
    await waitFor(() => expect(tile.className).not.toContain('bg-primary'))
  })

  it('ignores a second tap while the first is still syncing', async () => {
    const { memberCheckin } = await import('../../../lib/api')
    const call = deferred<{ status: 'ok' }>()
    ;(memberCheckin as ReturnType<typeof vi.fn>).mockReturnValue(call.promise)
    const tile = await renderKiosk()

    await userEvent.click(tile)
    await userEvent.click(tile)

    expect(memberCheckin).toHaveBeenCalledTimes(1)
    call.resolve({ status: 'ok' })
  })
})

describe('KioskView 부서만 보기 (여름학기가 아닐 때)', () => {
  const 대학생: Member = { ...철수, id: 'u1', name: '대학생', group_name: '대학부' }
  const 청년: Member = { ...철수, id: 'y1', name: '청년', group_name: '청년부' }

  async function renderWithMembers(summerMode: boolean) {
    const { getRoster, getConfig } = await import('../../../lib/api')
    ;(getRoster as ReturnType<typeof vi.fn>).mockResolvedValue({ role: 'welcoming', members: [대학생, 청년], log: [] })
    ;(getConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ groupColors: {}, summerMode })
    const { KioskView } = await import('./KioskView')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider><KioskView onExit={vi.fn()} /></ToastProvider>
      </QueryClientProvider>,
    )
    await screen.findByRole('button', { name: '대학생' })
  }

  it('키오스크 안에서 한 부서만 골라 볼 수 있다 (기본은 전체)', async () => {
    await renderWithMembers(false)
    expect(screen.getByText('부서만 보기')).toBeInTheDocument()
    // 기본값은 전체 — 두 부서가 다 보인다.
    expect(screen.getByRole('button', { name: '대학생' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '청년' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '청년부' }))
    expect(screen.queryByRole('button', { name: '대학생' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '청년' })).toBeInTheDocument()

    // 다시 전체로 돌아온다.
    await userEvent.click(screen.getByRole('button', { name: '전체' }))
    expect(screen.getByRole('button', { name: '대학생' })).toBeInTheDocument()
  })

  it('여름학기(합동)에는 부서 선택이 아예 뜨지 않는다', async () => {
    await renderWithMembers(true)
    expect(screen.queryByText('부서만 보기')).not.toBeInTheDocument()
  })
})

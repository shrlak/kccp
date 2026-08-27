import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../../lib/i18n'

vi.mock('../../../lib/api', () => ({
  adminVerify: vi.fn(),
  adminVerifyGoogle: vi.fn(),
  getLoginPosition: vi.fn().mockResolvedValue(null),
  GEO_LOGIN_WAIT_MS: 2000,
  setAdminPassword: vi.fn(),
  setAdminToken: vi.fn(),
  getRoster: vi.fn().mockResolvedValue({ role: 'welcoming', members: [], log: [] }),
  getConfig: vi.fn().mockResolvedValue({ groupColors: {} }),
  // useAppConfig picks the logged-in 부's block out of the /api/config response.
  configFor: (cfg: unknown) => cfg,
  memberCheckin: vi.fn(),
  removeAttendance: vi.fn(),
  guestCheckin: vi.fn(),
  kioskNewMember: vi.fn(),
}))

// Stub the supabase client: the auth store registers onAuthStateChange at import
// time, and the kiosk's live-sync hook opens a realtime channel on mount.
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
beforeEach(async () => {
  sessionStorage.clear()
  vi.clearAllMocks()
  const { useAdminAuth } = await import('../../../stores/useAdminAuth')
  useAdminAuth.setState({ status: 'idle', identity: null })
})

async function renderKiosk() {
  const { KioskShell } = await import('./KioskShell')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/kiosk']}>
        <Routes>
          <Route path="/" element={<div>landing-here</div>} />
          <Route path="/kiosk" element={<KioskShell />} />
          <Route path="/admin" element={<div>admin-panel-here</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('KioskShell + KioskGate', () => {
  it('shows the login gate (password + Google) when not authed', async () => {
    await renderKiosk()
    expect(screen.getByLabelText('키오스크 비밀번호')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeInTheDocument()
  })

  it('unlocks the kiosk when the password verifies as the welcoming role', async () => {
    const { adminVerify } = await import('../../../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockResolvedValue({ role: 'welcoming', group: '', subgroup: '', ministry: '' })
    await renderKiosk()

    await userEvent.type(screen.getByLabelText('키오스크 비밀번호'), 'kccpwelcome')
    await userEvent.click(screen.getByRole('button', { name: '키오스크 시작' }))

    expect(await screen.findByPlaceholderText('이름 검색...')).toBeInTheDocument()
  })

  it('unlocks the kiosk for other admin roles too (no detour to the admin panel)', async () => {
    const { adminVerify } = await import('../../../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockResolvedValue({ role: 'super_admin', group: '', subgroup: '', ministry: '' })
    await renderKiosk()

    await userEvent.type(screen.getByLabelText('키오스크 비밀번호'), 'kccpadmin')
    await userEvent.click(screen.getByRole('button', { name: '키오스크 시작' }))

    expect(await screen.findByPlaceholderText('이름 검색...')).toBeInTheDocument()
  })

  it('opens the kiosk directly for an already-authed session, skipping the gate', async () => {
    const { useAdminAuth } = await import('../../../stores/useAdminAuth')
    useAdminAuth.setState({ status: 'authed', identity: { role: 'leader', group: 'KM 대학부', subgroup: '', ministry: '' } })
    await renderKiosk()

    expect(await screen.findByPlaceholderText('이름 검색...')).toBeInTheDocument()
    expect(screen.queryByLabelText('키오스크 비밀번호')).not.toBeInTheDocument()
  })

  it('sends the read-only pastor role to the admin panel instead of the kiosk', async () => {
    const { useAdminAuth } = await import('../../../stores/useAdminAuth')
    useAdminAuth.setState({ status: 'authed', identity: { role: 'pastor', group: '', subgroup: '', ministry: '' } })
    await renderKiosk()

    expect(await screen.findByText('admin-panel-here')).toBeInTheDocument()
  })

  it('Google sign-in from the gate stores /kiosk as the OAuth return path', async () => {
    const { supabase } = await import('../../../lib/supabase')
    await renderKiosk()

    await userEvent.click(screen.getByRole('button', { name: 'Google로 로그인' }))

    expect(supabase.auth.signInWithOAuth).toHaveBeenCalled()
    expect(sessionStorage.getItem('kccp-oauth-return')).toBe('/kiosk')
  })

  it('나가기 exits in one tap — no password, no confirm — to the admin panel, keeping the session', async () => {
    const { adminVerify } = await import('../../../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockResolvedValue({ role: 'welcoming', group: '', subgroup: '', ministry: '' })
    await renderKiosk()
    await userEvent.type(screen.getByLabelText('키오스크 비밀번호'), 'kccpwelcome')
    await userEvent.click(screen.getByRole('button', { name: '키오스크 시작' }))
    await screen.findByPlaceholderText('이름 검색...')

    await userEvent.click(screen.getByRole('button', { name: '나가기' }))

    expect(await screen.findByText('admin-panel-here')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const { useAdminAuth } = await import('../../../stores/useAdminAuth')
    expect(useAdminAuth.getState().status).toBe('authed')
  })

  it('shows the wrong-password error when verification fails', async () => {
    const { adminVerify } = await import('../../../lib/api')
    ;(adminVerify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not authorized'))
    await renderKiosk()

    await userEvent.type(screen.getByLabelText('키오스크 비밀번호'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: '키오스크 시작' }))

    expect(await screen.findByText('비밀번호가 올바르지 않습니다')).toBeInTheDocument()
  })
})

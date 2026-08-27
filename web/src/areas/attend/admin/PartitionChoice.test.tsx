import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { i18n } from '../../../lib/i18n'
import { PartitionChoice } from './PartitionChoice'
import { useAdminAuth } from '../../../stores/useAdminAuth'

vi.mock('../../../lib/api', () => ({
  adminVerify: vi.fn(),
  adminVerifyGoogle: vi.fn().mockResolvedValue({ role: 'super_admin', group: '', subgroup: '', ministry: '', partition: 'adult' }),
  getLoginPosition: vi.fn().mockResolvedValue(null),
  GEO_LOGIN_WAIT_MS: 2000,
  setAdminPassword: vi.fn(),
  setAdminToken: vi.fn(),
  setAdminPartition: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
}))

beforeAll(async () => { await i18n.init() })
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  useAdminAuth.setState({ chosenPartition: null, status: 'authed' })
})

const renderChoice = () => render(<MemoryRouter><PartitionChoice /></MemoryRouter>)

describe('어느 부로 들어갈까', () => {
  it('두 부를 모두 내놓는다 — 이 화면의 전부다', () => {
    renderChoice()
    expect(screen.getByText('대학·청년부')).toBeInTheDocument()
    expect(screen.getByText('장년부')).toBeInTheDocument()
  })

  it('고른 부가 스토어에 남는다', async () => {
    renderChoice()
    await userEvent.click(screen.getByText('장년부'))
    expect(useAdminAuth.getState().chosenPartition).toBe('adult')
  })

  it('대학·청년부를 골라도 마찬가지 — 기본값에 기대지 않고 실제로 고른다', async () => {
    renderChoice()
    await userEvent.click(screen.getByText('대학·청년부'))
    expect(useAdminAuth.getState().chosenPartition).toBe('youth')
  })
})

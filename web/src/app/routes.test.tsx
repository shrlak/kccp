import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import { i18n } from '../lib/i18n'
import { AppRoutes } from './routes'

// Importing + awaiting i18n makes our custom instance react-i18next's default and
// guarantees it's ready, so useTranslation() resolves real strings (not keys).
beforeAll(async () => {
  await i18n.init()
  // Warm the lazy route chunks. Under Vitest the first of these imports has to transform
  // supabase-js and the entire admin tree, which on its own can outlast a findBy timeout
  // — the tests are about routing, not about module transform time.
  await Promise.all([
    import('../areas/attend/admin/AdminShell'),
    import('../areas/attend/kiosk/KioskShell'),
    import('../areas/attend/share/ShareTargetScreen'),
    import('../areas/attend/dongsan/DongsanBoardScreen'),
  ])
})
beforeEach(() => { queryClient.clear() })

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('routes', () => {
  it('renders the KCCP landing at / (kiosk-first: branded page, no check-in)', () => {
    renderAt('/')
    expect(screen.getByRole('link', { name: '교회 키오스크 시작' })).toBeInTheDocument()
    // The hero heading is a live clock (Pittsburgh time), not a slogan.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/\d{1,2}:\d{2}/)
    // Individual self check-in was removed — no check-in button on the landing.
    expect(screen.queryByRole('button', { name: '체크인' })).not.toBeInTheDocument()
  })

  // /admin, /kiosk and /share are lazy route chunks (routes.tsx), so each renders the
  // Suspense splash for a tick before its screen appears — hence findBy, not getBy.
  it('renders the admin login gate at /admin', async () => {
    renderAt('/admin')
    expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeInTheDocument()
  })

  it('gates /kiosk behind the kiosk login gate when not authed (password + Google)', async () => {
    renderAt('/kiosk')
    expect(await screen.findByLabelText('키오스크 비밀번호')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '키오스크 시작' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeInTheDocument()
  })

  // The share target is deliberately open: a photo shared from the phone, or the card
  // link handed to whoever is at the welcome desk, must reach the scan flow with no
  // sign-in in the way.
  it('opens /share without any login', async () => {
    renderAt('/share')
    expect(await screen.findByRole('button', { name: '카드 사진 선택' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Google로 로그인' })).not.toBeInTheDocument()
  })

  // 동산지기가 받는 링크도 로그인을 지나지 않는다 — 토큰이 신원이다. (토큰을 풀어 줄 서버가
  // 여기에는 없으므로 명단까지는 못 간다. 확인하려는 것은 이 주소가 로그인 문이 아니라 동산
  // 화면으로 간다는 것 — 화면이 어떻게 채워지는지는 DongsanBoardScreen.test.tsx가 본다.)
  it('opens /dongsan/:token without any login', async () => {
    renderAt('/dongsan/tok123')
    expect(await screen.findByRole('heading', { name: '동산 출석' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Google로 로그인' })).not.toBeInTheDocument()
  })

  it('renders the 404 page for an unknown path', () => {
    renderAt('/does-not-exist')
    expect(screen.getByText('Error · 404')).toBeInTheDocument()
  })
})

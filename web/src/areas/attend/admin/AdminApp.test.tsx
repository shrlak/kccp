import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../../lib/queryClient'
import { i18n } from '../../../lib/i18n'
import { useAdminAuth } from '../../../stores/useAdminAuth'
import { AdminApp } from './AdminApp'

beforeAll(async () => { await i18n.init() })

// Kitchen-sink payload that satisfies every query the admin tabs fire on mount
// (config, roster) — the rail behavior under test never reads it.
const apiStub = {
  summerMode: false,
  role: 'super_admin', members: [], log: [],
}

beforeEach(() => {
  queryClient.clear()
  // The panel remembers its tab in sessionStorage — clear it so tests don't inherit
  // each other's last tab.
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(apiStub), { status: 200 })))
  useAdminAuth.setState({
    status: 'authed',
    identity: { role: 'super_admin', group: '', subgroup: '', ministry: '' },
  })
})

function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin']}>
        <AdminApp />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdminApp ministry navigation', () => {
  it('starts as a compact 64 px rail and expands on hover', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    expect(aside.className).toContain('w-16')
    fireEvent.mouseEnter(aside)
    expect(aside.className).toContain('w-60')
  })

  it('switches tabs and returns the rail to its compact state', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    fireEvent.mouseEnter(aside)
    const sheetTab = within(aside).getByRole('button', { name: '출석부' })
    fireEvent.click(sheetTab)
    expect(aside.className).toContain('w-16')
    expect(sheetTab).toHaveAttribute('aria-current', 'page')
  })

  it('expands for keyboard focus and collapses when focus leaves', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    const todayTab = within(aside).getByRole('button', { name: '오늘' })
    fireEvent.focus(todayTab)
    expect(aside.className).toContain('w-60')
    fireEvent.blur(todayTab)
    expect(aside.className).toContain('w-16')
  })

  it('mobile bottom bar: 4 everyday tabs + 더보기 sheet holding the rest', () => {
    renderApp()
    const bottom = screen.getByRole('navigation', { name: '빠른 이동' })
    for (const name of ['오늘', '출석부', '멤버', '통계', '더보기']) {
      expect(within(bottom).getByRole('button', { name })).toBeInTheDocument()
    }
    // Overflow tabs are not in the bar, only inside the 더보기 sheet.
    expect(within(bottom).queryByRole('button', { name: '설정' })).toBeNull()
    fireEvent.click(within(bottom).getByRole('button', { name: '더보기' }))
    const sheet = screen.getByRole('dialog')
    for (const name of ['새가족', '방문자', '관리자', '동산', '설정']) {
      expect(within(sheet).getByRole('button', { name })).toBeInTheDocument()
    }
    // Selecting a tab from the sheet closes it and marks 더보기 as the active area.
    fireEvent.click(within(sheet).getByRole('button', { name: '설정' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(bottom).getByRole('button', { name: '더보기' })).toHaveAttribute('aria-current', 'page')
  })

  it('staff (break-glass 운영진) sees operational tabs but not super-only ones', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'staff', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    // 리더+새가족팀 combined: day-to-day tabs + kiosk are available.
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
    // super-only tabs (admins/dongsan/settings) stay hidden.
    for (const name of ['관리자', '동산', '설정']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // Header shows the 운영진 role label.
    expect(screen.getAllByText(/운영진 · 대학·청년부/).length).toBeGreaterThan(0)
  })

  it('break-glass super password lands on the full panel (super-only tabs visible)', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'super_admin', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자', '관리자', '동산', '설정']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('break-glass leader password lands on the 리더 dashboard (all-roster, no super tabs)', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'leader', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
    for (const name of ['관리자', '동산', '설정']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // Role label + "전체" scope (a group-less break-glass leader sees everyone).
    expect(screen.getAllByText(/리더 · 대학·청년부/).length).toBeGreaterThan(0)
  })

  it('break-glass welcoming password lands on the 새가족팀 dashboard', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'welcoming', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
    for (const name of ['관리자', '동산', '설정']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.getAllByText(/새가족팀 · 대학·청년부/).length).toBeGreaterThan(0)
  })

  // 장년부 비밀번호로 들어오면 같은 패널이되 장년부의 것이다: 헤더가 어느 부인지 말해 주고,
  // 새가족 교육 탭은 없다 (대학·청년부의 2주 과정을 따라가는 탭이라서). 명단 자체가 장년부만
  // 담겨 오는 것은 서버가 보장한다 — 여기서 검사하는 것은 화면이 그 사실을 반영하는가다.
  it('the 장년부 password opens the 장년부 panel — labelled as such, without 새가족 교육', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'super_admin', group: '', subgroup: '', ministry: '', partition: 'adult' },
    })
    renderApp()
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    // 장년부는 하위 단위를 셀이라 부르므로 그 탭 이름도 '동산'이 아니라 '셀'이다.
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자', '관리자', '셀', '설정']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(rail).queryByRole('button', { name: '동산' })).toBeNull()
    expect(within(rail).queryByRole('button', { name: '새가족 교육' })).toBeNull()
    expect(screen.getAllByText(/장년부/).length).toBeGreaterThan(0)
  })

  // 반대로 대학·청년부 패널에는 새가족 교육이 그대로 있어야 한다 — 위 테스트가 탭을 통째로
  // 없애 버리는 회귀를 잡아내도록.
  it('keeps 새가족 교육 — and the 동산 wording — in the 대학·청년부 panel', () => {
    renderApp()
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    expect(within(rail).getByRole('button', { name: '새가족 교육' })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: '동산' })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: '셀' })).toBeNull()
  })
})

// 리로드하면 이전에 보던 화면으로 돌아온다: 라우트는 URL이, 관리자 패널의 탭은
// sessionStorage가 기억한다 (adminTab.ts). 마운트 = 리로드 이후의 첫 렌더.
describe('AdminApp 탭 복원', () => {
  it('restores the tab that was open before the reload instead of 오늘', () => {
    sessionStorage.setItem('kccp-admin-tab', 'newfamily')
    renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('새가족')
  })

  it('remembers a tab as soon as it is selected', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    fireEvent.mouseEnter(aside)
    fireEvent.click(within(aside).getByRole('button', { name: '출석부' }))
    expect(sessionStorage.getItem('kccp-admin-tab')).toBe('sheet')
  })

  it('falls back to 오늘 when the remembered tab is out of this role’s reach', () => {
    sessionStorage.setItem('kccp-admin-tab', 'settings')
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'leader', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('오늘')
  })

  it('ignores a stored value that is not a tab', () => {
    sessionStorage.setItem('kccp-admin-tab', 'not-a-tab')
    renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('오늘')
  })

  it('forgets the tab on sign-out, so the next sign-in starts on 오늘', () => {
    sessionStorage.setItem('kccp-admin-tab', 'members')
    renderApp()
    fireEvent.click(screen.getAllByRole('button', { name: '로그아웃' })[0])
    expect(sessionStorage.getItem('kccp-admin-tab')).toBeNull()
  })
})

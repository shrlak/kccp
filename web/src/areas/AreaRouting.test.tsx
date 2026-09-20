import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { queryClient } from '../lib/queryClient'
import { useAdminAuth } from '../stores/useAdminAuth'
import { AdminShell } from './attend/admin/AdminShell'
import type { AdminIdentity } from '../lib/api'

// 합치기의 핵심 규칙을 화면 쪽에서 붙잡는다: **자격이 가진 영역이 무엇을 띄울지 정한다.**
// 지키는 것은 서버지만(resolveAdmin이 라우트마다 검사한다), 화면도 같은 답을 내야
// 사람이 못 누르는 칸을 보지 않는다.
//
// 무거운 자식(AdminApp)은 명단 UI 전체를 끌고 오므로 여기서는 세워 둔다 — 이 테스트가
// 묻는 것은 "어느 화면이 뜨는가"이지 그 화면의 내용이 아니다.
vi.mock('./attend/admin/AdminApp', () => ({ AdminApp: () => <div>출석 패널</div> }))
vi.mock('./attend/admin/LoginGate', () => ({ LoginGate: () => <div>로그인</div> }))
vi.mock('./attend/admin/PartitionChoice', () => ({ PartitionChoice: () => <div>부 고르기</div> }))

// 슬라이드 마법사의 첫 단계는 예배·콘티 목록을 서버에서 읽는다. 이 테스트가 묻는 것은
// 라우팅이라 그 왕복은 세워 둔다.
vi.mock('./slides/lib/setlists', () => ({
  getServices: () => Promise.resolve({ services: [] }),
  getSetlists: () => Promise.resolve({ setlists: [] }),
  contiUrl: () => Promise.resolve({ url: '', expiresIn: 300 }),
  uploadConti: () => Promise.resolve({ setlistId: 's1', path: 'p' }),
  uploadDeck: () => Promise.resolve({ path: 'p' }),
}))

// 인도자 화면도 열자마자 서버에 자기가 누구인지 묻는다. 같은 이유로 세워 둔다.
vi.mock('./praise/lib/conti', () => ({
  getLeaderContext: () =>
    Promise.resolve({
      team: { id: 'team-ju', name: '주랑 찬양팀', kind: 'praise', partition: 'youth' },
      teams: [],
      services: [{ id: 'sv-3', name: '3부', startsAt: '14:00:00', partition: 'youth', leadsPpt: true }],
      defaultServiceId: 'sv-3',
      serviceDate: '2026-09-20',
      leader: { email: 'leader@example.com', name: '' },
    }),
  getMySetlists: () => Promise.resolve({ setlists: [] }),
  uploadConti: vi.fn(),
  uploadDeck: vi.fn(),
  contiUrl: vi.fn(),
  deckUrl: vi.fn(),
}))

function signedInAs(identity: Partial<AdminIdentity>) {
  useAdminAuth.setState({
    status: 'authed',
    identity: {
      role: 'super_admin',
      group: '',
      subgroup: '',
      ministry: '',
      partition: 'youth',
      ...identity,
    } as AdminIdentity,
    chosenArea: null,
    chosenPartition: null,
  })
}

function renderShell() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminShell />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('영역 라우팅 — 자격이 무엇을 띄울지 정한다', () => {
  beforeEach(() => {
    useAdminAuth.setState({ status: 'idle', identity: null, chosenArea: null, chosenPartition: null })
  })

  it('출석만 가진 자격은 묻지 않고 출석 패널로 간다', () => {
    signedInAs({ areas: ['attend'] })
    renderShell()
    expect(screen.getByText('출석 패널')).toBeInTheDocument()
  })

  it('슬라이드만 가진 자격은 슬라이드로 가고, 출석 패널은 뜨지 않는다', async () => {
    signedInAs({ role: 'media', partition: 'adult', areas: ['slides'] })
    renderShell()
    // 지연 로드라 한 틱 뒤에 뜬다.
    expect(await screen.findByRole('heading', { name: '슬라이드' })).toBeInTheDocument()
    expect(screen.queryByText('출석 패널')).not.toBeInTheDocument()
    // 마법사 첫 단계까지 왔다. 예배 목록은 이제 화면에 박혀 있지 않고 서버가 준다
    // (services/team_services) — 그것이 맞게 좁혀지는지는 서버 쪽 테스트의 일이고,
    // 여기서 묻는 것은 "어느 화면이 뜨는가"다.
    expect(screen.getByRole('button', { name: /1 찬양/ })).toBeInTheDocument()
    expect(screen.getByText('장년부')).toBeInTheDocument()
  })

  it('찬양만 가진 자격(인도자)은 콘티 화면으로 가고, 명단에는 닿지 않는다', async () => {
    signedInAs({ role: 'praise_leader', areas: ['praise'] })
    renderShell()
    expect(await screen.findByRole('heading', { name: '콘티 올리기' })).toBeInTheDocument()
    expect(screen.queryByText('출석 패널')).not.toBeInTheDocument()
    // 마법사의 여섯 단계도 뜨지 않는다 — 인도자에게는 그 물음이 해당하지 않는다.
    expect(screen.queryByRole('button', { name: /1 찬양/ })).not.toBeInTheDocument()
  })

  it('영역을 둘 가진 자격에게만 고르기 화면이 뜬다', async () => {
    signedInAs({ areas: ['attend', 'slides'] })
    renderShell()
    expect(screen.getByText(/영역을/)).toBeInTheDocument()
    expect(screen.queryByText('출석 패널')).not.toBeInTheDocument()

    // 고르면 그 영역으로 들어간다.
    useAdminAuth.getState().chooseArea('attend')
    expect(await screen.findByText('출석 패널')).toBeInTheDocument()
  })

  it('영역이 없는 옛 서버 응답은 출석 하나로 읽는다', () => {
    // areas를 내려주지 않는 엣지 함수 앞에서 새 화면이 빈 손이 되면 안 된다.
    signedInAs({})
    renderShell()
    expect(screen.getByText('출석 패널')).toBeInTheDocument()
  })

  it('로그인 전에는 문만 보인다', () => {
    renderShell()
    expect(screen.getByText('로그인')).toBeInTheDocument()
  })
})

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
    // 장년부 계정이므로 1·2부만 보인다 — 3부는 대학·청년부의 것이다.
    expect(screen.getByText('주일 1부')).toBeInTheDocument()
    expect(screen.getByText('주일 2부')).toBeInTheDocument()
    expect(screen.queryByText('주일 3부')).not.toBeInTheDocument()
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

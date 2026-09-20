// 인도자 화면이 **묻지 않는 것들**을 붙잡는다.
//
// 이 기능의 값은 물음이 없다는 데 있다. 팀·부(部)·날짜를 화면이 묻기 시작하면 「콘티만
// 올리면 된다」가 아니게 되고, 그러면 미디어팀이 카톡으로 받아 다시 올리던 일이 인도자
// 쪽으로 옮겨 갔을 뿐이다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useAdminAuth } from '../../stores/useAdminAuth'
import type { AdminIdentity } from '../../lib/api'
import { PraiseLeaderShell } from './PraiseLeaderShell'
import type { LeaderContext } from './lib/conti'

const oneService: LeaderContext = {
  team: { id: 'team-ju', name: '주랑 찬양팀', kind: 'praise', partition: 'youth' },
  teams: [],
  services: [{ id: 'sv-3', name: '3부', startsAt: '14:00:00', partition: 'youth', leadsPpt: true }],
  defaultServiceId: 'sv-3',
  serviceDate: '2026-09-20',
  leader: { email: 'leader@example.com', name: '' },
}

const twoServices: LeaderContext = {
  team: { id: 'team-hep', name: '헵시바 찬양팀', kind: 'praise', partition: 'adult' },
  teams: [],
  services: [
    { id: 'sv-1', name: '1부', startsAt: '09:00:00', partition: 'adult', leadsPpt: true },
    { id: 'sv-2', name: '2부', startsAt: '11:15:00', partition: 'adult', leadsPpt: true },
  ],
  // 이끄는 예배가 둘이라 서버가 고르지 못한다 — 화면이 묻는 유일한 자리다.
  defaultServiceId: null,
  serviceDate: '2026-09-20',
  leader: { email: 'lead@example.com', name: '' },
}

const ownerNoTeam: LeaderContext = {
  team: null,
  teams: [{ id: 'team-ju', name: '주랑 찬양팀', kind: 'praise', partition: 'youth' }],
  services: [],
  defaultServiceId: null,
  serviceDate: '2026-09-20',
  leader: { email: 'owner@example.com', name: '' },
}

let context: LeaderContext = oneService

vi.mock('./lib/conti', () => ({
  getLeaderContext: () => Promise.resolve(context),
  getMySetlists: () => Promise.resolve({ setlists: [] }),
  uploadConti: vi.fn(),
  uploadDeck: vi.fn(),
  contiUrl: vi.fn(),
  deckUrl: vi.fn(),
}))

function signedIn() {
  useAdminAuth.setState({
    status: 'authed',
    identity: {
      role: 'praise_leader',
      group: '',
      subgroup: '',
      ministry: '',
      partition: 'youth',
      areas: ['praise'],
    } as AdminIdentity,
  })
}

describe('PraiseLeaderShell', () => {
  beforeEach(() => {
    context = oneService
    signedIn()
  })

  it('팀도 예배도 날짜도 묻지 않는다 — 콘티 하나를 고르는 버튼뿐이다', async () => {
    render(<PraiseLeaderShell />)

    // 팀은 자격이 안다.
    expect(await screen.findByText('주랑 찬양팀')).toBeInTheDocument()
    // 예배가 하나뿐이면 고르는 자리가 없다.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('3부')).toBeInTheDocument()
    // 날짜는 서버가 정한다 — 화면의 시계는 폰의 시계다.
    expect(screen.getByText(/2026-09-20/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '콘티 PDF 고르기' })).toBeEnabled(),
    )
  })

  it('이끄는 예배가 둘이면 그것만 묻는다 — 임의로 고르면 1부 콘티가 2부에 앉는다', async () => {
    context = twoServices
    render(<PraiseLeaderShell />)

    const picker = await screen.findByRole('combobox')
    expect(picker).toHaveValue('')
    expect(screen.getByRole('option', { name: /1부/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /2부/ })).toBeInTheDocument()
    // 고르기 전에는 올릴 수 없다.
    expect(screen.getByRole('button', { name: '콘티 PDF 고르기' })).toBeDisabled()
  })

  it('팀이 없는 자격(소유자)에게만 팀을 묻는다', async () => {
    context = ownerNoTeam
    render(<PraiseLeaderShell />)

    expect(await screen.findByText('이 계정에는 팀이 없어 고르셔야 합니다.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '주랑 찬양팀' })).toBeInTheDocument()
  })
})

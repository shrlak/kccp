import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAdminAuth } from '../../stores/useAdminAuth'
import type { AdminIdentity } from '../../lib/api'
import { SlidesShell } from './SlidesShell'

// 첫 단계는 서버에서 예배·콘티 목록을 읽는다. 이 테스트가 묻는 것은 "여섯 단계를 걸어갈
// 수 있는가"라서, 그 왕복은 세워 둔다.
vi.mock('./lib/setlists', () => ({
  getServices: () => Promise.resolve({ services: [] }),
  getSetlists: () => Promise.resolve({ setlists: [] }),
  contiUrl: () => Promise.resolve({ url: '', expiresIn: 300 }),
  uploadConti: () => Promise.resolve({ setlistId: 's1', path: 'p' }),
  uploadDeck: () => Promise.resolve({ path: 'p' }),
}))

function signedIn(identity: Partial<AdminIdentity> = {}) {
  useAdminAuth.setState({
    status: 'authed',
    identity: {
      role: 'media',
      group: '',
      subgroup: '',
      ministry: '',
      partition: 'adult',
      areas: ['slides'],
      ...identity,
    } as AdminIdentity,
  })
}

describe('SlidesShell — 여섯 단계', () => {
  beforeEach(() => signedIn())

  it('예배 순서대로 걸어간다: 찬양 → 성경 말씀 → 설교 → 광고 → 추가 자료 → 다운로드', async () => {
    const user = userEvent.setup()
    render(<SlidesShell />)

    // 이 순서가 곧 예배 순서다. 바꾸는 것은 리팩터링이 아니라 예배를 바꾸는 일이다.
    const walk = ['성경 말씀', '설교', '광고', '추가 자료', '다운로드']
    expect(await screen.findByText('콘티')).toBeInTheDocument()
    for (const label of walk) {
      await user.click(screen.getByRole('button', { name: new RegExp(`다음: ${label}`) }))
    }
    expect(screen.getByRole('button', { name: /슬라이드 만들기/ })).toBeInTheDocument()
    // 마지막 단계에는 다음이 없다.
    expect(screen.queryByRole('button', { name: /^다음:/ })).not.toBeInTheDocument()
  })

  it('지나온 단계로는 되돌아갈 수 있다 — 광고를 적다 곡 하나가 떠오른다', async () => {
    const user = userEvent.setup()
    render(<SlidesShell />)
    await user.click(await screen.findByRole('button', { name: /다음: 성경 말씀/ }))
    await user.click(screen.getByRole('button', { name: /다음: 설교/ }))
    await user.click(screen.getByRole('button', { name: /1 찬양/ }))
    expect(screen.getByText('콘티')).toBeInTheDocument()
  })

  it('로그인한 부(部)를 보여 준다 — 미디어 계정은 자기 부의 예배만 맡는다', async () => {
    render(<SlidesShell />)
    expect(await screen.findByText('장년부')).toBeInTheDocument()
  })

  it('내용이 하나도 없으면 만들기가 잠긴다 — 뼈대만 있는 덱을 내려받게 두지 않는다', async () => {
    const user = userEvent.setup()
    render(<SlidesShell />)
    for (const label of ['성경 말씀', '설교', '광고', '추가 자료', '다운로드']) {
      await user.click(await screen.findByRole('button', { name: new RegExp(`다음: ${label}`) }))
    }
    expect(screen.getByRole('button', { name: /슬라이드 만들기/ })).toBeDisabled()
  })
})

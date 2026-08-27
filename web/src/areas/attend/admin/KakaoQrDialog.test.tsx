import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, beforeAll } from 'vitest'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'
import { KakaoQrDialog } from './KakaoQrDialog'
import type { Member } from '../../../lib/api'

// 카톡 추가 창: 찍을 수 있는 사람은 QR로, 찍을 수 없는 사람은 감추지 않고 따로 모아
// 남은 단서(카톡 아이디)를 보여주는지.

const member = (id: string, name: string, extra: Partial<Member> = {}): Member => ({
  id, name, group_name: '대학부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: true, notes: '', registration_date: '2026-06-07', ...extra,
})

beforeAll(async () => { await i18n.init() })

const show = (members: Member[], today = '2026-06-08') =>
  render(<ToastProvider><KakaoQrDialog members={members} today={today} onClose={() => {}} /></ToastProvider>)

describe('KakaoQrDialog', () => {
  it('draws a QR for everyone who has a usable phone number', async () => {
    show([
      member('1', '김서현', { phone: '(412) 703-0123' }),
      member('2', '이준서', { phone: '(412) 555-1234', kakao_id: 'park47878' }),
    ])
    // QR은 비동기로 그려진다 (인코더를 그때 내려받는다).
    expect(await screen.findByRole('img', { name: /김서현/ })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /이준서/ })).toBeInTheDocument()
  })

  it('draws a QR from a phone written into the 카톡 아이디 box', async () => {
    // 전화번호 칸이 비어 있어도 카톡 칸에 번호가 있으면 연락처를 만들 수 있다.
    show([member('1', '이준서', { phone: '', kakao_id: '010 3220 9178' })])
    expect(await screen.findByRole('img', { name: /이준서/ })).toBeInTheDocument()
  })

  it('does not hide someone with no number — it lists them with their 카톡 아이디', async () => {
    show([
      member('1', '김서현', { phone: '(412) 703-0123' }),
      member('2', '최민', { phone: '', kakao_id: 'minw48594' }),
    ])
    await screen.findByRole('img', { name: /김서현/ })
    expect(screen.queryByRole('img', { name: /최민/ })).not.toBeInTheDocument()
    // 이름과 아이디가 경고 블록에 남아 있어야 한다 — 손으로 검색할 유일한 단서다.
    expect(screen.getByText('최민')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /minw48594/ })).toBeInTheDocument()
  })

  it('says so when there is nothing to go on at all', async () => {
    show([member('1', '최민', { phone: '', kakao_id: '' })])
    expect(await screen.findByText(i18n.t('admin.kakaoQr.nothingToGoOn'))).toBeInTheDocument()
  })

  it('offers the recent cohort first, and the whole term as the other choice', async () => {
    // 2026-06-08(월) 기준 그 주일은 06-07 — 최근 2주에 드는 사람과 아닌 사람.
    show([
      member('1', '김서현', { phone: '(412) 703-0123', registration_date: '2026-06-07' }),
      member('2', '옛사람', { phone: '(412) 555-1234', registration_date: '2026-05-10' }),
    ])
    const recent = screen.getByRole('button', { name: i18n.t('admin.kakaoQr.cohortRecent', { n: 1 }) })
    expect(recent).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('admin.kakaoQr.cohortAll', { n: 2 }) })).toBeInTheDocument()
    // 기본은 최근 — 이번에 새로 온 사람만 그려진다.
    expect(await screen.findByRole('img', { name: /김서현/ })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /옛사람/ })).not.toBeInTheDocument()
  })

  it('falls back to the whole term when nobody registered in the last two weeks', async () => {
    show([member('1', '옛사람', { phone: '(412) 555-1234', registration_date: '2026-05-10' })])
    // 빈 화면 대신 그 사람이 그려진다.
    expect(await screen.findByRole('img', { name: /옛사람/ })).toBeInTheDocument()
  })

  it('marks a value that is not actually an id, so nobody searches for it', async () => {
    show([member('1', '박지우', { phone: '(412) 913-2930', kakao_id: 'charles9901@naver.com' })])
    const tile = (await screen.findByRole('img', { name: /박지우/ })).closest('li')!
    expect(within(tile).getByRole('button', { name: /charles9901@naver\.com/ })).toBeInTheDocument()
  })
})

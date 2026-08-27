import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../../lib/i18n'
import { ToastProvider } from '../../../components/ui/Toast'
import { EditModal } from './MemberDialogs'
import type { Member } from '../../../lib/api'

vi.mock('../../../lib/api', () => ({
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
  addMemberAttendance: vi.fn(),
  removeAttendance: vi.fn(),
  getConfig: vi.fn().mockResolvedValue({ summerMode: false }),
  // useAppConfig picks the logged-in 부's block out of the /api/config response.
  configFor: (cfg: unknown) => cfg,
  getDongsanNames: vi.fn().mockResolvedValue({ 대학부: ['1동산', '2동산'], 청년부: ['해동산'] }),
}))

beforeAll(async () => { await i18n.init() })
beforeEach(() => { vi.clearAllMocks() })

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

const member = {
  id: 'm1',
  name: '홍길동',
  group_name: '대학부',
  subgroup: '1동산',
  member_role: '',
  is_new_member: false,
  gender: '',
  phone: '',
  kakao_id: '',
  birth_date: '',
  notes: '',
} as unknown as Member

const filled = {
  ...member,
  is_new_member: true,
  gender: '남',
  phone: '412-555-0142',
  kakao_id: 'gil_dong',
  birth_date: '2004-03-15',
  registration_date: '2026-07-05',
  baptism_status: '세례',
  school_or_work: '대학생 · Pitt 컴퓨터공학',
  faith_duration: '1-3년',
  pastoral_visit_requested: true,
} as unknown as Member

describe('EditModal — 새가족 등록 카드 as the form', () => {
  it("shows all of the member's info directly on the editable card", () => {
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    expect(screen.getByText('< KCCP 빛주사랑 대학청년부 - 새가족 등록 카드 >')).toBeInTheDocument()
    // The card's cells are the inputs, prefilled with the stored info.
    expect(screen.getByLabelText('이름')).toHaveValue('홍길동')
    expect(screen.getByLabelText('전화번호')).toHaveValue('(412) 555-0142')
    expect(screen.getByLabelText('카톡 아이디')).toHaveValue('gil_dong')
    expect(screen.getByLabelText('생년월일')).toHaveValue('2004-03-15')
    expect(screen.getByLabelText('등록일')).toHaveValue('2026-07-05')
    expect(screen.getByLabelText('학교/전공 or 직장')).toHaveValue('Pitt 컴퓨터공학')
    // Checkboxes reflect the stored choices (aria-pressed) — 남 circled, 대학생/세례/1-3년/O.
    expect(screen.getByRole('button', { name: '남' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '대학생' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^세례 Baptism$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1-3년' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'O' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '카드 다운로드 (JPG)' })).toBeInTheDocument()
  })

  it('edits made on the card are saved: typed cells and tapped checkboxes land in the payload', async () => {
    const { updateMember } = await import('../../../lib/api')
    ;(updateMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    await userEvent.clear(screen.getByLabelText('전화번호'))
    await userEvent.type(screen.getByLabelText('전화번호'), '412-555-9999')
    // 세례 여부는 복수 선택 — 이미 켜져 있던 세례에 입교가 더해진다.
    await userEvent.click(screen.getByRole('button', { name: '입교 Confirmation' }))
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(updateMember).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        phone: '(412) 555-9999',
        baptismStatus: '입교, 세례',
        schoolOrWork: '대학생 · Pitt 컴퓨터공학',
        pastoralVisitRequested: true,
      }),
    )
  })

  it('등록일 제거 clears the 등록일 and the 새가족 flag (removes them from the 새가족 list on save)', async () => {
    const { updateMember } = await import('../../../lib/api')
    ;(updateMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '등록일 제거 · 새가족 목록에서 제외' }))
    expect(screen.getByLabelText('등록일')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '새가족' })).not.toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(updateMember).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ registrationDate: null, isNewMember: false }),
    )
  })

  it("동산 is a dropdown of the member's 부서's configured 동산, and a change lands in the payload", async () => {
    const { updateMember } = await import('../../../lib/api')
    ;(updateMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    const select = await screen.findByLabelText('동산')
    expect(select.tagName).toBe('SELECT')
    await waitFor(() => expect(select).toContainHTML('2동산'))
    // 대학부 member: only 대학부's 동산 (plus the blank option) are offered.
    expect(select).not.toContainHTML('해동산')
    expect(select).toHaveValue('1동산')

    await userEvent.selectOptions(select, '2동산')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(updateMember).toHaveBeenCalledWith('m1', expect.objectContaining({ subgroup: '2동산' }))
  })

  it("keeps a stored 동산 selectable even when it's no longer in the configured list", async () => {
    const stale = { ...filled, subgroup: '옛동산' } as unknown as Member
    renderWithProviders(<EditModal member={stale} onClose={vi.fn()} onAttendance={vi.fn()} />)

    const select = await screen.findByLabelText('동산')
    expect(select).toHaveValue('옛동산')
    await waitFor(() => expect(select).toContainHTML('1동산'))
    expect(select).toContainHTML('옛동산')
  })


  it('세례 여부는 여러 개를 고를 수 있고, 다시 누르면 빠진다', async () => {
    const { updateMember } = await import('../../../lib/api')
    ;(updateMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '유아세례 Infant Baptism' }))
    await userEvent.click(screen.getByRole('button', { name: '세례 Baptism' })) // 켜져 있던 것을 끈다
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect((updateMember as ReturnType<typeof vi.fn>).mock.calls[0][1].baptismStatus).toBe('유아세례')
  })

  it('해당없음은 다른 항목과 함께 선택되지 않는다', async () => {
    const { updateMember } = await import('../../../lib/api')
    ;(updateMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '해당없음 N/A' })) // 세례 → 해당없음
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect((updateMember as ReturnType<typeof vi.fn>).mock.calls[0][1].baptismStatus).toBe('해당없음')
  })

  it('상태 표기 box beneath the card: a preset adds a mark starting today', async () => {
    const { updateMember } = await import('../../../lib/api')
    ;(updateMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '이주' }))
    expect(screen.getByLabelText('상태 표기 (한국 귀국 · 이주 등)')).toHaveValue('이주')

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    const payload = (updateMember as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(payload.statusMarks).toHaveLength(1)
    expect(payload.statusMarks[0].note).toBe('이주')
    expect(payload.statusMarks[0].start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('멤버 한 명에게 상태 표기를 여러 개 달 수 있다 (추가 버튼)', async () => {
    const { updateMember } = await import('../../../lib/api')
    ;(updateMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    // 프리셋 하나 + 빈 표기 하나 → 두 칸이 생긴다.
    await userEvent.click(screen.getByRole('button', { name: '방학' }))
    await userEvent.click(screen.getByRole('button', { name: '상태 표기 추가' }))
    const notes = screen.getAllByLabelText('상태 표기 (한국 귀국 · 이주 등)')
    expect(notes).toHaveLength(2)
    await userEvent.type(notes[1], '한국 귀국')

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    const payload = (updateMember as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(payload.statusMarks.map((mark: { note: string }) => mark.note)).toEqual(['방학', '한국 귀국'])
  })

  it('표기 삭제 버튼으로 한 칸만 지운다', async () => {
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '방학' }))
    expect(screen.getAllByLabelText('상태 표기 (한국 귀국 · 이주 등)')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /표기 삭제/ }))
    expect(screen.queryAllByLabelText('상태 표기 (한국 귀국 · 이주 등)')).toHaveLength(0)
  })
})

describe('EditModal — member delete', () => {
  it('hides the delete control unless allowDelete is set', () => {
    renderWithProviders(<EditModal member={member} onClose={vi.fn()} onAttendance={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '멤버 삭제' })).toBeNull()
  })

  it('requires confirmation, then deletes the member, toasts, and closes', async () => {
    const { deleteMember } = await import('../../../lib/api')
    ;(deleteMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    const onClose = vi.fn()
    renderWithProviders(<EditModal member={member} allowDelete onClose={onClose} onAttendance={vi.fn()} />)

    // First click only reveals the irreversible confirm — no API call yet.
    await userEvent.click(screen.getByRole('button', { name: '멤버 삭제' }))
    expect(deleteMember).not.toHaveBeenCalled()
    expect(screen.getByText(/기존 출석 기록은 남아 있습니다/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(deleteMember).toHaveBeenCalledWith('m1')
    expect(await screen.findByText('홍길동 님이 삭제되었습니다')).toBeInTheDocument()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../../lib/queryClient'
import { i18n } from '../../../lib/i18n'
import { AdminSettings } from './AdminSettings'

beforeAll(async () => { await i18n.init() })

// 운영 중인 학기 일정 (여름학기 06-07 ~ 08-08). summerMode는 서버가 이 일정에서 계산해 준다.
const semesterDates = {
  spring: { start: '01-01', end: '05-09' },
  summer: { start: '06-07', end: '08-08' },
  fall: { start: '09-06', end: '12-13' },
}

function stubConfig(summerMode: boolean, semesterSchedule: unknown[] = []) {
  const config = { summerMode, semesterDates, semesterSchedule, groupColors: {} }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('/api/config')
        ? config
        : url.endsWith('/api/admin/card-scan-usage')
          ? { limit: 250, used: 0, remaining: 250 }
          : { sources: [], token: '', pingUrl: null, lastRun: null }
      // fetch always returns a fresh Response. Reusing one instance across these three
      // concurrent queries makes only the first .json() call succeed.
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }),
  )
}

beforeEach(() => {
  queryClient.clear()
  // Pin the clock so the rolling window is deterministic: 2026-08-05, inside the 여름학기
  // above (06-07 ~ 08-08). Only Date is faked so react-query/RTL timers still run.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-05T16:00:00Z'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderSettings() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminSettings />
    </QueryClientProvider>,
  )
}

describe('AdminSettings 학기 일정 (2년치)', () => {
  // 2026-08-05은 여름학기(06-07~08-08) 안 → 창은 진행 중인 2026 여름학기부터 6개.
  const windowLabels = [
    ['여름학기', '2026'], ['가을학기', '2026'], ['봄학기', '2027'],
    ['여름학기', '2027'], ['가을학기', '2027'], ['봄학기', '2028'],
  ] as const

  it('앞으로 6개 학기를 각각 실제 날짜로 편집할 수 있게 보여준다', async () => {
    // 저장된 목록이 아직 없어도 반복 템플릿에서 2년치를 만들어 보여준다.
    stubConfig(false)
    renderSettings()
    await screen.findByText(/여름학기\(06\.07–08\.08\)/) // 설정이 도착할 때까지

    expect(screen.getByText(/앞으로 6개 학기/)).toBeInTheDocument()
    for (const [season, year] of windowLabels) {
      expect(screen.getAllByText(season).length).toBeGreaterThan(0)
      expect(screen.getAllByText(year).length).toBeGreaterThan(0)
    }
    // 학기마다 시작일/종료일 → 6 × 2 = 12개의 날짜 입력.
    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect(dateInputs.length).toBe(12)
    expect((dateInputs[0] as HTMLInputElement).value).toBe('2026-06-07') // 진행 중인 여름학기
    expect((dateInputs[1] as HTMLInputElement).value).toBe('2026-08-08')
    expect((dateInputs[2] as HTMLInputElement).value).toBe('2026-09-06') // 다음 가을학기
    // 진행 중인 학기는 배지로 표시되고, 굴러가는 방식이 화면에 설명되어 있다.
    expect(screen.getByText('진행 중')).toBeInTheDocument()
    expect(screen.getByText(/학기가 끝나면 목록에서 빠지고 맨 뒤에 다음 학기가 자동으로 추가됩니다/)).toBeInTheDocument()
  })

  it('저장된 학기 목록이 있으면 그 날짜를 그대로 쓰고, 뒤쪽은 최신 패턴을 물려받는다', async () => {
    stubConfig(false, [
      { year: 2026, season: 'summer', start: '2026-06-07', end: '2026-08-08' },
      { year: 2026, season: 'fall', start: '2026-09-13', end: '2026-12-20' },
    ])
    renderSettings()
    await screen.findByText(/여름학기\(06\.07–08\.08\)/)

    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect((dateInputs[2] as HTMLInputElement).value).toBe('2026-09-13') // 저장된 가을학기
    expect((dateInputs[3] as HTMLInputElement).value).toBe('2026-12-20')
    // 목록에 없는 2027 가을은 가장 최근 가을(09-13~12-20) 패턴을 이어받는다.
    expect((dateInputs[8] as HTMLInputElement).value).toBe('2027-09-13')
    expect((dateInputs[9] as HTMLInputElement).value).toBe('2027-12-20')
  })
})

describe('AdminSettings 여름 모드', () => {
  it('보여주기만 하고 끄고 켜는 스위치는 없다 (학기 일정에서 자동 계산)', async () => {
    stubConfig(true)
    renderSettings()

    // 저장된 일정이 도착해야 안내 문구/배지가 실제 값으로 채워진다.
    await screen.findByText(/여름학기\(06\.07–08\.08\)/)
    // 자동 상태 배지 — 여름학기 안이라 켜짐.
    expect(screen.getByText('자동 · 켜짐')).toBeInTheDocument()
    // 토글은 사라졌다: 여름 모드를 조작할 스위치가 없어야 한다.
    expect(screen.queryByRole('switch', { name: '여름 모드' })).not.toBeInTheDocument()
  })

  it('여름학기가 아니면 꺼짐으로 표시된다', async () => {
    stubConfig(false)
    renderSettings()

    await screen.findByText(/여름학기\(06\.07–08\.08\)/)
    expect(screen.getByText('자동 · 꺼짐')).toBeInTheDocument()
    expect(screen.queryByText('자동 · 켜짐')).not.toBeInTheDocument()
  })
})

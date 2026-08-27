import { describe, it, expect } from 'vitest'
import {
  presentNamesToday,
  attendanceCount,
  filterByName,
  splitColumns,
  kioskColumns,
  KIOSK_COLS_DEPT,
  KIOSK_COLS,
  todayEntryFor,
  hiddenByStatus,
} from './kiosk'
import type { LogEntry, Member } from '../../../lib/api'

const member = (name: string, group: string, role = '', extra: Partial<Member> = {}): Member => ({
  id: name,
  name,
  group_name: group,
  subgroup: '',
  member_role: role,
  gender: '',
  phone: '',
  birth_date: null,
  kakao_id: '',
  is_new_member: false,
  notes: '',
  ...extra,
})

const log = (name: string, date: string, role?: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  name,
  group: '',
  subgroup: '',
  date,
  time: '',
  ts: 0,
  memberRole: role,
  ...extra,
})

describe('splitColumns', () => {
  it('splits into balanced columns, earlier columns getting any remainder', () => {
    expect(splitColumns([1, 2, 3, 4, 5, 6, 7], 4).map((c) => c.length)).toEqual([2, 2, 2, 1])
    expect(splitColumns([1, 2, 3, 4], 4).map((c) => c.length)).toEqual([1, 1, 1, 1])
    expect(splitColumns([1], 4).map((c) => c.length)).toEqual([1, 0, 0, 0])
  })
  it('always returns n columns, even when empty', () => {
    expect(splitColumns([], 4).map((c) => c.length)).toEqual([0, 0, 0, 0])
  })
  it('distributes round-robin (item i -> column i % n), so a sorted input reads left-to-right then down', () => {
    expect(splitColumns([1, 2, 3, 4, 5, 6, 7], 4)).toEqual([[1, 5], [2, 6], [3, 7], [4]])
  })
  it('covers every element exactly once', () => {
    const all = [1, 2, 3, 4, 5]
    expect(splitColumns(all, 4).flat().sort()).toEqual(all)
  })
})

describe('kioskColumns', () => {
  const members = [
    member('A', '대학부'),
    member('B', '대학부'),
    member('C', '청년부'),
    member('D', 'EM'),
    member('V', '대학부', 'visitor'),
  ]

  it('buckets 대학부/청년부 into KIOSK_COLS columns each, rest into others', () => {
    const cols = kioskColumns(members)
    expect(KIOSK_COLS).toBe(4)
    expect(cols.depts.map((d) => d.key)).toEqual(['대학부', '청년부'])
    expect(cols.depts[0].total).toBe(2) // A, B (visitor excluded)
    expect(cols.depts[0].columns).toHaveLength(4)
    expect(cols.depts[0].columns.flat().map((m) => m.name)).toEqual(['A', 'B'])
    expect(cols.depts[1].total).toBe(1) // C
    expect(cols.others.map((m) => m.name)).toEqual(['D'])
  })

  // 부서만 보기: 한 부서가 화면 전체를 쓰므로 8열. 나눈 개수와 화면 격자의 열 수가 같아야
  // 한 줄을 왼쪽→오른쪽으로 읽는 순서가 가나다 순이 된다.
  it('splits into 8 columns when a single 부서 has the whole width', () => {
    expect(KIOSK_COLS_DEPT).toBe(8)
    const eight = [...'가나다라마바사아자차'].map((n) => member(n, '대학부'))
    const cols = kioskColumns(eight, KIOSK_COLS_DEPT)
    expect(cols.depts[0].columns).toHaveLength(8)
    // 10명 / 8열 → 앞의 두 열만 2명 (round-robin), 첫 줄은 가나다라마바사아 순으로 읽힌다.
    expect(cols.depts[0].columns.map((c) => c.length)).toEqual([2, 2, 1, 1, 1, 1, 1, 1])
    expect(cols.depts[0].columns.map((c) => c[0].name)).toEqual([...'가나다라마바사아'])
    expect(cols.depts[0].total).toBe(10)
  })

  it('defaults to KIOSK_COLS when no column count is given (both 부서 side by side)', () => {
    expect(kioskColumns(members).depts[0].columns).toHaveLength(KIOSK_COLS)
  })

  it('excludes visitors from every bucket', () => {
    const cols = kioskColumns(members)
    const all = [...cols.depts.flatMap((d) => d.columns.flat()), ...cols.others]
    expect(all.find((m) => m.name === 'V')).toBeUndefined()
  })

  // 장년부 키오스크는 블록이 하나다. 명단은 서버가 이미 장년부만 내려주므로, 여기서 확인할
  // 것은 대학부/청년부 블록이 빈 칸으로 남지 않는다는 것 — 그리고 어쩌다 다른 부서 사람이
  // 섞여 들어와도 장년부 격자에는 들어가지 않고 아래 "그 외"로 빠진다는 것.
  it('장년부 kiosk draws one 부서 block, not the 대학부/청년부 pair', () => {
    const adults = [member('갑', '장년부'), member('을', '장년부'), member('X', '청년부')]
    const cols = kioskColumns(adults, KIOSK_COLS, 'adult')
    expect(cols.depts.map((d) => d.key)).toEqual(['장년부'])
    expect(cols.depts[0].columns.flat().map((m) => m.name)).toEqual(['갑', '을'])
    expect(cols.others.map((m) => m.name)).toEqual(['X'])
  })

  it('defaults to the 대학·청년부 blocks when no 부 is given', () => {
    expect(kioskColumns(members).depts.map((d) => d.key)).toEqual(['대학부', '청년부'])
  })

  it('sorts each 부서 bucket 가나다 순 regardless of roster order', () => {
    const unordered = [member('다영', '대학부'), member('가영', '대학부'), member('나영', '대학부')]
    const cols = kioskColumns(unordered)
    expect(cols.depts[0].columns.flat().map((m) => m.name)).toEqual(['가영', '나영', '다영'])
  })

  it('sorts others 가나다 순 too', () => {
    const unordered = [member('나', 'EM'), member('가', 'EM')]
    expect(kioskColumns(unordered).others.map((m) => m.name)).toEqual(['가', '나'])
  })
})

describe('presentNamesToday', () => {
  it('collects distinct names present on the date', () => {
    const entries = [log('A', '2026-06-07'), log('B', '2026-06-07'), log('A', '2026-05-31')]
    const s = presentNamesToday(entries, '2026-06-07')
    expect([...s].sort()).toEqual(['A', 'B'])
  })
})

describe('attendanceCount', () => {
  it('counts unique people for today, including visitors', () => {
    const entries = [
      log('A', '2026-06-07'),
      log('A', '2026-06-07'), // duplicate name → counted once
      log('B', '2026-06-07'),
      log('G', '2026-06-07', 'visitor'), // visitor → included in the head count
      log('C', '2026-05-31'), // other day → excluded
    ]
    expect(attendanceCount(entries, '2026-06-07')).toBe(3)
  })
})

describe('filterByName', () => {
  const members = [member('Anna', '대학부'), member('Bob', '청년부'), member('Chan', '대학부')]
  it('returns all members for an empty query', () => {
    expect(filterByName(members, '   ')).toHaveLength(3)
  })
  it('filters case-insensitively by substring', () => {
    expect(filterByName(members, 'an').map((m) => m.name)).toEqual(['Anna', 'Chan'])
  })
})

describe('todayEntryFor (tap-to-undo lookup)', () => {
  const m = member('A', '대학부')
  it("finds today's entry by member id, ignoring other days", () => {
    const entries = [
      log('A', '2026-06-28', undefined, { id: 1, memberId: 'A' }),
      log('A', '2026-07-05', undefined, { id: 2, memberId: 'A' }),
    ]
    expect(todayEntryFor(entries, '2026-07-05', m)?.id).toBe(2)
  })
  it('falls back to a name match only for rows without a member id', () => {
    const entries = [
      log('A', '2026-07-05', undefined, { id: 3, memberId: 'someone-else' }),
      log('A', '2026-07-05', undefined, { id: 4, memberId: null }),
    ]
    expect(todayEntryFor(entries, '2026-07-05', m)?.id).toBe(4)
  })
  it('returns undefined when the member has no entry today', () => {
    const entries = [log('B', '2026-07-05', undefined, { id: 5, memberId: 'B' })]
    expect(todayEntryFor(entries, '2026-07-05', m)).toBeUndefined()
  })
})

describe('hiddenByStatus (이주/한국 귀국 hidden from the kiosk)', () => {
  const today = '2026-07-05'
  it('hides 한국 귀국 and 이주 while the span covers today (open-ended end)', () => {
    expect(hiddenByStatus(member('A', '대학부', '', { status_note: '한국 귀국', status_start: '2026-06-21', status_end: null }), today)).toBe(true)
    expect(hiddenByStatus(member('B', '대학부', '', { status_note: '이주(방문자)', status_start: '2026-06-21', status_end: '2026-07-19' }), today)).toBe(true)
  })
  it('shows them again outside the span', () => {
    expect(hiddenByStatus(member('A', '대학부', '', { status_note: '한국 귀국', status_start: '2026-07-12', status_end: null }), today)).toBe(false)
    expect(hiddenByStatus(member('B', '대학부', '', { status_note: '이주', status_start: '2026-06-01', status_end: '2026-06-28' }), today)).toBe(false)
  })
  it('never hides other notes (돌아옴) or members without a status', () => {
    expect(hiddenByStatus(member('C', '대학부', '', { status_note: '돌아옴', status_start: '2026-06-07', status_end: '2026-07-12' }), today)).toBe(false)
    expect(hiddenByStatus(member('D', '대학부'), today)).toBe(false)
  })
  it('hides 방학 while the span covers today, but not once it starts later', () => {
    expect(hiddenByStatus(member('F', '대학부', '', { status_note: '방학', status_start: '2026-06-21', status_end: null }), today)).toBe(true)
    expect(hiddenByStatus(member('G', '대학부', '', { status_note: '여름방학', status_start: '2026-07-12', status_end: null }), today)).toBe(false)
  })
  it('ignores a note without a start date (mirrors the 출석부 rule)', () => {
    expect(hiddenByStatus(member('E', '대학부', '', { status_note: '이주' }), today)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import {
  todayGroupRoster,
  todaySheetSlots,
  todaySheetFilename,
  TODAY_SHEET_SLOTS,
  TODAY_SHEET_ROWS,
  type TodayRosterEntry,
} from './todaySheet'
import type { LogEntry } from '../../../lib/api'

const entry = (name: string, group: string, ts: number, date = '2026-06-21', extra: Partial<LogEntry> = {}): LogEntry => ({
  name, group, subgroup: '', date, time: '01:00:00 PM', ts, ...extra,
})
const e = (name: string, tag: TodayRosterEntry['tag'] = null): TodayRosterEntry => ({ name, tag })

describe('todayGroupRoster', () => {
  const today = '2026-06-21'
  const log = [
    entry('B', '대학부', 30),
    entry('A', '대학부', 10),
    entry('Y', '청년부', 20),
    entry('A', '대학부', 50), // duplicate — keeps the earlier slot
    entry('C', '대학부', 40),
    entry('Old', '대학부', 5, '2026-06-14'), // a different date — excluded
  ]
  const noNew = new Set<string>()

  it('returns today’s entries for the group in check-in order, deduped', () => {
    expect(todayGroupRoster(log, today, '대학부', noNew)).toEqual([e('A'), e('B'), e('C')])
    expect(todayGroupRoster(log, today, '청년부', noNew)).toEqual([e('Y')])
  })

  it('excludes other dates and other groups, and ignores blank names', () => {
    const withBlank = [...log, entry('', '대학부', 60)]
    expect(todayGroupRoster(withBlank, today, '대학부', noNew)).toEqual([e('A'), e('B'), e('C')])
    expect(todayGroupRoster(log, '2026-06-14', '대학부', noNew)).toEqual([e('Old')])
  })

  it('tags 방문자 by role and 새가족 by the new-member set (그날 등록한 사람만 전달된다)', () => {
    const lg = [
      entry('회원', '대학부', 10),
      entry('오늘등록', '대학부', 20),
      entry('지난주등록', '대학부', 25), // a 새가족, but not registered today → not in the set
      entry('방문이', '대학부', 30, today, { memberRole: 'guest' }),
      entry('손님', '대학부', 40, today, { memberRole: 'visitor' }),
    ]
    expect(todayGroupRoster(lg, today, '대학부', new Set(['오늘등록']))).toEqual([
      e('회원', null),
      e('오늘등록', 'newFamily'),
      e('지난주등록', null),
      e('방문이', 'visitor'),
      e('손님', 'visitor'),
    ])
  })

  it('lets the visitor role win even if the name is also in the new-member set', () => {
    const lg = [entry('겹침', '대학부', 10, today, { memberRole: 'visitor' })]
    expect(todayGroupRoster(lg, today, '대학부', new Set(['겹침']))).toEqual([e('겹침', 'visitor')])
  })
})

describe('todaySheetSlots', () => {
  it('always produces 60 numbered slots filled column-major, carrying tags', () => {
    const slots = todaySheetSlots([e('A'), e('B', 'newFamily'), e('C', 'visitor')])
    expect(slots).toHaveLength(TODAY_SHEET_SLOTS)
    expect(slots[0]).toEqual({ num: 1, name: 'A', tag: null })
    expect(slots[1]).toEqual({ num: 2, name: 'B', tag: 'newFamily' })
    expect(slots[2]).toEqual({ num: 3, name: 'C', tag: 'visitor' })
    expect(slots[3]).toEqual({ num: 4, name: '', tag: null }) // empty beyond the roster
    expect(slots[TODAY_SHEET_SLOTS - 1]).toEqual({ num: 60, name: '', tag: null })
  })

  it('caps at 60 even with an overflowing roster (extras simply do not show)', () => {
    const many = Array.from({ length: 70 }, (_, i) => e(`M${i + 1}`))
    const slots = todaySheetSlots(many)
    expect(slots).toHaveLength(TODAY_SHEET_SLOTS)
    expect(slots[TODAY_SHEET_SLOTS - 1]).toEqual({ num: 60, name: 'M60', tag: null })
  })

  it('lays out as 4 columns of 15', () => {
    expect(TODAY_SHEET_ROWS).toBe(15)
    expect(TODAY_SHEET_SLOTS / TODAY_SHEET_ROWS).toBe(4)
  })
})

describe('todaySheetFilename', () => {
  it('builds kccp-today-{group}-{date}.{ext}', () => {
    expect(todaySheetFilename('대학부', '2026-06-21', 'png')).toBe('kccp-today-대학부-2026-06-21.png')
    expect(todaySheetFilename('청년부', '2026-06-21', 'jpg')).toBe('kccp-today-청년부-2026-06-21.jpg')
  })
  it('strips whitespace and omits an empty group', () => {
    expect(todaySheetFilename(' Adult Ministry ', '2026-06-21', 'png')).toBe('kccp-today-AdultMinistry-2026-06-21.png')
    expect(todaySheetFilename('', '2026-06-21', 'png')).toBe('kccp-today-2026-06-21.png')
  })
})

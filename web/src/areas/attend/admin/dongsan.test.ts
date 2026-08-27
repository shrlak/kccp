import { describe, it, expect } from 'vitest'
import {
  renameAt,
  addDongsan,
  removeAt,
  cleanNames,
  getDongsanRole,
  orderByDongsanRole,
  leaderEntry,
  summerDongsanList,
  membersInDongsan,
  leaderOptions,
  pickerHits,
  withLeader,
  setSubLeaderAt,
} from './dongsan'
import type { DongsanNames, DongsanLeaders, Member } from '../../../lib/api'

const base: DongsanNames = {
  대학부: ['동산1', '동산2'],
  청년부: ['건영동산'],
}

describe('dongsan name-map helpers (immutable)', () => {
  it('renameAt replaces one entry without mutating the input', () => {
    const next = renameAt(base, '대학부', 1, '새동산')
    expect(next.대학부).toEqual(['동산1', '새동산'])
    expect(next.청년부).toBe(base.청년부) // untouched group keeps identity
    expect(base.대학부).toEqual(['동산1', '동산2']) // original unchanged
    expect(next).not.toBe(base)
    expect(next.대학부).not.toBe(base.대학부)
  })

  it('renameAt is a no-op for out-of-range / unknown', () => {
    expect(renameAt(base, '대학부', 9, 'x')).toBe(base)
    expect(renameAt(base, '대학부', -1, 'x')).toBe(base)
    expect(renameAt(base, '없는부서', 0, 'x')).toBe(base)
  })

  it('addDongsan appends an empty slot', () => {
    const next = addDongsan(base, '청년부')
    expect(next.청년부).toEqual(['건영동산', ''])
    expect(base.청년부).toEqual(['건영동산'])
  })

  it('addDongsan creates the group when absent', () => {
    const next = addDongsan(base, 'EM')
    expect(next.EM).toEqual([''])
  })

  it('removeAt drops one entry immutably', () => {
    const next = removeAt(base, '대학부', 0)
    expect(next.대학부).toEqual(['동산2'])
    expect(base.대학부).toEqual(['동산1', '동산2'])
  })

  it('removeAt is a no-op for out-of-range / unknown', () => {
    expect(removeAt(base, '대학부', 9)).toBe(base)
    expect(removeAt(base, '없는부서', 0)).toBe(base)
  })

  it('cleanNames trims and drops blanks', () => {
    const messy: DongsanNames = { 대학부: ['  동산1 ', '', '   ', '동산2'] }
    expect(cleanNames(messy)).toEqual({ 대학부: ['동산1', '동산2'] })
  })
})

const leaders: DongsanLeaders = {
  청년부: {
    건영동산: { leader: '최건영', subLeaders: ['권상운'] },
    호연동산: { leader: '', subLeaders: ['신주원'] },
  },
  대학부: {
    호연동산: { leader: '김호연', subLeaders: [] },
  },
  합동: {
    호연동산: { leader: '김호연', subLeaders: ['신주원'] },
  },
}

describe('getDongsanRole (display badge lookup)', () => {
  it('returns 동산지기 for the leader of their 동산', () => {
    expect(getDongsanRole('최건영', '청년부', '건영동산', leaders, false)).toBe('동산지기')
    expect(getDongsanRole('김호연', '대학부', '호연동산', leaders, false)).toBe('동산지기')
  })

  it('returns 부동산지기 for a sub-leader', () => {
    expect(getDongsanRole('권상운', '청년부', '건영동산', leaders, false)).toBe('부동산지기')
  })

  it('returns null for an ordinary member, missing 동산, or absent leaders', () => {
    expect(getDongsanRole('아무개', '청년부', '건영동산', leaders, false)).toBeNull()
    expect(getDongsanRole('최건영', '청년부', '없는동산', leaders, false)).toBeNull()
    expect(getDongsanRole('최건영', '', '건영동산', leaders, false)).toBeNull()
    expect(getDongsanRole('최건영', '청년부', '', leaders, false)).toBeNull()
    expect(getDongsanRole('최건영', '청년부', '건영동산', undefined, false)).toBeNull()
  })

  it('uses the 합동 key in summer mode when present', () => {
    expect(getDongsanRole('김호연', '대학부', '호연동산', leaders, true)).toBe('동산지기')
    expect(getDongsanRole('신주원', '청년부', '호연동산', leaders, true)).toBe('부동산지기')
    // present 합동 entry that doesn't match → null (does NOT fall through to group lookup)
    expect(getDongsanRole('최건영', '청년부', '호연동산', leaders, true)).toBeNull()
  })

  it('falls through to the per-group lookup in summer mode when no 합동 entry exists', () => {
    expect(getDongsanRole('최건영', '청년부', '건영동산', leaders, true)).toBe('동산지기')
  })
})

describe('orderByDongsanRole (출석부 row ordering)', () => {
  const m = (id: string, name: string, group: string, subgroup: string) =>
    ({ id, name, group_name: group, subgroup }) as Member
  // Real resolver over the shared leaders fixture: 건영동산 → 최건영/권상운, 호연동산 → −/신주원.
  const roleOf = (name: string, group: string, subgroup: string) =>
    getDongsanRole(name, group, subgroup, leaders, false)

  it('hoists 동산지기 then 부동산지기 within their own 동산 block', () => {
    const input = [
      m('1', '아무개', '청년부', '건영동산'),
      m('2', '권상운', '청년부', '건영동산'),
      m('3', '홍길동', '청년부', '건영동산'),
      m('4', '최건영', '청년부', '건영동산'),
    ]
    expect(orderByDongsanRole(input, roleOf).map((x) => x.name)).toEqual(['최건영', '권상운', '아무개', '홍길동'])
  })

  it('never reorders members across 동산 blocks — titles hoist inside their own block only', () => {
    const input = [
      m('1', '아무개', '청년부', '건영동산'),
      m('2', '둘리', '청년부', '호연동산'),
      m('3', '최건영', '청년부', '건영동산'),
      m('4', '김호연', '청년부', '건영동산'), // 호연동산's leader → untitled here, no hoist
      m('5', '신주원', '청년부', '호연동산'),
    ]
    // 건영동산 (first-seen) block stays ahead of 호연동산 even though its 동산지기 appears
    // late in the roster; 최건영 hoists only within 건영동산, 신주원 (부동산지기) only within
    // 호연동산.
    expect(orderByDongsanRole(input, roleOf).map((x) => x.name)).toEqual(['최건영', '아무개', '김호연', '신주원', '둘리'])
  })

  it('keeps untitled members in stable roster order', () => {
    const input = [
      m('1', '가', '청년부', '건영동산'),
      m('2', '나', '청년부', '건영동산'),
      m('3', '다', '청년부', '건영동산'),
    ]
    expect(orderByDongsanRole(input, roleOf).map((x) => x.name)).toEqual(['가', '나', '다'])
  })

  it('returns empty input and role-less rosters in original order', () => {
    expect(orderByDongsanRole([], roleOf)).toEqual([])
    const input = [m('1', '가', '대학부', '동산1'), m('2', '나', '대학부', '동산1'), m('3', '다', '대학부', '동산2')]
    expect(orderByDongsanRole(input, () => null).map((x) => x.name)).toEqual(['가', '나', '다'])
  })
})

describe('동산-leader editor helpers', () => {
  it('leaderEntry returns the stored entry or an empty default', () => {
    expect(leaderEntry(leaders, '청년부', '건영동산')).toEqual({ leader: '최건영', subLeaders: ['권상운'] })
    expect(leaderEntry(leaders, '청년부', '없는동산')).toEqual({ leader: '', subLeaders: [] })
    expect(leaderEntry(leaders, '없는부서', '건영동산')).toEqual({ leader: '', subLeaders: [] })
  })

  it('summerDongsanList de-dupes 동산 names across groups in order', () => {
    const names: DongsanNames = { 대학부: ['건영동산', '호연동산'], 청년부: ['건영동산', '윤서동산'] }
    expect(summerDongsanList(names)).toEqual(['건영동산', '호연동산', '윤서동산'])
  })

  it('withLeader / setSubLeaderAt edit immutably', () => {
    const base = { leader: '최건영', subLeaders: ['권상운'] }
    const renamed = withLeader(base, '김대균')
    expect(renamed).toEqual({ leader: '김대균', subLeaders: ['권상운'] })
    expect(base.leader).toBe('최건영')

    const second = setSubLeaderAt(base, 1, '김꽃별')
    expect(second.subLeaders).toEqual(['권상운', '김꽃별'])
    expect(base.subLeaders).toEqual(['권상운'])

    const replaced = setSubLeaderAt(second, 0, '김대균')
    expect(replaced.subLeaders).toEqual(['김대균', '김꽃별'])
  })

  it('setSubLeaderAt clears with "" and de-dupes across slots', () => {
    const two = { leader: '', subLeaders: ['권상운', '김꽃별'] }
    expect(setSubLeaderAt(two, 0, '').subLeaders).toEqual(['김꽃별'])
    // picking a name already held by the other slot vacates that slot
    expect(setSubLeaderAt(two, 0, '김꽃별').subLeaders).toEqual(['김꽃별'])
    // setting an empty slot beyond the current list length just appends
    expect(setSubLeaderAt({ leader: '', subLeaders: [] }, 1, '권상운').subLeaders).toEqual(['권상운'])
  })
})

describe('membersInDongsan', () => {
  const members = [
    { id: '1', name: '최건영', group_name: '청년부', subgroup: '건영동산' },
    { id: '2', name: '권상운', group_name: '청년부', subgroup: '건영동산' },
    { id: '3', name: '김서현(대학부)', group_name: '대학부', subgroup: '건영동산' },
    { id: '4', name: '최중호', group_name: '청년부', subgroup: '중호동산' },
  ] as Member[]

  it('filters to one 부서 + 동산, sorted', () => {
    expect(membersInDongsan(members, '청년부', '건영동산')).toEqual(['권상운', '최건영'])
  })

  it('group=null matches the 동산 across all 부서 (summer 합동)', () => {
    expect(membersInDongsan(members, null, '건영동산')).toEqual(['권상운', '김서현(대학부)', '최건영'])
  })

  it('returns [] for an empty 동산', () => {
    expect(membersInDongsan(members, '청년부', '윤서동산')).toEqual([])
  })
})

describe('leaderOptions', () => {
  it('keeps a 지기 who is not in the 동산 selectable', () => {
    // 장년부 이관에서 실제로 나온 경우: 셀 명단은 마나도인데 셀장 표에는 고렌 셀장.
    expect(leaderOptions(['박한영', '한애국'], { leader: '송교철', subLeaders: [] }))
      .toEqual(['박한영', '한애국', '송교철'])
  })

  it('does not duplicate a 지기 who is already in the 동산', () => {
    expect(leaderOptions(['박한영'], { leader: '박한영', subLeaders: ['박한영'] }))
      .toEqual(['박한영'])
  })

  it('is just the member list when no 지기 is set', () => {
    expect(leaderOptions(['가', '나'], { leader: '', subLeaders: [] })).toEqual(['가', '나'])
  })
})

describe('pickerHits — 셀장 고르기 검색', () => {
  const cell = ['신승환', '한지현']
  const all = ['신승환', '한지현', '송교철', '송진아', '고신석']

  it('검색어가 없으면 그 셀 사람만 보여 준다', () => {
    // 삼백 명이 한꺼번에 쏟아지면 정작 그 셀 사람을 고르기가 어려워진다.
    expect(pickerHits('', cell, all)).toEqual({ cell, outside: [] })
  })

  it('치면 부 전체로 넓어지되 셀 사람은 위쪽에 남는다', () => {
    expect(pickerHits('송', cell, all)).toEqual({ cell: [], outside: ['송교철', '송진아'] })
    expect(pickerHits('신', cell, all)).toEqual({ cell: ['신승환'], outside: ['고신석'] })
  })

  it('셀 사람을 아래쪽에 또 보여 주지 않는다', () => {
    const hits = pickerHits('한', cell, all)
    expect(hits.cell).toEqual(['한지현'])
    expect(hits.outside).toEqual([])
  })

  it('대소문자를 가리지 않는다', () => {
    expect(pickerHits('mi', ['Mike Miller'], ['Mike Miller']).cell).toEqual(['Mike Miller'])
  })
})

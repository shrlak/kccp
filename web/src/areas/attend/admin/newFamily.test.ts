import { describe, it, expect } from 'vitest'
import {
  semesterKey,
  semesterBounds,
  semesterSundays,
  transitionBounds,
  transitionSundays,
  visibleNewFamily,
  groupByDate,
  newFamilyBySemester,
  monthlyRegistrations,
  registeredOnDate,
  isActiveNewFamily,
  matchesEduFilter,
  worshipSunday,
  newFamilyWeek,
} from './newFamily'
import type { Member } from '../../../lib/api'
import type { SemesterDates } from '../../../lib/semester'

const m = (id: string, isNew: boolean, reg: string | null): Member => ({
  id, name: id, group_name: '', subgroup: '', member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: isNew, notes: '', registration_date: reg,
})

describe('semesterKey', () => {
  it('maps dates to spring / summer / fall by the legacy bounds', () => {
    expect(semesterKey('2026-01-01')).toBe('2026-spring')
    expect(semesterKey('2026-05-09')).toBe('2026-spring')
    expect(semesterKey('2026-05-10')).toBe('2026-summer')
    expect(semesterKey('2026-08-14')).toBe('2026-summer')
    expect(semesterKey('2026-08-15')).toBe('2026-fall')
    expect(semesterKey('2026-12-31')).toBe('2026-fall')
  })
})

describe('semesterBounds', () => {
  it('returns the term + inclusive start/end for the date', () => {
    expect(semesterBounds('2026-03-01')).toEqual({ year: 2026, season: 'spring', start: '2026-01-01', end: '2026-05-09' })
    expect(semesterBounds('2026-06-07')).toEqual({ year: 2026, season: 'summer', start: '2026-05-10', end: '2026-08-14' })
    expect(semesterBounds('2026-09-01')).toEqual({ year: 2026, season: 'fall', start: '2026-08-15', end: '2026-12-31' })
  })
  it('uses a saved recurring schedule for the requested year', () => {
    const custom: SemesterDates = {
      spring: { start: '01-12', end: '05-02' },
      summer: { start: '05-24', end: '08-02' },
      fall: { start: '08-23', end: '12-13' },
    }
    expect(semesterBounds('2027-06-01', custom)).toEqual({
      year: 2027,
      season: 'summer',
      start: '2027-05-24',
      end: '2027-08-02',
    })
  })
})

describe('semesterSundays', () => {
  it('lists the semester Sundays from the start through today (inclusive)', () => {
    expect(semesterSundays('2026-06-07')).toEqual(['2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31', '2026-06-07'])
  })
  it('excludes future Sundays', () => {
    expect(semesterSundays('2026-05-31')).toEqual(['2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31'])
  })
  it('stops at the last Sunday on/before a mid-week today', () => {
    expect(semesterSundays('2026-06-03')).toEqual(['2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31'])
  })
  it('starts at the first Sunday on/after the semester start (spring 2026 → Jan 4)', () => {
    expect(semesterSundays('2026-01-10')).toEqual(['2026-01-04'])
  })
})

describe('transitionBounds', () => {
  const custom: SemesterDates = {
    spring: { start: '01-12', end: '04-30' },
    summer: { start: '06-01', end: '07-31' },
    fall: { start: '09-01', end: '12-15' },
  }
  it('is null inside a configured term', () => {
    expect(transitionBounds('2026-03-01', custom)).toBeNull()
    expect(transitionBounds('2026-06-15', custom)).toBeNull()
    expect(transitionBounds('2026-10-01', custom)).toBeNull()
  })
  it('is null under the default back-to-back semester dates (no admin-configured gap yet)', () => {
    expect(transitionBounds('2026-05-09')).toBeNull()
    expect(transitionBounds('2026-05-10')).toBeNull()
    expect(transitionBounds('2027-01-01')).toBeNull()
  })
  it('covers the spring -> summer gap', () => {
    expect(transitionBounds('2026-05-15', custom)).toEqual({ start: '2026-05-01', end: '2026-05-31' })
  })
  it('covers the summer -> fall gap', () => {
    expect(transitionBounds('2026-08-15', custom)).toEqual({ start: '2026-08-01', end: '2026-08-31' })
  })
  it('covers the fall -> next spring wraparound gap, on both sides of the new year', () => {
    expect(transitionBounds('2026-12-25', custom)).toEqual({ start: '2026-12-16', end: '2027-01-11' })
    expect(transitionBounds('2027-01-05', custom)).toEqual({ start: '2026-12-16', end: '2027-01-11' })
  })
})

describe('transitionSundays', () => {
  it('lists Sundays within the gap through `through`, clamped to the gap end', () => {
    const bounds = { start: '2026-05-01', end: '2026-05-31' }
    expect(transitionSundays(bounds, '2026-05-20')).toEqual(['2026-05-03', '2026-05-10', '2026-05-17'])
    expect(transitionSundays(bounds, '2026-06-30')).toEqual(['2026-05-03', '2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31'])
  })
})

// Education state on top of the base member factory. 교육 이수는 더 이상 목록에서 사람을
// 내리지 않는다 — 내리는 열쇠는 새가족 표시 해제 하나뿐이다.
const edu = (base: Member, week1: boolean, week2: boolean): Member => ({
  ...base, new_member_edu_week1: week1, new_member_edu_week2: week2,
})

describe('visibleNewFamily', () => {
  const members = [
    m('cur', true, '2026-06-01'), // summer 2026 — this term
    m('noreg', true, null), // no reg date — kept visible
    m('notNew', false, '2026-06-02'), // not flagged — excluded
    edu(m('oldUnfinished', true, '2026-02-01'), true, false), // spring, 1주차만
    edu(m('oldDone', true, '2026-02-02'), true, true), // spring, 교육 완료 — 그래도 남는다
    m('oldNoEdu', true, '2026-02-03'), // spring, 아무것도 안 들음
  ]
  it('keeps every 새가족 with the mark on — this term, undated, and earlier terms alike', () => {
    expect(visibleNewFamily(members).map((x) => x.id).sort())
      .toEqual(['cur', 'noreg', 'oldDone', 'oldNoEdu', 'oldUnfinished'])
  })
  // 떠난 사람은 학기와 무관하게 빠진다. splitRoster는 "오늘을 덮는" 표기만 보므로 이 둘은
  // 그물을 빠져나간다 — 실제 프로덕션 데이터에 있던 두 경우다.
  it('drops a 새가족 whose 이주 has not started yet (다음 주에 떠남)', () => {
    const leaving = { ...m('leaving', true, '2026-06-01'), status_marks: [{ note: '이주', start: '2026-06-20', end: null }] }
    expect(visibleNewFamily([leaving])).toEqual([])
  })
  it('drops a 새가족 whose 귀국 period already ended (기간이 잘못 적힌 경우)', () => {
    const returned = { ...m('returned', true, '2026-06-01'), status_marks: [{ note: '한국 귀국', start: '2026-06-02', end: '2026-06-02' }] }
    expect(visibleNewFamily([returned])).toEqual([])
    // 예전 단일 컬럼으로 적힌 것도 같이 걸러진다.
    const legacy = { ...m('legacy', true, '2026-06-01'), status_note: '이주', status_start: '2026-06-02', status_end: '2026-06-02' }
    expect(visibleNewFamily([legacy])).toEqual([])
  })
  it('keeps a bounded 방학 — 돌아올 날이 정해진 사람은 여전히 새가족이다', () => {
    const onBreak = { ...m('break', true, '2026-06-01'), status_marks: [{ note: '방학', start: '2026-06-02', end: '2026-07-30' }] }
    expect(visibleNewFamily([onBreak]).map((x) => x.id)).toEqual(['break'])
  })
  it('drops anyone registered before 2026 — 옛 시트에서 옮겨온 기록은 목록에 올리지 않는다', () => {
    const old = edu(m('old2025', true, '2025-11-02'), false, false)
    expect(visibleNewFamily([old])).toEqual([])
    // 경계: 2026-01-01은 남는다.
    const boundary = edu(m('newYear', true, '2026-01-01'), false, false)
    expect(visibleNewFamily([boundary]).map((x) => x.id)).toEqual(['newYear'])
  })

  it('drops an earlier term member once the 새가족 표시 comes off, education or not', () => {
    const dropped = { ...edu(m('gone', true, '2026-02-01'), false, false), is_new_member: false }
    expect(visibleNewFamily([dropped])).toEqual([])
  })
  it('keeps this term regardless of education progress', () => {
    const done = edu(m('curDone', true, '2026-06-01'), true, true)
    expect(visibleNewFamily([done]).map((x) => x.id)).toEqual(['curDone'])
  })
  // 이것이 이 목록의 규칙이 된 자리: 지난 학기에 등록하고 두 주를 다 마친 사람도 남는다.
  // 마치는 순간 사라지면 교육 탭에서 '수강 완료'로 걸러도 아무도 안 나온다.
  it('keeps an earlier term member who finished BOTH education weeks', () => {
    const done = edu(m('oldDone', true, '2026-02-02'), true, true)
    expect(visibleNewFamily([done]).map((x) => x.id)).toEqual(['oldDone'])
  })
})

// 실제로 사람이 사라졌던 배치 — 프로덕션의 학기 일정(여름 06-07~08-02, 가을 09-06~12-13)에서
// 8월 16일에 등록한 새가족은 **어느 학기 구간에도 들어 있지 않다** (여름은 이미 끝났고 가을은
// 아직 시작 전이다). 예전 규칙은 그 틈의 등록을 "이번 학기가 아님 → 지난 학기 사람"으로 읽어,
// 교육 두 주를 마치는 순간 두 탭에서 함께 내려버렸다. 김시우·신서윤이 그 경우였다.
describe('학기 사이 틈에 등록한 새가족 (regression)', () => {
  const GAP_CALENDAR: SemesterDates = {
    spring: { start: '01-01', end: '05-09' },
    summer: { start: '06-07', end: '08-02' },
    fall: { start: '09-06', end: '12-13' },
  }
  const educated = (id: string): Member => ({
    ...m(id, true, '2026-08-16'),
    new_member_edu_week1: true,
    new_member_edu_week2: true,
  })

  it('교육을 다 마쳐도 목록에 남고 수강 완료로 걸러진다', () => {
    const list = visibleNewFamily([educated('김시우'), educated('신서윤')])
    expect(list.map((x) => x.id).sort()).toEqual(['김시우', '신서윤'])
    expect(list.filter((x) => matchesEduFilter(x, 'both')).map((x) => x.id).sort()).toEqual(['김시우', '신서윤'])
  })

  it('새가족 탭에서는 자기 등록일 블록에, 이번 학기 묶음 안에 뜬다', () => {
    const groups = newFamilyBySemester([educated('김시우')], '2026-08-24', GAP_CALENDAR)
    expect(groups.map((g) => g.key)).toEqual(['2026-summer'])
    expect(groups[0].current).toBe(true)
    // 학기 구간(…08-02) 밖의 날짜지만 등록일 그대로 자기 블록을 갖는다.
    expect(groups[0].dates.map((g) => g.date)).toEqual(['2026-08-16'])
  })
})

describe('groupByDate', () => {
  it('splits an ordered list into runs of the same 등록일, undated trailing', () => {
    const list = [m('a1', true, '2026-06-07'), m('a2', true, '2026-06-07'), m('b1', true, '2026-05-31'), m('none', true, null)]
    const groups = groupByDate(list)
    expect(groups.map((g) => g.date)).toEqual(['2026-06-07', '2026-05-31', null])
    expect(groups[0].members.map((x) => x.id)).toEqual(['a1', 'a2'])
    expect(groups[2].members.map((x) => x.id)).toEqual(['none'])
  })
  it('returns no groups for an empty list', () => {
    expect(groupByDate([])).toEqual([])
  })
})

describe('newFamilyBySemester', () => {
  it('separates carried-over terms from the current one, current first then newest term', () => {
    const members = [
      m('b1', true, '2026-05-31'), // summer 2026 (current)
      m('a1', true, '2026-06-07'),
      m('a2', true, '2026-06-07'),
      m('none', true, null), // undated — sits in the current term
      edu(m('spring', true, '2026-02-01'), false, true), // spring 2026 — carried over
      edu(m('lastFall', true, '2025-09-01'), true, false), // fall 2025 — 2026년 이전이라 제외
      edu(m('springDone', true, '2026-02-02'), true, true), // 교육 완료 — 그래도 봄학기에 남는다
      m('notNew', false, '2026-06-07'),
    ]
    const groups = newFamilyBySemester(members, '2026-06-08')

    // 2025년 등록은 학기 묶음 자체가 생기지 않는다 (교육을 안 끝냈어도).
    expect(groups.map((g) => g.key)).toEqual(['2026-summer', '2026-spring'])
    expect(groups.map((g) => g.current)).toEqual([true, false])
    expect(groups[0].total).toBe(4)
    expect(groups[0].dates.map((g) => g.date)).toEqual(['2026-06-07', '2026-05-31', null])
    expect(groups[0].dates[0].members.map((x) => x.id)).toEqual(['a1', 'a2'])
    // 봄학기는 등록일 내림차순이라 02-02(이수 완료)가 먼저다.
    expect(groups[1].dates.flatMap((g) => g.members.map((x) => x.id))).toEqual(['springDone', 'spring'])
  })
  it('keeps the current term first even when a registration date lands in a later one', () => {
    const groups = newFamilyBySemester(
      [m('typo', true, '2026-11-30'), m('now', true, '2026-06-01')],
      '2026-06-08',
    )
    expect(groups.map((g) => g.key)).toEqual(['2026-summer', '2026-fall'])
  })
  it('returns no groups when nobody is in scope', () => {
    // 새가족 표시가 없으면 목록에 들어오지 않는다 — 이제 유일하게 사람을 내리는 열쇠다.
    expect(newFamilyBySemester([edu(m('notNew', false, '2026-02-01'), true, true)], '2026-06-08')).toEqual([])
  })
})

describe('registeredOnDate (등록 카드 export set)', () => {
  const members = [
    m('b-today', true, '2026-07-05'),
    m('a-today', true, '2026-07-05'),
    m('yesterday', true, '2026-07-04'),
    m('undated', true, null),
    m('not-new', false, '2026-07-05'), // registered today but not flagged 새가족
  ]
  it('keeps only 새가족 registered exactly on the export date, name-ordered', () => {
    expect(registeredOnDate(members, '2026-07-05').map((x) => x.id)).toEqual(['a-today', 'b-today'])
  })
  it('returns empty when nobody registered that day', () => {
    expect(registeredOnDate(members, '2026-07-06')).toEqual([])
  })
})

describe('isActiveNewFamily', () => {
  it('is false for a non-새가족', () => {
    expect(isActiveNewFamily({ is_new_member: false, new_member_edu_week1: false, new_member_edu_week2: false })).toBe(false)
  })
  it('is true for a 새가족 who has not finished both education weeks', () => {
    expect(isActiveNewFamily({ is_new_member: true, new_member_edu_week1: false, new_member_edu_week2: false })).toBe(true)
    expect(isActiveNewFamily({ is_new_member: true, new_member_edu_week1: true, new_member_edu_week2: false })).toBe(true)
    expect(isActiveNewFamily({ is_new_member: true, new_member_edu_week1: undefined, new_member_edu_week2: undefined })).toBe(true)
  })
  it('is false once both weeks are done, even though is_new_member stays true', () => {
    expect(isActiveNewFamily({ is_new_member: true, new_member_edu_week1: true, new_member_edu_week2: true })).toBe(false)
  })
})

describe('matchesEduFilter', () => {
  const both = { new_member_edu_week1: true, new_member_edu_week2: true }
  const week1 = { new_member_edu_week1: true, new_member_edu_week2: false }
  const week2 = { new_member_edu_week1: false, new_member_edu_week2: true }
  const none = { new_member_edu_week1: false, new_member_edu_week2: false }

  it("'all' matches everyone", () => {
    for (const c of [both, week1, week2, none]) expect(matchesEduFilter(c, 'all')).toBe(true)
  })
  it('the 4 filters partition the 2x2 truth table exactly (no overlap, full coverage)', () => {
    expect(matchesEduFilter(week1, 'week1')).toBe(true)
    expect(matchesEduFilter(week2, 'week1')).toBe(false)
    expect(matchesEduFilter(both, 'week1')).toBe(false)
    expect(matchesEduFilter(none, 'week1')).toBe(false)

    expect(matchesEduFilter(week2, 'week2')).toBe(true)
    expect(matchesEduFilter(week1, 'week2')).toBe(false)
    expect(matchesEduFilter(both, 'week2')).toBe(false)

    expect(matchesEduFilter(both, 'both')).toBe(true)
    expect(matchesEduFilter(week1, 'both')).toBe(false)
    expect(matchesEduFilter(week2, 'both')).toBe(false)

    expect(matchesEduFilter(none, 'none')).toBe(true)
    expect(matchesEduFilter(week1, 'none')).toBe(false)
    expect(matchesEduFilter(both, 'none')).toBe(false)
  })
})

describe('monthlyRegistrations', () => {
  it('groups every dated member by month, newest first', () => {
    const members = [m('a', false, '2026-06-07'), m('b', true, '2026-05-31'), m('c', false, '2026-06-01'), m('d', false, null)]
    const groups = monthlyRegistrations(members)
    expect(groups.map((g) => g.month)).toEqual(['2026-06', '2026-05'])
    expect(groups[0].members.map((x) => x.id)).toEqual(['a', 'c']) // within month, newest first
    expect(groups[1].members.map((x) => x.id)).toEqual(['b'])
  })
  // 탭이 목록에서 뺀 사람이 그 아래 월별 등록에 이름만 남아 있으면 안 된다.
  it('drops the same people the tab drops — 떠난 사람과 2026년 이전 등록', () => {
    const gone = { ...m('gone', true, '2026-06-01'), status_marks: [{ note: '이주', start: '2026-06-21', end: '2026-06-21' }] }
    const old = m('old', true, '2025-11-02')
    const stays = m('stays', true, '2026-06-02')
    expect(monthlyRegistrations([gone, old, stays]).flatMap((g) => g.members.map((x) => x.id))).toEqual(['stays'])
  })
  it('keeps someone who already finished 새가족 교육 — 등록 시점의 기록이다', () => {
    const done = edu(m('done', true, '2026-03-01'), true, true)
    expect(monthlyRegistrations([done]).flatMap((g) => g.members.map((x) => x.id))).toEqual(['done'])
  })
})

describe('worshipSunday', () => {
  it('is the date itself on a Sunday', () => {
    expect(worshipSunday('2026-07-26')).toBe('2026-07-26')
  })
  it('is the most recent Sunday on any other day', () => {
    expect(worshipSunday('2026-07-27')).toBe('2026-07-26') // Monday
    expect(worshipSunday('2026-07-31')).toBe('2026-07-26') // Friday
    expect(worshipSunday('2026-08-01')).toBe('2026-07-26') // Saturday
  })
  it('walks back across a month boundary', () => {
    expect(worshipSunday('2026-08-03')).toBe('2026-08-02')
    expect(worshipSunday('2026-03-02')).toBe('2026-03-01')
  })
})

describe('newFamilyWeek', () => {
  const today = '2026-07-26' // a Sunday
  it('places registrations on the current 주일 in thisWeek', () => {
    expect(newFamilyWeek('2026-07-26', today)).toBe('thisWeek')
  })
  it('places the previous 주일 and its week in lastWeek', () => {
    expect(newFamilyWeek('2026-07-19', today)).toBe('lastWeek')
    expect(newFamilyWeek('2026-07-22', today)).toBe('lastWeek') // mid-week counts with its 주일
    expect(newFamilyWeek('2026-07-25', today)).toBe('lastWeek')
  })
  it('places anything older in earlier', () => {
    expect(newFamilyWeek('2026-07-18', today)).toBe('earlier')
    expect(newFamilyWeek('2026-05-31', today)).toBe('earlier')
  })
  it('keeps the same buckets mid-week (this 주일 = the Sunday just past)', () => {
    expect(newFamilyWeek('2026-07-26', '2026-07-29')).toBe('thisWeek')
    expect(newFamilyWeek('2026-07-19', '2026-07-29')).toBe('lastWeek')
  })
  it('is null without a registration date', () => {
    expect(newFamilyWeek(null, today)).toBeNull()
    expect(newFamilyWeek(undefined, today)).toBeNull()
    expect(newFamilyWeek('', today)).toBeNull()
  })
})

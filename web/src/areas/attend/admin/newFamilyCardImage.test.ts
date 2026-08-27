import { describe, it, expect } from 'vitest'
import { cardModel, cardFilenames, formatCardDate, joinAffiliation, splitAffiliation } from './newFamilyCardImage'
import { DATE_BLANK, groupForAffiliation, type CardCellContent } from './newFamilyCard'
import type { Member } from '../../../lib/api'

const member = (extra: Partial<Member> = {}): Member => ({
  id: 'm1',
  name: '새신자',
  group_name: '대학부',
  subgroup: '동산1',
  member_role: '',
  gender: '여',
  phone: '412-555-0101',
  birth_date: '2004-03-01',
  kakao_id: 'saeshinja',
  is_new_member: true,
  notes: '',
  registration_date: '2026-07-05',
  baptism_status: '유아세례',
  school_or_work: '대학생 · Pitt 컴퓨터공학',
  faith_duration: '1-3년',
  pastoral_visit_requested: true,
  ...extra,
})

// Handles into the model: flatten [left,right] cells and index by label.
const cellsByLabel = (m: Member): Record<string, CardCellContent> => {
  const model = cardModel(m)
  return Object.fromEntries(model.rows.flatMap((r) => [r.left, r.right]).map((c) => [c.label, c.content]))
}
const optionsOf = (content: CardCellContent) => (content.kind === 'checks' ? content.options : [])
const checkedOf = (content: CardCellContent) =>
  optionsOf(content)
    .filter((o) => o.checked)
    .map((o) => o.label)

describe('joinAffiliation / splitAffiliation (소속 stored inside school_or_work)', () => {
  it('joins category + detail with " · "', () => {
    expect(joinAffiliation('대학생', 'Pitt 컴퓨터공학')).toBe('대학생 · Pitt 컴퓨터공학')
  })

  it('drops the separator when either side is blank', () => {
    expect(joinAffiliation('', 'Pitt')).toBe('Pitt')
    expect(joinAffiliation('직장인', '')).toBe('직장인')
    expect(joinAffiliation('', '')).toBe('')
    expect(joinAffiliation(' 대학원생 ', '  CMU  ')).toBe('대학원생 · CMU')
  })

  it('splits a known-category prefix back out', () => {
    expect(splitAffiliation('대학생 · Pitt 컴퓨터공학')).toEqual({ category: '대학생', detail: 'Pitt 컴퓨터공학' })
    expect(splitAffiliation('Other · Google')).toEqual({ category: 'Other', detail: 'Google' })
  })

  it('recognizes a bare category (no detail) for round-trip symmetry', () => {
    expect(splitAffiliation('직장인')).toEqual({ category: '직장인', detail: '' })
    expect(splitAffiliation(joinAffiliation('대학원생', ''))).toEqual({ category: '대학원생', detail: '' })
  })

  it('treats unprefixed text as Other with the whole string as detail', () => {
    expect(splitAffiliation('Google 소프트웨어 엔지니어')).toEqual({ category: 'Other', detail: 'Google 소프트웨어 엔지니어' })
  })

  it('maps empty to empty (no category, no detail)', () => {
    expect(splitAffiliation('')).toEqual({ category: '', detail: '' })
    expect(splitAffiliation('   ')).toEqual({ category: '', detail: '' })
  })
})

describe('groupForAffiliation (소속 → 부서 at kiosk registration)', () => {
  it('files 대학생 under 대학부', () => {
    expect(groupForAffiliation('대학생')).toBe('대학부')
    expect(groupForAffiliation(' 대학생 ')).toBe('대학부')
  })

  it('files every other category under 청년부', () => {
    expect(groupForAffiliation('대학원생')).toBe('청년부')
    expect(groupForAffiliation('직장인')).toBe('청년부')
    expect(groupForAffiliation('Other')).toBe('청년부')
  })
})

describe('formatCardDate (ISO → the card\'s MM / DD / YYYY)', () => {
  it('formats an ISO date', () => {
    expect(formatCardDate('2004-03-01')).toBe('03 / 01 / 2004')
    expect(formatCardDate('2026-07-05')).toBe('07 / 05 / 2026')
  })

  it('keeps the paper card\'s underscore blanks for missing/invalid dates', () => {
    expect(formatCardDate(null)).toBe(DATE_BLANK)
    expect(formatCardDate(undefined)).toBe(DATE_BLANK)
    expect(formatCardDate('')).toBe(DATE_BLANK)
    expect(formatCardDate('저번주')).toBe(DATE_BLANK)
  })
})

describe('cardModel (새가족 등록 카드, paper layout)', () => {
  it('lays out the paper card\'s five label|value|label|value rows in order', () => {
    const model = cardModel(member())
    expect(model.title).toBe('< KCCP 빛주사랑 대학청년부 - 새가족 등록 카드 >')
    expect(model.rows.map((r) => [r.left.label, r.right.label])).toEqual([
      ['이름', '전화번호'],
      ['생년월일', '카톡 아이디'],
      ['소속 (학교/직장)', '세례 여부'],
      ['학교/전공 or 직장', '신앙생활'],
      ['등록일', '목사님 심방 요청'],
    ])
  })

  it('fills the plain-value cells from the member row', () => {
    const cells = cellsByLabel(member())
    expect(cells['전화번호']).toEqual({ kind: 'text', text: '412-555-0101' })
    expect(cells['카톡 아이디']).toEqual({ kind: 'text', text: 'saeshinja' })
    expect(cells['생년월일']).toEqual({ kind: 'text', text: '03 / 01 / 2004' })
    expect(cells['등록일']).toEqual({ kind: 'text', text: '07 / 05 / 2026' })
  })

  it('renders missing dates as the underscore blanks', () => {
    const cells = cellsByLabel(member({ birth_date: null, registration_date: null }))
    expect(cells['생년월일']).toEqual({ kind: 'text', text: DATE_BLANK })
    expect(cells['등록일']).toEqual({ kind: 'text', text: DATE_BLANK })
  })

  it('circles the gender in the 이름 cell (남/여 recognized inside free text; none otherwise)', () => {
    expect(cellsByLabel(member())['이름']).toEqual({ kind: 'name', name: '새신자', circled: '여' })
    expect(cellsByLabel(member({ gender: '남자' }))['이름']).toMatchObject({ circled: '남' })
    expect(cellsByLabel(member({ gender: '' }))['이름']).toMatchObject({ circled: null })
    expect(cellsByLabel(member({ gender: 'nonbinary' }))['이름']).toMatchObject({ circled: null })
  })

  it('checks the 소속 category box and puts the detail in the 학교/전공 or 직장 row', () => {
    const cells = cellsByLabel(member()) // 대학생 · Pitt 컴퓨터공학
    expect(checkedOf(cells['소속 (학교/직장)'])).toEqual(['대학생'])
    expect(cells['소속 (학교/직장)']).toMatchObject({ extra: '' })
    expect(cells['학교/전공 or 직장']).toEqual({ kind: 'text', text: 'Pitt 컴퓨터공학' })
  })

  it('checks Other: (with the text after it) for an unprefixed 소속', () => {
    const cells = cellsByLabel(member({ school_or_work: 'Google 엔지니어' }))
    expect(checkedOf(cells['소속 (학교/직장)'])).toEqual(['Other:'])
    expect(cells['소속 (학교/직장)']).toMatchObject({ extra: 'Google 엔지니어' })
    expect(cells['학교/전공 or 직장']).toEqual({ kind: 'text', text: 'Google 엔지니어' })
  })

  it('checks no 소속 box when school_or_work is empty', () => {
    const cells = cellsByLabel(member({ school_or_work: '' }))
    expect(checkedOf(cells['소속 (학교/직장)'])).toEqual([])
    expect(cells['학교/전공 or 직장']).toEqual({ kind: 'text', text: '' })
  })

  it('checks the matching 세례 여부 box (Korean labels with English captions)', () => {
    const cells = cellsByLabel(member()) // 유아세례
    expect(optionsOf(cells['세례 여부']).map((o) => `${o.label} ${o.caption}`)).toEqual([
      '유아세례 Infant Baptism',
      '입교 Confirmation',
      '세례 Baptism',
      '해당없음 N/A',
    ])
    expect(checkedOf(cells['세례 여부'])).toEqual(['유아세례'])
    expect(checkedOf(cellsByLabel(member({ baptism_status: '몰라요' }))['세례 여부'])).toEqual([])
  })

  it('checks the matching 신앙생활 box', () => {
    const cells = cellsByLabel(member()) // 1-3년
    expect(optionsOf(cells['신앙생활']).map((o) => o.label)).toEqual(['모태신앙', '1년 미만', '1-3년', '3-5년', '5년 이상'])
    expect(checkedOf(cells['신앙생활'])).toEqual(['1-3년'])
    expect(checkedOf(cellsByLabel(member({ faith_duration: '' }))['신앙생활'])).toEqual([])
  })

  it('checks 심방 요청 O when requested, X otherwise', () => {
    expect(checkedOf(cellsByLabel(member())['목사님 심방 요청'])).toEqual(['O'])
    expect(checkedOf(cellsByLabel(member({ pastoral_visit_requested: false }))['목사님 심방 요청'])).toEqual(['X'])
  })
})

describe('cardFilenames (per-person JPG names)', () => {
  const named = (name: string) => ({ name })

  it('names each file 새가족등록카드-날짜-이름.jpg', () => {
    expect(cardFilenames([named('새신자'), named('김민준')], '2026-07-05')).toEqual([
      '새가족등록카드-2026-07-05-새신자.jpg',
      '새가족등록카드-2026-07-05-김민준.jpg',
    ])
  })

  it('suffixes duplicate names so downloads never overwrite each other', () => {
    expect(cardFilenames([named('김민준'), named('김민준'), named('김민준')], '2026-07-05')).toEqual([
      '새가족등록카드-2026-07-05-김민준.jpg',
      '새가족등록카드-2026-07-05-김민준-2.jpg',
      '새가족등록카드-2026-07-05-김민준-3.jpg',
    ])
  })

  it('sanitizes filesystem-hostile characters and falls back to the position for empty names', () => {
    expect(cardFilenames([named('a/b:c?'), named('')], '2026-07-05')).toEqual([
      '새가족등록카드-2026-07-05-abc.jpg',
      '새가족등록카드-2026-07-05-2.jpg',
    ])
  })
})

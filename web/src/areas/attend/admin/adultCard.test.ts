import { describe, it, expect } from 'vitest'
import { FAMILY_ROWS, adultCardFromMember, birthRaw, blankAdultCard, isoDateOrNull, packFamily } from './adultCard'
import type { Member } from '../../../lib/api'

const member = (extra: Partial<Member> = {}): Member =>
  ({
    id: '1',
    name: '홍민수',
    group_name: '장년부',
    subgroup: '마나도',
    member_role: '',
    gender: '',
    phone: '4434871383',
    birth_date: '1964-02-27',
    kakao_id: '',
    is_new_member: false,
    notes: '',
    ...extra,
  }) as Member

describe('장년부 카드 씨앗', () => {
  it('카드 칸이 비어 있어도 다섯 줄을 그린다', () => {
    expect(adultCardFromMember(member()).family).toHaveLength(FAMILY_ROWS)
    expect(blankAdultCard('2026-08-10').family).toHaveLength(FAMILY_ROWS)
  })

  it('저장된 동행가족을 읽고 모자란 줄만 채운다', () => {
    const card = adultCardFromMember(
      member({ family: [{ nameKo: '유은', nameEn: '', relation: '자녀', birthDate: '', gender: '', baptism: '' }] }),
    )
    expect(card.family).toHaveLength(FAMILY_ROWS)
    expect(card.family[0].nameKo).toBe('유은')
    expect(card.family[1].nameKo).toBe('')
  })

  it('다섯 줄보다 많이 적혀 있으면 지우지 않는다', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ nameKo: `아이${i}`, nameEn: '', relation: '자녀', birthDate: '', gender: '', baptism: '' }))
    expect(adultCardFromMember(member({ family: six })).family).toHaveLength(6)
  })

  it('전화번호는 카드에 보기 좋은 꼴로 올라온다', () => {
    expect(adultCardFromMember(member()).phone).toBe('(443) 487-1383')
  })

  it('저장 직전 packFamily가 이름 없는 빈 줄만 걷어낸다', () => {
    const rows = [
      { nameKo: '유은', nameEn: '', relation: '자녀', birthDate: '', gender: '', baptism: '' },
      { nameKo: '', nameEn: 'Grace', relation: '', birthDate: '', gender: '', baptism: '세례' },
      { nameKo: '', nameEn: '', relation: '자녀', birthDate: '', gender: '', baptism: '' },
      { nameKo: '', nameEn: '', relation: '', birthDate: '', gender: '', baptism: '' },
    ]
    expect(packFamily(rows).map((r) => r.nameKo || r.nameEn)).toEqual(['유은', 'Grace'])
  })

  it('대학·청년부 멤버를 넣어도 터지지 않는다 — 카드 칸이 없을 뿐', () => {
    const card = adultCardFromMember(member({ group_name: '청년부', family: undefined }))
    expect(card.nameEn).toBe('')
    expect(card.address).toBe('')
    expect(card.family).toHaveLength(FAMILY_ROWS)
  })
})

describe('덜 찬 생년월일 — 년만 적어도 남는다', () => {
  it('덜 찬 값은 날짜가 아니다', () => {
    // 실제 카드에 "2006"만 적혀 오는 경우가 있다. birth_date는 날짜 칸이라 담을 수 없다.
    expect(isoDateOrNull('2006--')).toBeNull()
    expect(isoDateOrNull('2006-10-')).toBeNull()
    expect(isoDateOrNull('')).toBeNull()
  })

  it('세 칸이 다 차면 날짜가 된다', () => {
    expect(isoDateOrNull('2006-10-24')).toBe('2006-10-24')
  })

  it('덜 찬 값은 적힌 그대로 남는다 — 1월 1일로 채우지 않는다', () => {
    expect(birthRaw('2006--')).toBe('2006')
    expect(birthRaw('2006-10-')).toBe('2006-10')
    expect(birthRaw('2006--24')).toBe('2006') // 중간이 비면 거기서 끊는다
    expect(birthRaw('')).toBe('')
  })

  it('완전한 날짜일 때는 원문 칸을 비운다 — 두 칸이 어긋날 자리를 만들지 않는다', () => {
    expect(birthRaw('2006-10-24')).toBe('')
  })

  it('년만 저장된 멤버를 다시 열면 그 년이 칸에 돌아온다', () => {
    const card = adultCardFromMember(member({ birth_date: null, birth_date_raw: '2006' }))
    expect(card.birthDate).toBe('2006')
  })
})

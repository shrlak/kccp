import { describe, it, expect } from 'vitest'
import {
  normalizeCardDate,
  normalizePhone,
  normalizeExtractedCard,
  normalizeExtractedCards,
  extractedCardKind,
  normalizeExtractedAdultCard,
  normalizeScannedCards,
} from './cardExtraction'
import { FAMILY_ROWS } from './adultCard'
import { blankCardForm } from './newFamilyCard'

const TODAY = '2026-07-06'

describe('normalizeCardDate', () => {
  it('accepts ISO dates as-is', () => {
    expect(normalizeCardDate('2004-03-15', 'birth', 2026)).toBe('2004-03-15')
  })
  it("parses the card's MM/DD/YYYY order, with dots/spaces too", () => {
    expect(normalizeCardDate('03/15/2004', 'birth', 2026)).toBe('2004-03-15')
    expect(normalizeCardDate('03 / 15 / 2004', 'birth', 2026)).toBe('2004-03-15')
    expect(normalizeCardDate('03.15.2004', 'birth', 2026)).toBe('2004-03-15')
    expect(normalizeCardDate('3/5/2004', 'birth', 2026)).toBe('2004-03-05')
  })
  it('pivots 2-digit birth years: future 20xx → 19xx', () => {
    expect(normalizeCardDate('3/15/04', 'birth', 2026)).toBe('2004-03-15') // 2004 ≤ 2026
    expect(normalizeCardDate('3/15/98', 'birth', 2026)).toBe('1998-03-15') // 2098 > 2026
    expect(normalizeCardDate('3/15/26', 'birth', 2026)).toBe('2026-03-15') // boundary: not future
  })
  it('reads 2-digit registration years as 20xx', () => {
    expect(normalizeCardDate('7/6/26', 'registration', 2026)).toBe('2026-07-06')
    expect(normalizeCardDate('12/31/98', 'registration', 2026)).toBe('2098-12-31')
  })
  it('rejects garbage, wrong group counts, and impossible dates', () => {
    expect(normalizeCardDate('', 'birth')).toBe('')
    expect(normalizeCardDate(null, 'birth')).toBe('')
    expect(normalizeCardDate(42, 'birth')).toBe('')
    expect(normalizeCardDate('없음', 'birth')).toBe('')
    expect(normalizeCardDate('03/2004', 'birth')).toBe('')
    expect(normalizeCardDate('1/2/3/4', 'birth')).toBe('')
    expect(normalizeCardDate('13/01/2004', 'birth')).toBe('') // month 13
    expect(normalizeCardDate('02/30/2004', 'birth')).toBe('') // Feb 30
    expect(normalizeCardDate('03/15/1850', 'birth')).toBe('') // implausible year
    expect(normalizeCardDate('3/15/004', 'birth')).toBe('') // 3-digit year
  })
})

describe('normalizePhone', () => {
  it('formats 10-digit US numbers', () => {
    expect(normalizePhone('4125551234')).toBe('(412) 555-1234')
    expect(normalizePhone('(412) 555-1234')).toBe('(412) 555-1234')
  })
  it('formats 11-digit 010 Korean mobiles', () => {
    expect(normalizePhone('01012345678')).toBe('010-1234-5678')
    expect(normalizePhone('010 1234 5678')).toBe('010-1234-5678')
  })
  it('passes anything else through as written', () => {
    expect(normalizePhone('  +82 10 1234 5678 ')).toBe('+82 10 1234 5678')
    expect(normalizePhone('연락처 없음')).toBe('연락처 없음')
    expect(normalizePhone(null)).toBe('')
    expect(normalizePhone(12345)).toBe('')
  })
})

describe('normalizeExtractedCard', () => {
  it('normalizes a full well-formed extraction', () => {
    const card = normalizeExtractedCard(
      {
        name: ' 김철수 ',
        gender: '남',
        phone: '4125551234',
        kakaoId: 'chulsoo',
        birthDate: '03/15/2004',
        affiliationCategory: '대학생',
        affiliationDetail: 'Pitt 컴퓨터공학',
        baptismStatus: '세례',
        faithDuration: '1-3년',
        registrationDate: '2026-07-05',
        pastoralVisitRequested: true,
      },
      TODAY,
    )
    expect(card).toEqual({
      name: '김철수',
      gender: '남',
      phone: '(412) 555-1234',
      kakaoId: 'chulsoo',
      birthDate: '2004-03-15',
      affiliationCategory: '대학생',
      affiliationDetail: 'Pitt 컴퓨터공학',
      baptismStatus: '세례',
      faithDuration: '1-3년',
      registrationDate: '2026-07-05',
      pastoralVisitRequested: true,
    })
  })
  it('clamps out-of-vocabulary enums to blank', () => {
    const card = normalizeExtractedCard(
      { gender: 'M', affiliationCategory: '학생', baptismStatus: '세례받음', faithDuration: '오래' },
      TODAY,
    )
    expect(card.gender).toBe('')
    expect(card.affiliationCategory).toBe('')
    expect(card.baptismStatus).toBe('')
    expect(card.faithDuration).toBe('')
  })
  it('keeps valid enum values, trimming whitespace', () => {
    const card = normalizeExtractedCard(
      { gender: ' 여 ', affiliationCategory: 'Other', baptismStatus: '해당없음', faithDuration: '모태신앙' },
      TODAY,
    )
    expect(card.gender).toBe('여')
    expect(card.affiliationCategory).toBe('Other')
    expect(card.baptismStatus).toBe('해당없음')
    expect(card.faithDuration).toBe('모태신앙')
  })
  it('falls back to today for a missing/invalid 등록일 and blank for null 심방', () => {
    const card = normalizeExtractedCard({ registrationDate: null, pastoralVisitRequested: null }, TODAY)
    expect(card.registrationDate).toBe(TODAY)
    expect(card.pastoralVisitRequested).toBe(null)
  })
  it('all-null payload ≙ blank card; non-object payloads too', () => {
    const nulls = Object.fromEntries(
      ['name', 'gender', 'phone', 'kakaoId', 'birthDate', 'affiliationCategory', 'affiliationDetail', 'baptismStatus', 'faithDuration', 'registrationDate', 'pastoralVisitRequested'].map((k) => [k, null]),
    )
    expect(normalizeExtractedCard(nulls, TODAY)).toEqual(blankCardForm(TODAY))
    expect(normalizeExtractedCard(null, TODAY)).toEqual(blankCardForm(TODAY))
    expect(normalizeExtractedCard('x', TODAY)).toEqual(blankCardForm(TODAY))
    expect(normalizeExtractedCard([1], TODAY)).toEqual(blankCardForm(TODAY))
  })
})

describe('normalizeExtractedCards', () => {
  it('keeps every card a photo contained, in order', () => {
    const cards = normalizeExtractedCards(
      [
        { name: '김철수', gender: '남' },
        { name: '이영희', gender: '여' },
        { name: '박민수' },
      ],
      TODAY,
    )
    expect(cards.map((c) => c.name)).toEqual(['김철수', '이영희', '박민수'])
    expect(cards[1].gender).toBe('여')
  })
  it('accepts a single object (older response shape) as a one-card list', () => {
    const cards = normalizeExtractedCards({ name: '김철수' }, TODAY)
    expect(cards).toHaveLength(1)
    expect(cards[0].name).toBe('김철수')
  })
  it('drops entries with nothing readable on them', () => {
    const cards = normalizeExtractedCards(
      [{ name: '김철수' }, { name: null, phone: null }, { pastoralVisitRequested: false }],
      TODAY,
    )
    // 등록일 alone doesn't count — it's defaulted onto every card, blank ones included.
    expect(cards.map((c) => c.name)).toEqual(['김철수', ''])
    expect(cards[1].pastoralVisitRequested).toBe(false)
  })
  it('falls back to one blank card when nothing was readable at all', () => {
    expect(normalizeExtractedCards([], TODAY)).toEqual([blankCardForm(TODAY)])
    expect(normalizeExtractedCards([{}, { name: '  ' }], TODAY)).toEqual([blankCardForm(TODAY)])
    expect(normalizeExtractedCards(null, TODAY)).toEqual([blankCardForm(TODAY)])
    expect(normalizeExtractedCards(undefined, TODAY)).toEqual([blankCardForm(TODAY)])
  })
})

describe('장년부 카드 판독', () => {
  const raw = {
    cardType: 'adult',
    name: '박시내',
    nameEn: 'Emma Park',
    gender: '여',
    birthDate: '2006',
    phone: '410-343-9653',
    email: '카톡 번호: 410-999-5704',
    registrationChoice: 'later',
    family: [{ nameKo: '', nameEn: '', relation: '', birthDate: null, gender: null, baptism: null }],
  }

  it('cardType이 어느 종이인지 말한다', () => {
    expect(extractedCardKind(raw)).toBe('adult')
    expect(extractedCardKind({ cardType: 'youth', nameEn: 'x' })).toBe('youth')
  })

  it('cardType이 없으면 장년부에만 있는 칸으로 알아본다', () => {
    expect(extractedCardKind({ name: '가', address: '1 Main St' })).toBe('adult')
    expect(extractedCardKind({ name: '가', kakaoId: 'abc' })).toBe('youth')
  })

  it('년만 적힌 생년월일을 버리지 않는다', () => {
    expect(normalizeExtractedAdultCard(raw, '2026-08-10').birthDate).toBe('2006')
  })

  it('이름 없는 동행가족 줄은 종이의 빈 칸이라 담지 않는다', () => {
    const card = normalizeExtractedAdultCard(raw, '2026-08-10')
    expect(card.family.filter((f) => f.nameKo || f.nameEn)).toHaveLength(0)
    expect(card.family).toHaveLength(FAMILY_ROWS)
  })

  it('장년부 링크에서는 청년부 카드가 와도 장년부로 읽는다', () => {
    const cards = normalizeScannedCards([{ cardType: 'youth', name: '가' }], '2026-08-10', 'adult')
    expect(cards).toHaveLength(1)
    expect(cards[0].kind).toBe('adult')
  })

  it('대학·청년부 링크에서는 두 종이가 섞여 와도 각자로 읽는다', () => {
    const cards = normalizeScannedCards(
      [{ cardType: 'youth', name: '가', kakaoId: 'k' }, raw],
      '2026-08-10',
    )
    expect(cards.map((c) => c.kind)).toEqual(['youth', 'adult'])
  })

  it('아무것도 못 읽어도 빈 카드 한 장은 준다', () => {
    expect(normalizeScannedCards([], '2026-08-10', 'adult')).toEqual([
      { kind: 'adult', adult: expect.objectContaining({ name: '' }) },
    ])
  })
})

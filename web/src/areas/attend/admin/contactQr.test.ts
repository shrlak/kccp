import { describe, it, expect } from 'vitest'
import { toE164, classifyKakaoId, contactCard, kakaoIdList } from './contactQr'
import type { Member } from '../../../lib/api'

const member = (over: Partial<Member> = {}): Member => ({
  id: '1', name: '김서현', group_name: '', subgroup: '', member_role: '', gender: '',
  phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '', ...over,
})

describe('toE164', () => {
  it('formats US 10-digit numbers as the roster stores them', () => {
    // 명단의 전화번호는 lib/phone.ts가 이 모양으로 저장해 둔다.
    expect(toE164('(412) 703-0123')).toBe('+14127030123')
    expect(toE164('4127030123')).toBe('+14127030123')
    expect(toE164('1-412-703-0123')).toBe('+14127030123')
  })
  it('drops the leading 0 on Korean 010 mobiles', () => {
    expect(toE164('010-6577-7896')).toBe('+821065777896')
    expect(toE164('010 3220 9178')).toBe('+821032209178')
  })
  it('trusts a number that already carries its country code', () => {
    expect(toE164('+82 10-2744-1580')).toBe('+821027441580')
  })
  it('refuses anything it cannot be sure of, rather than storing a wrong number', () => {
    expect(toE164('')).toBe('')
    expect(toE164(null)).toBe('')
    expect(toE164('123')).toBe('')
    expect(toE164('010-1234 (집)')).toBe('')
    expect(toE164('park47878')).toBe('')
  })
})

describe('classifyKakaoId', () => {
  // 아래 값들은 운영 명단에 실제로 들어 있는 모양이다 — 이 칸은 아이디만 담고 있지 않다.
  it('reads an ordinary id', () => {
    expect(classifyKakaoId('park47878')).toMatchObject({ kind: 'id', value: 'park47878' })
    expect(classifyKakaoId('jwoo-31')).toMatchObject({ kind: 'id' })
    expect(classifyKakaoId('1028jjjj')).toMatchObject({ kind: 'id' })
  })
  it('recognizes a phone number written into the 카톡 아이디 box', () => {
    expect(classifyKakaoId('+82 10-2744-1580')).toMatchObject({ kind: 'phone', value: '+821027441580' })
    expect(classifyKakaoId('010 3220 9178')).toMatchObject({ kind: 'phone', value: '+821032209178' })
  })
  it('recognizes an email address', () => {
    expect(classifyKakaoId('charles9901@naver.com')).toMatchObject({ kind: 'email', value: 'charles9901@naver.com' })
  })
  it('keeps an id annotated with its service as an id, not an email', () => {
    // 'KSW829207 @Naver' 는 이메일이 아니다 (TLD가 없다) — 적힌 그대로 아이디로 둔다.
    expect(classifyKakaoId('KSW829207 @Naver')).toMatchObject({ kind: 'id', raw: 'KSW829207 @Naver' })
  })
  it('reports an empty box', () => {
    expect(classifyKakaoId('')).toMatchObject({ kind: 'none' })
    expect(classifyKakaoId(undefined)).toMatchObject({ kind: 'none' })
  })
})

describe('contactCard', () => {
  it('builds a MECARD carrying the number and the 카톡 아이디 as a note', () => {
    const c = contactCard(member({ phone: '(412) 703-0123', kakao_id: 'park47878' }))
    expect(c.scannable).toBe(true)
    expect(c.payload).toBe('MECARD:N:김서현;TEL:+14127030123;NOTE:카톡 park47878;;')
  })

  it('uses a phone written in the 카톡 box when the phone column is blank', () => {
    // 이 갈라 읽기가 없으면 번호가 있는데도 "찍을 수 없는 사람"이 된다.
    const c = contactCard(member({ phone: '', kakao_id: '010 3220 9178' }))
    expect(c.scannable).toBe(true)
    expect(c.tels).toEqual(['+821032209178'])
    // 전화번호로 판명된 값은 아이디 메모로 나가지 않는다 — 아이디가 아니기 때문.
    expect(c.payload).not.toContain('NOTE')
  })

  it('carries both numbers when the two boxes hold different ones', () => {
    const c = contactCard(member({ phone: '(412) 703-0123', kakao_id: '+82 10-2744-1580' }))
    expect(c.tels).toEqual(['+14127030123', '+821027441580'])
    expect(c.payload).toBe('MECARD:N:김서현;TEL:+14127030123;TEL:+821027441580;;')
  })

  it('does not repeat the same number twice', () => {
    const c = contactCard(member({ phone: '(412) 703-0123', kakao_id: '412-703-0123' }))
    expect(c.tels).toEqual(['+14127030123'])
  })

  it('files an email from the 카톡 box into EMAIL', () => {
    const c = contactCard(member({ phone: '(412) 913-2930', kakao_id: 'charles9901@naver.com' }))
    expect(c.payload).toContain('EMAIL:charles9901@naver.com')
  })

  it('is not scannable without any number — a QR would encode nothing actionable', () => {
    const c = contactCard(member({ phone: '', kakao_id: 'minw48594' }))
    expect(c.scannable).toBe(false)
    expect(c.payload).toBe('')
    // 그래도 아이디는 화면에 보여줘야 한다 (손으로 검색할 유일한 단서).
    expect(c.kakao).toMatchObject({ kind: 'id', value: 'minw48594' })
  })

  it('escapes MECARD separators inside a name', () => {
    const c = contactCard(member({ name: '김서현(대학부); 방문', phone: '4127030123' }))
    expect(c.payload).toContain('N:김서현(대학부)\\; 방문')
  })
})

describe('kakaoIdList', () => {
  it('lists ids for pasting, flagging the values that are not ids', () => {
    const list = kakaoIdList([
      member({ name: '김서현', kakao_id: 'park47878' }),
      member({ name: '이준서', kakao_id: '010 3220 9178' }),
      member({ name: '박지우', kakao_id: 'charles9901@naver.com' }),
      member({ name: '최민', kakao_id: '' }),
    ])
    expect(list).toBe(
      '김서현 — park47878\n이준서 — 010 3220 9178 (전화번호)\n박지우 — charles9901@naver.com (이메일)',
    )
  })
  it('is empty when nobody has one', () => {
    expect(kakaoIdList([member()])).toBe('')
  })
})

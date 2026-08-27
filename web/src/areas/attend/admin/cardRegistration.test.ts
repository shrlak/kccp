import { describe, it, expect } from 'vitest'
import { easternNow } from '../../../lib/checkinWindow'
import { UNNAMED_CARD_NAME, cardMemberName, unnamedCardName } from './cardRegistration'

const at = (iso: string) => easternNow(new Date(iso))

describe('cardMemberName — 이름 칸이 빈 카드', () => {
  it('적힌 이름은 다듬기만 한다', () => {
    expect(cardMemberName('  김새가  ', at('2026-08-17T18:23:05Z'))).toBe('김새가')
  })

  it('비어 있으면 시각이 붙은 자리표가 된다', () => {
    // 2026-08-17 14:23:05 EDT
    expect(cardMemberName('', at('2026-08-17T18:23:05Z'))).toBe('이름 미기재 08-17 14:23:05')
    expect(unnamedCardName(at('2026-08-17T18:23:05Z')).startsWith(UNNAMED_CARD_NAME)).toBe(true)
  })

  it('빈 카드 두 장이 같은 이름을 갖지 않는다', () => {
    // 이름이 같고 연락처가 비어 있으면 서버의 중복 병합이 둘을 한 줄로 합친다 — 등록을
    // 막지 않으려던 것이 사람을 잃는 것으로 돌아오지 않도록 초까지 붙는다.
    const a = cardMemberName('', at('2026-08-17T18:23:05Z'))
    const b = cardMemberName('', at('2026-08-17T18:23:06Z'))
    expect(a).not.toBe(b)
  })
})

import { ADULT_GROUP } from '../../../lib/partition'
import { birthRaw, isoDateOrNull, packFamily, type AdultCardValue } from './adultCard'
import type { NewMemberFields } from '../../../lib/api'

// 장년부 카드 → 등록 몸통. 키오스크와 공유 링크가 같은 것을 보낸다 — 두 길이 같은 종이를
// 받으므로 담기는 칸도 같아야 한다.
//
// 부서는 고를 것이 없으므로 언제나 장년부이고, 셀은 나중에 관리자가 배정한다 (키오스크에서
// 셀을 묻지 않는 것은 대학·청년부와 같다).
export function adultPayload(card: AdultCardValue): NewMemberFields {
  return {
    name: card.name.trim(),
    group: ADULT_GROUP,
    subgroup: '',
    gender: card.gender,
    phone: card.phone.trim(),
    birthDate: isoDateOrNull(card.birthDate),
    birthDateRaw: birthRaw(card.birthDate),
    baptismStatus: card.baptismStatus,
    schoolOrWork: card.schoolOrWork.trim(),
    registrationDate: isoDateOrNull(card.registrationDate),
    nameEn: card.nameEn.trim(),
    phoneHome: card.phoneHome.trim(),
    email: card.email.trim(),
    address: card.address.trim(),
    city: card.city.trim(),
    state: card.state.trim(),
    zipCode: card.zipCode.trim(),
    attendReason: card.attendReason,
    registrationChoice: card.registrationChoice,
    visitDate: isoDateOrNull(card.visitDate),
    memberNo: card.memberNo.trim(),
    family: packFamily(card.family),
  }
}

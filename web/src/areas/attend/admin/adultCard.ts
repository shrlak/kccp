// ── 장년부 새교우 방문 · 등록 카드 ────────────────────────────────────────────────────
//
// 대학·청년부의 새가족 등록 카드와는 **다른 종이**다. 같은 정보를 조금씩 다르게 묻는 게 아니라,
// 애초에 묻는 것이 다르다:
//   · 이름을 한글과 영문 두 칸으로 받는다
//   · 전화를 휴대폰과 집(기타)으로 나눈다
//   · 주소를 도로명 한 줄 + City / State / Zip으로 쪼갠다
//   · 왜 피츠버그에 왔는지(이사·방문·연수·유학)를 묻는다
//   · 교회에 등록할 뜻이 있는지를 세 갈래로 묻는다
//   · 그리고 무엇보다 **동행가족을 다섯 줄까지 같은 카드에** 적는다
//
// 그래서 CardFormValue에 칸을 몇 개 더 붙이는 대신 자기 모델을 갖는다. 저장되는 곳은
// adult.members의 카드 칸들 (마이그레이션 20260808) — 대학·청년부 표에는 없는 칸이므로
// 이 카드는 장년부 패널에서만 뜬다.

import type { Member } from '../../../lib/api'
import { formatPhoneNumber } from '../../../lib/phone'

// 종이에 인쇄된 문구 그대로. 카드 replica는 이 말들을 바꾸지 않는다 — 손에 든 종이와
// 화면이 한 글자라도 다르면, 받아 적는 사람이 어느 칸인지 헷갈린다.
export const ADULT_CARD_KICKER = '새교우 방문, 등록 카드'
export const ADULT_CARD_TITLE = '주님의 이름으로 환영 합니다!'
export const ADULT_CARD_WELCOME = [
  '오늘 예배 참석 하심을 그리스도의 이름으로 환영 합니다.',
  '저희 교회가 예수 안에서 필요한 도움을 드릴 수 있도록 다음 사항을 기재하여 주시면 감사하겠습니다.',
]
export const ADULT_CARD_ADDRESS_NOTE = [
  '등록을 원하시면 주소 작성 부탁드립니다.',
  'Please fill out the address if you would like to register.',
]
export const ADULT_CARD_FOOTER = ['피츠버그 한인중앙교회', 'Korean Central Church of Pittsburgh']

// 참석동기 — 카드의 네모 넷. 값은 영문 키로 저장하고(서버·DB가 읽는 값), 화면에는 한글을 쓴다.
export const ATTEND_REASONS = [
  { key: 'moved', label: '이사', en: 'Moved' },
  { key: 'visiting', label: '방문', en: 'Visiting' },
  { key: 'training', label: '연수', en: 'Training' },
  { key: 'study', label: '유학', en: 'Study' },
] as const

// 교회등록 여부 — 카드 아래쪽의 세 갈래.
export const REGISTRATION_CHOICES = [
  { key: 'register', label: '등록을 원합니다', en: 'I would like to register' },
  { key: 'later', label: '나중에 결정 하겠습니다', en: 'I will decide to register later' },
  { key: 'pastor', label: '목사의 연락/상담 원함', en: 'I would like the Pastor to contact or counsel me' },
] as const

// 동행가족은 종이에 다섯 줄이다. 빈 줄도 그려야 카드처럼 보이므로 항상 이 수만큼 렌더한다.
export const FAMILY_ROWS = 5

export interface AdultFamilyMember {
  nameKo: string
  nameEn: string
  relation: string
  birthDate: string // ISO or ''
  gender: string // '남' | '여' | ''
  baptism: string // 종이의 마지막 열 — 동행가족도 세례여부를 적는다
}

export interface AdultCardValue {
  visitDate: string // ISO or '' — 카드 머리의 방문 일자
  memberNo: string // 교우 등록번호
  name: string // 한글 성명 (members.name)
  nameEn: string
  gender: string // '남' | '여' | ''
  birthDate: string // ISO or ''
  phone: string // 휴대폰
  phoneHome: string // 집 · 기타
  email: string // 카드의 *이메일 칸 (카톡 번호를 적는 사람도 있어 자유 입력이다)
  address: string
  city: string
  state: string
  zipCode: string
  attendReason: string // ATTEND_REASONS의 key or ''
  schoolOrWork: string // 직장 또는 학교명
  baptismStatus: string
  registrationChoice: string // REGISTRATION_CHOICES의 key or ''
  registrationDate: string // ISO or '' — 교회 등록일
  family: AdultFamilyMember[]
}

export function blankFamilyMember(): AdultFamilyMember {
  return { nameKo: '', nameEn: '', relation: '', birthDate: '', gender: '', baptism: '' }
}

// 저장된 값이 다섯 줄보다 적으면 빈 줄로 채우고, 많으면(예전 데이터) 그대로 둔다 — 카드는
// 다섯 줄이지만 이미 적힌 사람을 화면에서 지워 보일 수는 없다.
function padFamily(list: AdultFamilyMember[]): AdultFamilyMember[] {
  const out = list.slice()
  while (out.length < FAMILY_ROWS) out.push(blankFamilyMember())
  return out
}

function readFamily(value: unknown): AdultFamilyMember[] {
  if (!Array.isArray(value)) return []
  return value.map((raw) => {
    const row = (raw ?? {}) as Partial<AdultFamilyMember>
    return {
      nameKo: row.nameKo ?? '',
      nameEn: row.nameEn ?? '',
      relation: row.relation ?? '',
      birthDate: row.birthDate ?? '',
      gender: row.gender ?? '',
      baptism: row.baptism ?? '',
    }
  })
}

export function adultCardFromMember(m: Member): AdultCardValue {
  return {
    visitDate: m.visit_date || '',
    memberNo: m.member_no || '',
    name: m.name || '',
    nameEn: m.name_en || '',
    gender: m.gender || '',
    birthDate: m.birth_date || m.birth_date_raw || '',
    phone: formatPhoneNumber(m.phone || ''),
    phoneHome: formatPhoneNumber(m.phone_home || ''),
    email: m.email || '',
    address: m.address || '',
    city: m.city || '',
    state: m.state || '',
    zipCode: m.zip_code || '',
    attendReason: m.attend_reason || '',
    schoolOrWork: m.school_or_work || '',
    baptismStatus: m.baptism_status || '',
    registrationChoice: m.registration_choice || '',
    registrationDate: m.registration_date || '',
    family: padFamily(readFamily(m.family)),
  }
}

export function blankAdultCard(visitDate: string): AdultCardValue {
  return {
    visitDate,
    memberNo: '',
    name: '',
    nameEn: '',
    gender: '',
    birthDate: '',
    phone: '',
    phoneHome: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    attendReason: '',
    schoolOrWork: '',
    baptismStatus: '',
    registrationChoice: '',
    registrationDate: '',
    family: padFamily([]),
  }
}

// 저장 직전에 동행가족의 빈 줄을 걷어낸다 — 종이의 빈 칸까지 DB에 넣을 이유는 없다.
// 이름이 하나도 없는 줄만 버린다 (관계만 적힌 줄은 아직 쓰는 중일 수 있다).
export function packFamily(list: AdultFamilyMember[]): AdultFamilyMember[] {
  return list.filter((row) => row.nameKo.trim() !== '' || row.nameEn.trim() !== '')
}

// 종이의 생년월일은 년/월/일 세 칸이라 셋이 다 차야 날짜가 된다 (DB의 birth_date는 날짜다).
export function isoDateOrNull(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

// 날짜가 되지 못한 값은 **적힌 그대로** 남긴다 ("2006", "2006-10") — 20260812의
// birth_date_raw. 1월 1일로 채워 넣지 않는 이유: 있지도 않은 생일이 생기고, 나중에 보는
// 사람이 적힌 값인지 우리가 지어낸 값인지 알 수 없게 된다.
// 완전한 날짜일 때는 비운다 — 같은 값을 두 칸에 두면 둘이 어긋날 자리가 생긴다.
export function birthRaw(value: string): string {
  if (isoDateOrNull(value)) return ''
  const parts = value.split('-')
  const kept: string[] = []
  for (const part of parts) {
    if (!part) break // 중간이 비면 거기서 끊는다 — "2006--24"는 "2006"이다
    kept.push(part)
  }
  return kept.join('-')
}

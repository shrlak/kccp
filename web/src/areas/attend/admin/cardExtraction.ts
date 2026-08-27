import {
  AFFILIATION_CATEGORIES,
  BAPTISM_OPTIONS,
  FAITH_OPTIONS,
  blankCardForm,
  type CardFormValue,
} from './newFamilyCard'
import {
  ATTEND_REASONS,
  FAMILY_ROWS,
  REGISTRATION_CHOICES,
  blankAdultCard,
  type AdultCardValue,
} from './adultCard'
import { formatPhoneNumber } from '../../../lib/phone'

// ── 카드 사진 인식 결과 정규화 ─────────────────────────────────────────────────
// Turns the raw JSON the extraction endpoint returns (Gemini's reading of a
// handwritten 등록 카드 — untrusted: fields may be null, misformatted, or outside
// the card's vocabulary) into a complete CardFormValue ready for the review form.
// Pure and side-effect free so every rule is unit-testable (cardExtraction.test.ts).

const GENDER_OPTIONS = ['남', '여'] as const

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function clampEnum(v: unknown, options: readonly string[]): string {
  const s = str(v)
  return options.includes(s) ? s : ''
}

// Handwritten dates arrive in whatever shape was on the card: ISO (the prompt asks
// for it), the card's printed MM / DD / YYYY order, dots, or 2-digit years. Returns
// ISO YYYY-MM-DD or '' when unparseable/impossible — never a guess.
// 2-digit-year pivot: birth years land in 19xx when 20xx would be in the future
// (born '98 → 1998, born '04 → 2004); registration dates are always 20xx.
export function normalizeCardDate(
  v: unknown,
  kind: 'birth' | 'registration',
  nowYear = new Date().getFullYear(),
): string {
  const s = str(v)
  if (!s) return ''
  const groups = s.match(/\d+/g)
  if (!groups || groups.length !== 3) return ''
  // A leading 4-digit group is ISO order (YYYY-MM-DD); otherwise the card's MM/DD/YYYY.
  const [y, mo, d] = groups[0].length === 4 ? groups : [groups[2], groups[0], groups[1]]
  let year: number
  if (y.length === 4) year = Number(y)
  else if (y.length === 2) {
    const yy = Number(y)
    year = kind === 'registration' ? 2000 + yy : 2000 + yy > nowYear ? 1900 + yy : 2000 + yy
  } else return ''
  const month = Number(mo)
  const day = Number(d)
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return ''
  // Round-trip through Date to reject impossible days like 02/30.
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Format recognizable US/Korean mobile numbers; anything else passes through as
// written so the admin sees what the card says instead of a silently mangled value.
export function normalizePhone(v: unknown): string {
  return formatPhoneNumber(str(v))
}

// Raw extraction payload → a complete CardFormValue. Unknown/null fields become the
// blank-card defaults; enums are clamped to the card's canonical vocabulary; 등록일
// falls back to `today` (same stamp the kiosk uses for a fresh card).
export function normalizeExtractedCard(raw: unknown, today: string): CardFormValue {
  const base = blankCardForm(today)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const r = raw as Record<string, unknown>
  return {
    ...base,
    name: str(r.name),
    gender: clampEnum(r.gender, GENDER_OPTIONS),
    phone: normalizePhone(r.phone),
    kakaoId: str(r.kakaoId),
    birthDate: normalizeCardDate(r.birthDate, 'birth'),
    affiliationCategory: clampEnum(r.affiliationCategory, AFFILIATION_CATEGORIES),
    affiliationDetail: str(r.affiliationDetail),
    baptismStatus: clampEnum(r.baptismStatus, BAPTISM_OPTIONS),
    faithDuration: clampEnum(r.faithDuration, FAITH_OPTIONS),
    registrationDate: normalizeCardDate(r.registrationDate, 'registration') || today,
    // Only a definite true/false reading counts — anything else (null, missing, garbage)
    // stays blank, same as a freshly opened card.
    pastoralVisitRequested: r.pastoralVisitRequested === true ? true : r.pastoralVisitRequested === false ? false : null,
  }
}

// Did the model actually read something off this card? 등록일 is excluded because it
// falls back to `today` for every card, blank ones included.
function hasContent(c: CardFormValue): boolean {
  return Boolean(
    c.name || c.gender || c.phone || c.kakaoId || c.birthDate || c.affiliationCategory ||
      c.affiliationDetail || c.baptismStatus || c.faithDuration,
  ) || c.pastoralVisitRequested !== null
}

// One photo can show several cards, so extraction returns a list. Empty-looking
// entries (a stray background object the model volunteered) are dropped; a payload
// with nothing readable at all still yields one blank card, so an unreadable photo
// lands on an empty review form to fill in by hand instead of an error.
export function normalizeExtractedCards(raw: unknown, today: string): CardFormValue[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const cards = list.map((r) => normalizeExtractedCard(r, today)).filter(hasContent)
  return cards.length > 0 ? cards : [blankCardForm(today)]
}

// ── 장년부 카드 ──────────────────────────────────────────────────────────────────
// 판독 결과는 두 종이를 한 배열에 섞어 올 수 있다 (대학·청년부 링크는 둘 다 읽는다).
// 어느 종이인지는 카드가 스스로 말한다 — cardType. 그 값이 없으면 장년부에만 있는 칸이
// 하나라도 채워졌는지로 판단한다 (예전 모델이나 스키마를 무시한 응답을 위한 대비).
export function extractedCardKind(raw: unknown): 'youth' | 'adult' {
  if (!raw || typeof raw !== 'object') return 'youth'
  const r = raw as Record<string, unknown>
  if (r.cardType === 'adult') return 'adult'
  if (r.cardType === 'youth') return 'youth'
  const adultOnly = [r.nameEn, r.phoneHome, r.address, r.city, r.state, r.zipCode, r.attendReason, r.registrationChoice, r.memberNo]
  if (adultOnly.some((v) => typeof v === 'string' && v.trim() !== '')) return 'adult'
  return Array.isArray(r.family) && r.family.length > 0 ? 'adult' : 'youth'
}

// 장년부 카드의 생년월일은 년만 적혀 오는 일이 잦다 ("2006"). 날짜로 만들 수 없는 값을
// 버리지 않고 적힌 그대로 둔다 — 카드가 세 칸이므로 화면에서 년 칸에 그대로 들어간다.
function adultBirth(v: unknown): string {
  const raw = str(v).trim()
  if (!raw) return ''
  const iso = normalizeCardDate(raw, 'birth')
  if (iso) return iso
  const year = raw.match(/(19|20)\d{2}/)
  return year ? year[0] : ''
}

function adultFamily(v: unknown): AdultCardValue['family'] {
  const rows = Array.isArray(v) ? v : []
  const out = rows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>
    return {
      nameKo: str(r.nameKo),
      nameEn: str(r.nameEn),
      relation: str(r.relation),
      birthDate: adultBirth(r.birthDate),
      gender: str(r.gender),
      baptism: str(r.baptism),
    }
  })
  // 이름이 하나도 없는 줄은 종이의 빈 칸이다.
  return out.filter((row) => row.nameKo || row.nameEn)
}

export function normalizeExtractedAdultCard(raw: unknown, today: string): AdultCardValue {
  const base = blankAdultCard(today)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const r = raw as Record<string, unknown>
  const family = adultFamily(r.family)
  return {
    ...base,
    name: str(r.name),
    nameEn: str(r.nameEn),
    gender: clampEnum(r.gender, GENDER_OPTIONS),
    birthDate: adultBirth(r.birthDate),
    phone: normalizePhone(r.phone),
    phoneHome: normalizePhone(r.phoneHome),
    email: str(r.email),
    address: str(r.address),
    city: str(r.city),
    state: str(r.state),
    zipCode: str(r.zipCode),
    attendReason: clampEnum(r.attendReason, ATTEND_REASONS.map((x) => x.key)),
    schoolOrWork: str(r.schoolOrWork),
    baptismStatus: str(r.baptismStatus),
    registrationChoice: clampEnum(r.registrationChoice, REGISTRATION_CHOICES.map((x) => x.key)),
    visitDate: normalizeCardDate(r.visitDate, 'registration'),
    memberNo: str(r.memberNo),
    // 읽어 온 줄을 먼저 놓고, 종이처럼 다섯 줄이 되도록 빈 줄로 채운다.
    family: [...family, ...base.family].slice(0, Math.max(FAMILY_ROWS, family.length)),
  }
}

function hasAdultContent(c: AdultCardValue): boolean {
  return Boolean(
    c.name || c.nameEn || c.phone || c.phoneHome || c.email || c.address || c.city ||
      c.birthDate || c.attendReason || c.registrationChoice || c.memberNo || c.baptismStatus,
  ) || c.family.some((f) => f.nameKo || f.nameEn)
}

// 사진 한 장에서 나온 카드들 — 두 종이가 섞여 있을 수 있다.
export type ScannedCard =
  | { kind: 'youth'; youth: CardFormValue }
  | { kind: 'adult'; adult: AdultCardValue }

export function normalizeScannedCards(raw: unknown, today: string, only?: 'adult'): ScannedCard[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const out: ScannedCard[] = []
  for (const r of list) {
    const kind = only === 'adult' ? 'adult' : extractedCardKind(r)
    if (kind === 'adult') {
      const adult = normalizeExtractedAdultCard(r, today)
      if (hasAdultContent(adult)) out.push({ kind: 'adult', adult })
    } else {
      const youth = normalizeExtractedCard(r, today)
      if (hasContent(youth)) out.push({ kind: 'youth', youth })
    }
  }
  // 아무것도 읽지 못했어도 빈 카드 한 장은 준다 — 손으로 채워 넣을 수 있도록.
  if (out.length > 0) return out
  return [only === 'adult' ? { kind: 'adult', adult: blankAdultCard(today) } : { kind: 'youth', youth: blankCardForm(today) }]
}

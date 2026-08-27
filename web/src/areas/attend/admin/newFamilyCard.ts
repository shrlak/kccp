import type { Member } from '../../../lib/api'
import { formatPhoneNumber } from '../../../lib/phone'
import { ADULT_GROUP, type Partition } from '../../../lib/partition'

// ── 새가족 등록 카드 — pure model of the paper card ─────────────────────────────
// The single source of truth for the paper registration card's layout/vocabulary:
// the title line, the 소속/세례/신앙생활 option lists, and `cardModel()` which maps a
// Member row onto the card's five label|value|label|value table rows. Shared by the
// canvas renderer (newFamilyCardImage) and the kiosk entry form
// (KioskNewMemberDialog) so the printed card and the on-screen form never drift.
// No canvas/DOM here — everything is pure and unit-testable.

export const CARD_TITLE = '< KCCP 빛주사랑 대학청년부 - 새가족 등록 카드 >'

// 소속 (학교/직장) categories. There is no dedicated DB column: the category is
// stored client-side as a prefix inside `school_or_work`, joined with ' · '
// (e.g. "대학생 · Pitt 컴퓨터공학") — join/splitAffiliation below own that convention.
export const AFFILIATION_CATEGORIES = ['대학생', '대학원생', '직장인', 'Other'] as const
export type AffiliationCategory = (typeof AFFILIATION_CATEGORIES)[number]

const AFFILIATION_SEP = ' · '

// Compose `school_or_work` from a category + free-text detail. Either side may be
// blank: '' category → just the detail, '' detail → just the category.
export function joinAffiliation(category: string, detail: string): string {
  const c = category.trim()
  const d = detail.trim()
  if (!c) return d
  if (!d) return c
  return `${c}${AFFILIATION_SEP}${d}`
}

// 부서 derived from the card's 소속 category — the kiosk 새가족 등록 has no 부서 picker:
// 대학생 → 대학부, everything else (대학원생/직장인/Other) → 청년부. Admins can correct it
// later in the Members tab, the only place 부서 is edited.
//
// 장년부에는 고를 부서가 하나뿐이라 추론할 것이 없다 — 그 부에서는 언제나 장년부다.
export function groupForAffiliation(category: string, partition: Partition = 'youth'): string {
  if (partition === 'adult') return ADULT_GROUP
  return category.trim() === '대학생' ? '대학부' : '청년부'
}

// Recover { category, detail } from `school_or_work`. A known-category prefix before
// ' · ' (or a bare category with no detail) is recognized; any other non-empty text
// means "has affiliation text that isn't one of the known categories" → category
// 'Other' with the whole string as the detail. Empty → both empty.
export function splitAffiliation(schoolOrWork: string): { category: AffiliationCategory | ''; detail: string } {
  const s = (schoolOrWork || '').trim()
  if (!s) return { category: '', detail: '' }
  for (const c of AFFILIATION_CATEGORIES) {
    if (s === c) return { category: c, detail: '' }
    if (s.startsWith(c + AFFILIATION_SEP)) return { category: c, detail: s.slice(c.length + AFFILIATION_SEP.length).trim() }
  }
  return { category: 'Other', detail: s }
}

// 세례 여부 options — the Korean label is the canonical stored value; the paper card
// prints a small English caption after each.
export const BAPTISM_OPTIONS = ['유아세례', '입교', '세례', '해당없음'] as const
// 세례 여부는 여러 개를 고를 수 있다 (예: 유아세례 + 입교). 컬럼은 그대로 문자열이라
// ", "로 이어 붙여 저장한다 — 예전에 저장된 한 개짜리 값도 그대로 읽힌다.
export function parseBaptism(value: string | null | undefined): string[] {
  return (value || '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

export function formatBaptism(list: string[]): string {
  // 카드에 인쇄된 순서(유아세례 → 입교 → 세례 → 해당없음)를 유지한다.
  const known = BAPTISM_OPTIONS.filter((o) => list.includes(o))
  const extra = list.filter((v) => !BAPTISM_OPTIONS.includes(v as (typeof BAPTISM_OPTIONS)[number]))
  return [...known, ...extra].join(', ')
}

// 옵션 하나를 켜고 끈다. "해당없음"은 다른 항목과 같이 설정될 수 없으므로 서로를 지운다.
export function toggleBaptism(value: string | null | undefined, option: string): string {
  const list = parseBaptism(value)
  if (list.includes(option)) return formatBaptism(list.filter((v) => v !== option))
  if (option === '해당없음') return option
  return formatBaptism([...list.filter((v) => v !== '해당없음'), option])
}

export const BAPTISM_CAPTIONS: Record<string, string> = {
  유아세례: 'Infant Baptism',
  입교: 'Confirmation',
  세례: 'Baptism',
  해당없음: 'N/A',
}

// 신앙생활 options (stored verbatim in `faith_duration`).
export const FAITH_OPTIONS = ['모태신앙', '1년 미만', '1-3년', '3-5년', '5년 이상'] as const

// Unfilled date blanks, exactly as printed on the paper card (MM / DD / YYYY).
export const DATE_BLANK = '____ / ____ / ______'

// ISO date → the card's "MM / DD / YYYY"; anything blank/unparseable stays as the
// paper card's underscore blanks.
export function formatCardDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return DATE_BLANK
  return `${m[2]} / ${m[3]} / ${m[1]}`
}

// ── Card form value ──────────────────────────────────────────────────────────
// The editable card's field set (NewFamilyCardForm) — everything printed on the
// paper card, with 소속 kept as category + detail until save re-joins them.

export interface CardFormValue {
  name: string
  gender: string // '남' | '여' | ''
  phone: string
  kakaoId: string
  birthDate: string // ISO or ''
  affiliationCategory: string // 대학생 | 대학원생 | 직장인 | Other | ''
  affiliationDetail: string // 학교/전공 or 직장
  baptismStatus: string
  faithDuration: string
  registrationDate: string // ISO or ''
  // null = blank (neither O nor X ticked yet) — the default for a fresh card. true/false
  // once the operator taps a side.
  pastoralVisitRequested: boolean | null
}

// Seed the form from a stored member (소속 category recovered from school_or_work).
export function cardFormFromMember(m: Member): CardFormValue {
  const aff = splitAffiliation(m.school_or_work || '')
  return {
    name: m.name || '',
    gender: m.gender || '',
    phone: formatPhoneNumber(m.phone || ''),
    kakaoId: m.kakao_id || '',
    birthDate: m.birth_date || '',
    affiliationCategory: aff.category,
    affiliationDetail: aff.detail,
    baptismStatus: m.baptism_status || '',
    faithDuration: m.faith_duration || '',
    registrationDate: m.registration_date || '',
    pastoralVisitRequested: m.pastoral_visit_requested ?? null,
  }
}

const EMPTY_CARD: CardFormValue = {
  name: '',
  gender: '',
  phone: '',
  kakaoId: '',
  birthDate: '',
  affiliationCategory: '',
  affiliationDetail: '',
  baptismStatus: '',
  faithDuration: '',
  registrationDate: '',
  // Blank by default — the paper card starts with neither 목사님 심방 요청 box ticked.
  pastoralVisitRequested: null,
}

// A blank card with 등록일 stamped to the given day (the kiosk's "day they were added").
export function blankCardForm(registrationDate: string): CardFormValue {
  return { ...EMPTY_CARD, registrationDate }
}

// ── Card model ───────────────────────────────────────────────────────────────

export interface CardCheckOption {
  label: string // Korean canonical label (what's matched against the stored value)
  caption?: string // small English caption printed after the label (세례 여부 row)
  checked: boolean
}

export type CardCellContent =
  | { kind: 'text'; text: string }
  | { kind: 'name'; name: string; circled: '남' | '여' | null } // 이름 cell: name + ( 남 / 여 ) with the gender circled
  | { kind: 'checks'; options: CardCheckOption[]; extra: string } // extra = free text after the last option (Other: …)

export interface CardCell {
  label: string
  content: CardCellContent
}

export interface CardRow {
  left: CardCell
  right: CardCell
}

export interface CardModel {
  title: string
  rows: CardRow[]
}

// One member → the paper card's five [grey label | value | grey label | value] rows.
export function cardModel(m: Member): CardModel {
  const gender = m.gender || ''
  const circled = gender.includes('남') ? ('남' as const) : gender.includes('여') ? ('여' as const) : null
  const aff = splitAffiliation(m.school_or_work || '')
  const baptism = (m.baptism_status || '').trim()
  const faith = (m.faith_duration || '').trim()
  return {
    title: CARD_TITLE,
    rows: [
      {
        left: { label: '이름', content: { kind: 'name', name: m.name || '', circled } },
        right: { label: '전화번호', content: { kind: 'text', text: m.phone || '' } },
      },
      {
        left: { label: '생년월일', content: { kind: 'text', text: formatCardDate(m.birth_date) } },
        right: { label: '카톡 아이디', content: { kind: 'text', text: m.kakao_id || '' } },
      },
      {
        left: {
          label: '소속 (학교/직장)',
          content: {
            kind: 'checks',
            options: AFFILIATION_CATEGORIES.map((c) => ({
              label: c === 'Other' ? 'Other:' : c,
              checked: aff.category === c,
            })),
            // The paper's "Other: ____" free text — only when the affiliation isn't a
            // known category (the detail also appears in the 학교/전공 or 직장 row).
            extra: aff.category === 'Other' ? aff.detail : '',
          },
        },
        right: {
          label: '세례 여부',
          content: {
            kind: 'checks',
            options: BAPTISM_OPTIONS.map((o) => ({ label: o, caption: BAPTISM_CAPTIONS[o], checked: parseBaptism(baptism).includes(o) })),
            extra: '',
          },
        },
      },
      {
        left: { label: '학교/전공 or 직장', content: { kind: 'text', text: aff.detail } },
        right: {
          label: '신앙생활',
          content: {
            kind: 'checks',
            options: FAITH_OPTIONS.map((o) => ({ label: o, checked: faith === o })),
            extra: '',
          },
        },
      },
      {
        left: { label: '등록일', content: { kind: 'text', text: formatCardDate(m.registration_date) } },
        right: {
          label: '목사님 심방 요청',
          content: {
            kind: 'checks',
            options: [
              // Neither ticks when the value is null/undefined (blank — not yet asked).
              { label: 'O', checked: m.pastoral_visit_requested === true },
              { label: 'X', checked: m.pastoral_visit_requested === false },
            ],
            extra: '',
          },
        },
      },
    ],
  }
}

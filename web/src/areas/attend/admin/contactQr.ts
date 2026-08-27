import type { Member } from '../../../lib/api'

// ── 새가족 카톡 추가 — 연락처 QR ────────────────────────────────────────────────
//
// **이 QR은 카톡 링크가 아니라 연락처(MECARD)를 담는다.** 카카오톡에는 "이 아이디를
// 친구로 추가" 하는 공개 주소가 없다 — 공개된 링크 규칙은 카카오톡 채널(`pf.kakao.com/_난수`)
// 뿐이고 그것은 업체 채널이지 사람이 아니다. 카톡 앱의 친구 QR은 그 계정에서 카카오가
// 만들어 주는 것이라 (그래서 그 QR로 추가할 때 상대의 아이디는 보이지도 않는다) 우리가
// 적어 둔 아이디로는 만들 수 없다. 아이디를 그대로 QR에 넣으면 찍어도 글자만 나온다.
//
// 그래서 찍었을 때 실제로 뭔가 일어나는 유일한 길을 담는다: **연락처**. 폰 카메라로
// 찍으면 "연락처 추가"가 뜨고, 저장되면 카카오톡이 전화번호로 그 사람을 친구 목록에
// 올려 준다 — 카톡이 친구를 붙이는 진짜 열쇠도 아이디가 아니라 전화번호다. 카톡 아이디는
// 연락처의 메모(NOTE)로 같이 실려 가므로, 자동으로 안 붙는 사람은 폰 안에서 그 아이디를
// 보고 검색할 수 있다.
//
// 순수 모듈이다 — QR 그리기(qrcode-generator)나 DOM은 여기 없다 (contactQr.test.ts).

// ── 전화번호 → E.164 ────────────────────────────────────────────────────────────
// 연락처에 저장될 값이라 국가번호가 붙어야 한다. 명단의 번호는 미국 10자리가 대부분이고
// 한국 010 번호가 섞여 있다 (lib/phone.ts가 그 두 가지를 화면용으로 포맷한다).
// 확신이 서지 않는 값은 ''를 준다 — 틀린 번호를 연락처에 넣느니 안 넣는 편이 낫다.
export function toE164(raw: string | null | undefined): string {
  const s = (raw || '').trim()
  if (!s) return ''
  // 숫자·구분기호 말고 다른 글자가 섞여 있으면 전화번호가 아니다 ("010-1234 (집)" 같은 메모).
  if (/[^\d\s+()\-.]/.test(s)) return ''
  const hasPlus = s.startsWith('+')
  const digits = s.replace(/\D/g, '')
  if (!digits) return ''
  // 이미 국가번호가 적힌 값은 그대로 믿는다.
  if (hasPlus) return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : ''
  // 010-1234-5678 → +82 10-1234-5678 (한국 번호는 국가번호를 붙이며 앞의 0을 뗀다).
  if (digits.length === 11 && digits.startsWith('010')) return `+82${digits.slice(1)}`
  // 미국 10자리, 그리고 1이 앞에 붙은 11자리.
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return ''
}

// ── 카톡 아이디 칸에 무엇이 적혀 있나 ───────────────────────────────────────────
// 실제 명단을 보면 이 칸에 아이디가 아닌 것이 자주 들어온다 — 전화번호("+82 10-2744-1580",
// "010 3220 9178")와 이메일("charles9901@naver.com")이다. 종이 카드를 받아 적는 칸이라
// 사람마다 다르게 채운다. 그것을 아이디로 취급하면 "아이디로 검색" 해도 나오지 않으므로,
// 무엇인지 갈라서 전화번호는 연락처의 번호로, 이메일은 이메일 칸으로 보낸다.
//
// 'KSW829207 @Naver' 처럼 아이디에 서비스 이름을 덧붙인 값은 이메일이 아니다 (TLD가 없다)
// — 아이디로 두고 원문 그대로 보여준다.
export type KakaoKind = 'id' | 'phone' | 'email' | 'none'

export interface KakaoField {
  kind: KakaoKind
  raw: string // 카드에 적힌 원문 — 화면에는 이것을 그대로 보여준다
  value: string // 쓸 수 있게 다듬은 값 (전화는 E.164, 나머지는 원문)
}

export function classifyKakaoId(raw: string | null | undefined): KakaoField {
  const s = (raw || '').trim()
  if (!s) return { kind: 'none', raw: '', value: '' }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { kind: 'email', raw: s, value: s }
  const tel = toE164(s)
  if (tel) return { kind: 'phone', raw: s, value: tel }
  return { kind: 'id', raw: s, value: s }
}

// ── MECARD ────────────────────────────────────────────────────────────────────
// 폰 카메라(iOS·안드로이드 모두)가 연락처로 알아보는 형식. vCard보다 짧아 QR이 성글게
// 나오고 — 찍기 쉬운 QR이 목적이므로 이쪽이 맞다.
// `\ ; : ,` 는 역슬래시로 escape 한다.
function esc(s: string): string {
  return s.replace(/([\\;:,])/g, '\\$1')
}

export interface ContactCard {
  member: Member
  name: string
  /** 연락처에 실릴 번호들 (E.164). 비어 있으면 찍어도 카톡이 붙일 근거가 없다. */
  tels: string[]
  email: string
  /** 카톡 칸을 갈라 본 결과 — 화면이 "아이디인지 전화인지"를 그대로 말해 준다. */
  kakao: KakaoField
  /** 찍으면 연락처가 저장되는가. 번호가 하나도 없으면 false. */
  scannable: boolean
  /** QR에 넣을 문자열. scannable이 false면 ''. */
  payload: string
}

export function contactCard(m: Member): ContactCard {
  const name = (m.name || '').trim()
  const kakao = classifyKakaoId(m.kakao_id)
  const primary = toE164(m.phone)
  // 카톡 칸에 적힌 것이 전화번호라면 그것도 이 사람의 번호다 — 전화번호 칸이 비어 있을 때
  // 이 값이 유일한 연결 고리인 경우가 실제로 있다.
  const fromKakao = kakao.kind === 'phone' ? kakao.value : ''
  const tels = [...new Set([primary, fromKakao].filter(Boolean))]
  const email = kakao.kind === 'email' ? kakao.value : ''
  // 아이디는 연락처 메모로 같이 간다. 자동으로 안 붙는 사람은 폰 안에서 이걸 보고 검색한다.
  const note = kakao.kind === 'id' ? `카톡 ${kakao.value}` : ''

  const scannable = tels.length > 0
  if (!scannable) return { member: m, name, tels, email, kakao, scannable, payload: '' }

  const parts = [`N:${esc(name)}`]
  for (const tel of tels) parts.push(`TEL:${esc(tel)}`)
  if (email) parts.push(`EMAIL:${esc(email)}`)
  if (note) parts.push(`NOTE:${esc(note)}`)
  return { member: m, name, tels, email, kakao, scannable, payload: `MECARD:${parts.join(';')};;` }
}

export function contactCards(members: Member[]): ContactCard[] {
  return members.map(contactCard)
}

// ── 카톡 아이디 목록 ───────────────────────────────────────────────────────────
// QR로 안 붙는 사람(번호가 없거나 자동 추가가 안 되는 사람)을 위해, 아이디를 한 번에
// 붙여넣을 수 있는 글로 만든다 — 지금은 아이디를 보려면 사람마다 편집 창을 열어야 한다.
// 전화·이메일로 판명된 값도 그 사실을 적어 함께 내보낸다 (아이디로 검색해도 안 나오므로).
export function kakaoIdList(members: Member[]): string {
  const lines: string[] = []
  for (const m of members) {
    const k = classifyKakaoId(m.kakao_id)
    if (k.kind === 'none') continue
    const suffix = k.kind === 'phone' ? ' (전화번호)' : k.kind === 'email' ? ' (이메일)' : ''
    lines.push(`${(m.name || '').trim()} — ${k.raw}${suffix}`)
  }
  return lines.join('\n')
}

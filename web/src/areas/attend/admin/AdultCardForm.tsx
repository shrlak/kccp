import type { InputHTMLAttributes, ReactNode } from 'react'
import {
  ADULT_CARD_ADDRESS_NOTE,
  ADULT_CARD_FOOTER,
  ADULT_CARD_KICKER,
  ADULT_CARD_TITLE,
  ADULT_CARD_WELCOME,
  ATTEND_REASONS,
  REGISTRATION_CHOICES,
  blankFamilyMember,
  type AdultCardValue,
  type AdultFamilyMember,
} from './adultCard'
import { formatPhoneNumber } from '../../../lib/phone'

// ── 장년부 새교우 방문 · 등록 카드 — 인쇄된 종이를 그대로 옮긴 입력 양식 ──────────────
//
// 대학·청년부의 NewFamilyCardForm과 같은 원리다: **카드가 곧 폼이다.** 칸에 바로 쓰고,
// 괄호를 눌러 표시하고, 남/여를 눌러 고른다. 색을 고정해 둔 것도 같은 이유 — 화면 테마가
// 아니라 인쇄된 종이를 흉내 내는 자리이므로.
//
// 줄 순서·칸 이름·한영 병기는 실제 카드를 따라간다. 받아 적는 사람이 손에 든 종이를 보며
// 화면을 채우기 때문에, 순서가 어긋나면 그 자체로 오기(誤記)가 된다.

export function AdultCardForm({
  value,
  onChange,
}: {
  value: AdultCardValue
  onChange: (patch: Partial<AdultCardValue>) => void
}) {
  const setFamily = (idx: number, patch: Partial<AdultFamilyMember>) =>
    onChange({ family: value.family.map((row, i) => (i === idx ? { ...row, ...patch } : row)) })

  return (
    // shrink-0: 다이얼로그의 max-h 컬럼 안에서 이 스크롤 상자의 min-content 높이가 0이라,
    // 없으면 카드가 납작하게 눌린다.
    <div className="scroll-x shrink-0">
      <div className="min-w-[680px] bg-white text-[#111]">
        {/* 머리 — 왼쪽 제목, 오른쪽 방문 일자 · 교우 등록번호 */}
        <div className="flex items-start justify-between gap-4 px-1 pb-2 text-[11px]">
          <span className="shrink-0 whitespace-nowrap font-semibold">{ADULT_CARD_KICKER}</span>
          {/* 종이에서는 이 둘이 오른쪽 위에 한 줄씩 놓인다. whitespace-nowrap이 없으면
              칸 이름이 접혀 두 줄이 되고, 그러면 종이와 다르게 읽힌다. */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="shrink-0">방문 일자</span>
              <DateBox value={value.visitDate} onChange={(v) => onChange({ visitDate: v })} className="w-[8.5rem] shrink-0" />
            </label>
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="shrink-0">교우 등록번호:</span>
              <TextBox value={value.memberNo} onChange={(v) => onChange({ memberNo: v })} className="w-24 shrink-0" />
            </label>
          </div>
        </div>

        {/* 환영 문구 */}
        <div className="border-y-2 border-[#111] py-2 text-center font-display text-lg font-bold">
          {ADULT_CARD_TITLE}
        </div>
        <div className="py-2 text-center text-[11px] leading-5">
          {ADULT_CARD_WELCOME.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>

        <div className="border-2 border-[#111]">
          {/* 이름 — 한글/영문 두 줄, 오른쪽에 세례여부 */}
          <div className="flex">
            <Label ko="*이 름" en="Name" className="w-[13%]" />
            <div className="min-w-0 flex-1 border-l border-[#111]">
              <div className="flex border-b border-[#111]">
                <Label ko="한글 (Korean)" en="" className="w-[38%]" small />
                <Box className="flex-1 border-l border-[#111]">
                  <TextBox value={value.name} onChange={(v) => onChange({ name: v })} />
                </Box>
              </div>
              <div className="flex">
                <Label ko="영문 (English)" en="" className="w-[38%]" small />
                <Box className="flex-1 border-l border-[#111]">
                  <TextBox value={value.nameEn} onChange={(v) => onChange({ nameEn: v })} />
                </Box>
              </div>
            </div>
            <Label ko="세례여부" en="Baptism" className="w-[13%] border-l border-[#111]" />
            <Box className="w-[22%] border-l border-[#111]">
              <TextBox value={value.baptismStatus} onChange={(v) => onChange({ baptismStatus: v })} />
            </Box>
          </div>

          {/* 생년월일 · 성별 */}
          <div className="flex border-t border-[#111]">
            <Label ko="*생년월일" en="Date of Birth" className="w-[13%]" />
            <Box className="flex-1 border-l border-[#111]">
              <BirthBoxes value={value.birthDate} onChange={(v) => onChange({ birthDate: v })} />
            </Box>
            <Label ko="성별" en="Gender" className="w-[11%] border-l border-[#111]" />
            <div className="flex w-[26%] border-l border-[#111]">
              <Box className="flex-1">
                <Paren on={value.gender === '남'} onClick={() => onChange({ gender: value.gender === '남' ? '' : '남' })} ko="남" en="Male" />
              </Box>
              <Box className="flex-1 border-l border-[#111]">
                <Paren on={value.gender === '여'} onClick={() => onChange({ gender: value.gender === '여' ? '' : '여' })} ko="여" en="Female" />
              </Box>
            </div>
          </div>

          {/* 전화번호 */}
          <div className="flex border-t border-[#111]">
            <Label ko="*전화번호" en="Phone Number" className="w-[13%]" />
            <Label ko="휴대폰" en="Cell phone" className="w-[12%] border-l border-[#111]" small />
            <Box className="flex-1 border-l border-[#111]">
              <TextBox
                value={value.phone}
                onChange={(v) => onChange({ phone: v })}
                onBlur={() => onChange({ phone: formatPhoneNumber(value.phone) })}
                inputMode="tel"
              />
            </Box>
            <Label ko="집/기타" en="Home/Others" className="w-[12%] border-l border-[#111]" small />
            <Box className="w-[26%] border-l border-[#111]">
              <TextBox
                value={value.phoneHome}
                onChange={(v) => onChange({ phoneHome: v })}
                onBlur={() => onChange({ phoneHome: formatPhoneNumber(value.phoneHome) })}
                inputMode="tel"
              />
            </Box>
          </div>

          {/* 이메일 — 종이에서는 한 줄 통째로 (카톡 번호를 적는 사람도 있다) */}
          <div className="flex border-t border-[#111]">
            <Label ko="*이메일" en="E-mail" className="w-[13%]" />
            <Box className="flex-1 border-l border-[#111]">
              <TextBox value={value.email} onChange={(v) => onChange({ email: v })} />
            </Box>
          </div>

          {/* 참석동기 + 직장/학교명 */}
          <div className="flex border-t border-[#111]">
            <Label ko="*참석동기" en="Reason for attending" className="w-[13%]" />
            {ATTEND_REASONS.map((r) => (
              <Box key={r.key} className="flex-1 border-l border-[#111]">
                <Paren
                  on={value.attendReason === r.key}
                  onClick={() => onChange({ attendReason: value.attendReason === r.key ? '' : r.key })}
                  ko={r.label}
                  en={r.en}
                />
              </Box>
            ))}
            <Label ko="직장 또는 학교명" en="Name of company/school" className="w-[17%] border-l border-[#111]" small />
            <Box className="w-[16%] border-l border-[#111]">
              <TextBox value={value.schoolOrWork} onChange={(v) => onChange({ schoolOrWork: v })} />
            </Box>
          </div>

          {/* 교회등록 여부 */}
          <div className="flex border-t border-[#111]">
            <Label ko="*교회등록 여부" en="Registration" className="w-[13%]" />
            {REGISTRATION_CHOICES.map((c) => (
              <div key={c.key} className="flex min-w-0 flex-1 border-l border-[#111]">
                <Label ko={c.label} en={c.en} className="min-w-0 flex-1" small />
                <Box className="w-14 border-l border-[#111]">
                  <Paren
                    on={value.registrationChoice === c.key}
                    onClick={() =>
                      onChange({ registrationChoice: value.registrationChoice === c.key ? '' : c.key })
                    }
                  />
                </Box>
              </div>
            ))}
          </div>

          {/* 주소 안내 + 주소 */}
          <div className="border-t border-[#111] py-1.5 text-center text-[11px] leading-4">
            {ADULT_CARD_ADDRESS_NOTE.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <div className="flex border-t border-[#111]">
            <Label ko="주소" en="Address" className="w-[13%]" />
            <Box className="flex-1 border-l border-[#111]">
              <TextBox value={value.address} onChange={(v) => onChange({ address: v })} />
            </Box>
          </div>
          <div className="flex border-t border-[#111]">
            <div className="w-[13%]" />
            <Label ko="City" en="" className="w-[10%] border-l border-[#111]" small />
            <Box className="flex-1 border-l border-[#111]">
              <TextBox value={value.city} onChange={(v) => onChange({ city: v })} />
            </Box>
            <Label ko="State" en="" className="w-[10%] border-l border-[#111]" small />
            <Box className="w-[14%] border-l border-[#111]">
              <TextBox value={value.state} onChange={(v) => onChange({ state: v })} />
            </Box>
            <Label ko="Zip code" en="" className="w-[12%] border-l border-[#111]" small />
            <Box className="w-[14%] border-l border-[#111]">
              <TextBox value={value.zipCode} onChange={(v) => onChange({ zipCode: v })} inputMode="numeric" />
            </Box>
          </div>
        </div>

        {/* 동행가족 — 종이에서는 아래에 따로 놓인 표, 다섯 줄 */}
        <div className="mt-4 border-2 border-[#111]">
          <div className="grid grid-cols-[0.9fr_1.2fr_1.2fr_0.9fr_1.2fr_0.7fr_0.9fr]">
            <HeadCell ko="동행가족" en="Accompany" />
            <HeadCell ko="이름 (한글)" en="Name (Korean)" bordered />
            <HeadCell ko="이름 (영어)" en="Name (English)" bordered />
            <HeadCell ko="관계" en="Relation" bordered />
            <HeadCell ko="생년월일" en="Date of Birth" bordered />
            <HeadCell ko="성별" en="Gender" bordered />
            <HeadCell ko="세례여부" en="Baptism" bordered />
          </div>
          {value.family.map((row, i) => (
            <div key={i} className="grid grid-cols-[0.9fr_1.2fr_1.2fr_0.9fr_1.2fr_0.7fr_0.9fr] border-t border-[#111]">
              <div className="grid place-items-center py-1.5 text-[12px] font-semibold">{i + 1}</div>
              <Box className="border-l border-[#111]">
                <TextBox value={row.nameKo} onChange={(v) => setFamily(i, { nameKo: v })} />
              </Box>
              <Box className="border-l border-[#111]">
                <TextBox value={row.nameEn} onChange={(v) => setFamily(i, { nameEn: v })} />
              </Box>
              <Box className="border-l border-[#111]">
                <TextBox value={row.relation} onChange={(v) => setFamily(i, { relation: v })} />
              </Box>
              <Box className="border-l border-[#111]">
                <DateBox value={row.birthDate} onChange={(v) => setFamily(i, { birthDate: v })} />
              </Box>
              <Box className="border-l border-[#111]">
                <TextBox value={row.gender} onChange={(v) => setFamily(i, { gender: v })} />
              </Box>
              <Box className="border-l border-[#111]">
                <TextBox value={row.baptism} onChange={(v) => setFamily(i, { baptism: v })} />
              </Box>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ family: [...value.family, blankFamilyMember()] })}
            className="w-full border-t border-[#111] bg-[#f7f7f7] py-1.5 text-[11px] font-semibold text-[#333] hover:bg-[#efefef]"
          >
            + 가족 한 줄 더
          </button>
        </div>

        {/* 꼬리말 — 종이의 교회 이름 */}
        <div className="mt-4 border-t-2 border-[#111] pt-2 text-center leading-tight">
          <div className="font-display text-base font-bold">{ADULT_CARD_FOOTER[0]}</div>
          <div className="text-[13px]">{ADULT_CARD_FOOTER[1]}</div>
        </div>
      </div>
    </div>
  )
}

// 칸 이름 — 종이처럼 한글 위, 영문 아래.
function Label({
  ko,
  en,
  className = '',
  small = false,
}: {
  ko: string
  en: string
  className?: string
  small?: boolean
}) {
  return (
    <div className={'grid place-items-center px-1.5 py-1.5 text-center leading-tight ' + className}>
      <div>
        <div className={small ? 'text-[11px] font-semibold' : 'text-[12px] font-bold'}>{ko}</div>
        {en && <div className="text-[9px] text-[#444]">{en}</div>}
      </div>
    </div>
  )
}

function Box({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'min-w-0 px-1.5 py-1.5 ' + className}>{children}</div>
}

function HeadCell({ ko, en, bordered = false }: { ko: string; en: string; bordered?: boolean }) {
  return (
    <div className={'px-1.5 py-1.5 text-center leading-tight ' + (bordered ? 'border-l border-[#111]' : '')}>
      <div className="text-[11px] font-bold">{ko}</div>
      <div className="text-[9px] text-[#444]">{en}</div>
    </div>
  )
}

// 종이의 ( ) 칸. 눌러서 표시하고, 이름이 붙는 자리(성별·참석동기)에는 라벨도 함께 그린다.
function Paren({ on, onClick, ko, en }: { on: boolean; onClick: () => void; ko?: string; en?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className="flex w-full items-center justify-center gap-1 leading-tight">
      {ko && (
        <span className="text-center">
          <span className="block text-[11px] font-semibold">{ko}</span>
          {en && <span className="block text-[9px] text-[#444]">{en}</span>}
        </span>
      )}
      <span className="text-[13px] font-semibold">({on ? '✓' : '  '})</span>
    </button>
  )
}

const BOX =
  'w-full border-0 border-b border-dotted border-[#999] bg-transparent px-0 py-0.5 text-[13px] text-[#111] outline-none focus:border-solid focus:border-[#111]'

function TextBox({
  value,
  onChange,
  className = '',
  ...rest
}: { value: string; onChange: (v: string) => void; className?: string } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'className'
>) {
  return <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={BOX + ' ' + className} />
}

function DateBox({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={BOX + ' ' + className} />
}

// 생년월일 — 종이가 년 / 월 / 일 세 칸으로 받으므로 그대로 셋으로 그린다. 셋이 다 차야
// 날짜가 되므로(DB의 birth_date는 날짜다), 하나라도 비면 저장하지 않고 화면에만 남는다.
function BirthBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y = '', m = '', d = ''] = value ? value.split('-') : []
  const set = (part: 'y' | 'm' | 'd', raw: string) => {
    const next = { y, m, d, [part]: raw.replace(/\D/g, '') }
    const yy = next.y.slice(0, 4)
    const mm = next.m.slice(0, 2)
    const dd = next.d.slice(0, 2)
    onChange(yy.length === 4 && mm && dd ? `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : [yy, mm, dd].join('-'))
  }
  return (
    <div className="flex items-center gap-1 text-[11px]">
      <TextBox value={y} onChange={(v) => set('y', v)} inputMode="numeric" className="w-14" aria-label="생년월일 년" />
      <span className="shrink-0">년(Y)</span>
      <TextBox value={m} onChange={(v) => set('m', v)} inputMode="numeric" className="w-9" aria-label="생년월일 월" />
      <span className="shrink-0">월(M)</span>
      <TextBox value={d} onChange={(v) => set('d', v)} inputMode="numeric" className="w-9" aria-label="생년월일 일" />
      <span className="shrink-0">일(D)</span>
    </div>
  )
}

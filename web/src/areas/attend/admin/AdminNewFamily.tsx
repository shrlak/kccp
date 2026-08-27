import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'
import { easternNow } from '../../../lib/checkinWindow'
import { filterMembers, NO_FILTER, type Filter } from './filters'
import { semesterKey, newFamilyBySemester, monthlyRegistrations, newFamilyWeek } from './newFamily'
import { NewFamilyWeekChip } from './NewFamilyWeekChip'
import { copyNewFamilyCards, saveNewFamilyCards } from './newFamilyCardImage'
import { applyFontSize, newFamilySheets, newFamilyHeader } from './exports'
import { toggleId } from './bulk'
import { GroupFilter } from './GroupFilter'
import { configCalendar, type Member } from '../../../lib/api'
import { seasonName, usesSemesters, type Season } from '../../../lib/partition'
import { Dialog } from '../../../components/ui/Dialog'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import { Tag } from '../../../components/ui/Tag'
import { useToast } from '../../../components/ui/Toast'
import { ScanLine, Download, Search, HandHeart, Heart, Calendar, GraduationCap, AlertTriangle, QrCode, Copy } from '../../../components/ui/Icon'
import { prefetchExcel } from '../../../app/prefetch'
import { EditModal, AttendanceModal } from './MemberDialogs'
import { CardScanDialog } from './CardScanDialog'
import { KakaoQrDialog } from './KakaoQrDialog'
import { classifyKakaoId } from './contactQr'
import { copyToClipboard } from '../../../lib/clipboard'
import { useAppConfig, usePartition } from '../../../lib/useAppConfig'

// 새가족 (new-family) tab: registration tracking — current-semester new members grouped
// by 등록일, a monthly-registrations roll-up, card-photo registration, and export.
// Education tracking (1·2주차) lives on the dedicated 새가족 교육 tab.
// Visible to every admin.
export function AdminNewFamily() {
  const { t, i18n } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useAppConfig()
  const partition = usePartition()
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  if (isLoading) return (
    <div className="fx-fade grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => <div key={i} className="fx-skeleton h-24 rounded-2xl" />)}
    </div>
  )
  if (isError) return (
    <div className="fx-rise grid place-items-center py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-danger">{t('common.error')}</p>
    </div>
  )
  if (!data) return null

  const lang = i18n.language === 'en' ? 'en' : 'ko'
  // 토막 이름: 대학·청년부는 예전 그대로 번역 키("2026 여름학기"), 장년부는 학기가 없으므로
  // 상반기/하반기 (partition.ts seasonName).
  const termName = (season: Season) =>
    usesSemesters(partition) ? t(`admin.newfamily.season.${season}`) : seasonName(season, partition, lang)
  const today = easternNow().date
  const scopedMembers = filterMembers(data.members, filter)
  // 학기별 섹션: 이번 학기 + 아직 새가족 교육이 끝나지 않아 넘어온 이전 학기들.
  const semesters = newFamilyBySemester(scopedMembers, today, configCalendar(cfg), partition)
  const allNewFamily = semesters.flatMap((s) => s.dates.flatMap((g) => g.members))
  const total = allNewFamily.length
  const carriedOver = semesters.filter((s) => !s.current).reduce((n, s) => n + s.total, 0)
  const months = monthlyRegistrations(scopedMembers)
  // 이번 주일 등록 vs 지난주 등록 — the two cohorts the 새가족팀 works with on a Sunday.
  const thisWeekCount = allNewFamily.filter((m) => newFamilyWeek(m.registration_date, today) === 'thisWeek').length
  const lastWeekCount = allNewFamily.filter((m) => newFamilyWeek(m.registration_date, today) === 'lastWeek').length
  const [, season] = semesterKey(today, configCalendar(cfg), partition).split('-')
  const year = semesterKey(today, configCalendar(cfg), partition).split('-')[0]
  const readOnly = data.role === 'pastor'

  return (
    <>
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />

      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Heart className="size-3.5" aria-hidden />
          {year} {termName(season as Season)}
        </span>
        <span className="section-kicker">
          {t('admin.newfamily.title')} · {total}
        </span>
        {thisWeekCount > 0 && <NewFamilyWeekChip week="thisWeek" count={thisWeekCount} />}
        {lastWeekCount > 0 && <NewFamilyWeekChip week="lastWeek" count={lastWeekCount} />}
        {carriedOver > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-xs font-semibold text-muted">
            <GraduationCap className="size-3.5" aria-hidden />
            {t('admin.newfamily.carriedOverCount', { n: carriedOver })}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {/* 카톡 추가 — 고른 새가족을 연락처 QR로 늘어놓는다 (KakaoQrDialog 머리말 참고).
              읽기 전용인 목사님에게도 보인다: 연락처를 받아 가는 것은 명단을 바꾸지 않는다. */}
          <Button variant="secondary" size="sm" onClick={() => setQrOpen(true)}>
            <QrCode className="size-4" aria-hidden />
            {t('admin.kakaoQr.action')}
          </Button>
          {!readOnly && (
            <Button variant="secondary" size="sm" onClick={() => setScanOpen(true)}>
              <ScanLine className="size-4" aria-hidden />
              {t('admin.newfamily.scan.action')}
            </Button>
          )}
          {/* Same as the 출석부 menu: opening the confirm dialog starts SheetJS downloading,
              so the actual export doesn't wait on the library. */}
          <Button variant="secondary" size="sm" onClick={() => { prefetchExcel(); setExportOpen(true) }}>
            <Download className="size-4" aria-hidden />
            {t('admin.newfamily.export.action')}
          </Button>
        </div>
      </div>
      {/* Legend for the card badge below + why an earlier term's 새가족 are still listed */}
      <p className="mb-3 text-xs text-subtle">
        {t('admin.newfamily.legend')} · {t('admin.newfamily.carryOverLegend')}
      </p>

      {semesters.length === 0 ? (
        <div className="fx-rise grid place-items-center rounded-2xl border border-dashed border-border py-14 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-fill text-subtle"><Heart className="size-6" aria-hidden /></div>
          <p className="mt-4 text-sm font-semibold text-muted">{t('admin.newfamily.empty')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {semesters.map((s) => (
            // 학기 이름을 붙인 랜드마크 — 이번 학기 섹션은 머리글이 없으므로 (위쪽 학기
            // 칩이 대신한다) 스크린리더에는 이 이름표가 유일한 구분점이다.
            <section key={s.key} aria-label={`${s.year} ${termName(s.season)}`}>
              {/* 이번 학기는 위쪽 학기 칩이 이미 이름표 역할을 하므로 머리글 없이 그대로 —
                  넘어온 이전 학기만 학기 이름을 달고 따로 묶인다. */}
              {!s.current && (
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b-2 border-separator pb-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
                    <GraduationCap className="size-4 text-subtle" aria-hidden />
                    {s.year} {termName(s.season)}
                  </span>
                  <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{s.total}</span>
                </div>
              )}
              <div className="flex flex-col gap-6">
                {s.dates.map((g) => (
                  <div key={g.date ?? 'no-date'} className="fx-rise">
                    <div className="mb-2.5 flex items-center gap-2 border-b border-separator pb-2">
                      {g.date ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-text"><Calendar className="size-4 text-subtle" aria-hidden />{g.date}</span>
                      ) : (
                        <span className="text-sm font-semibold text-warning">{t('admin.newfamily.noRegDate')}</span>
                      )}
                      <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{g.members.length}</span>
                      {/* 이번 주일 / 지난주에 등록한 그룹만 표시 — 그 이전 등록일은 날짜만으로 충분. */}
                      <NewFamilyWeekChip week={newFamilyWeek(g.date, today)} />
                    </div>
                    {/* 한 줄에 여섯 명. 등록일마다 블록이 나뉘므로 줄이 짧을수록 스크롤이
                        길어진다 — 노트북(lg)부터 여섯 칸으로 채운다. 폰에서까지 여섯으로
                        가르지는 않는다: 이름·부서·전화가 한 칸에 들어가지 못해 여섯 명이
                        보이는 대신 아무것도 못 읽게 된다. */}
                    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                      {g.members.map((m) => (
                        <NewFamilyCard key={m.id} member={m} onOpen={() => setEditing(m)} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {months.length > 0 && (
        <div className="mt-8 border-t border-separator pt-5">
          <div className="mb-3 section-kicker">{t('admin.newfamily.monthly')}</div>
          <div className="flex flex-col gap-4">
            {months.map((g) => (
              <div key={g.month}>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
                  {g.month}
                  <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{g.members.length}</span>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {g.members.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setEditing(m)}
                        className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-[background-color,border-color,color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:border-primary/30 hover:bg-fill hover:text-text active:scale-95"
                      >
                        {m.name}
                        {[m.group_name, m.subgroup].filter(Boolean).length ? (
                          <span className="ml-1 text-subtle">· {[m.group_name, m.subgroup].filter(Boolean).join(' ')}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {exportOpen && <ExportModal members={allNewFamily} today={today} onClose={() => setExportOpen(false)} />}
      {scanOpen && <CardScanDialog open onClose={() => setScanOpen(false)} />}
      {qrOpen && <KakaoQrDialog members={allNewFamily} today={today} onClose={() => setQrOpen(false)} />}

      {editing && (
        <EditModal
          member={editing}
          onClose={() => setEditing(null)}
          onAttendance={() => {
            setAttendanceFor(editing)
            setEditing(null)
          }}
        />
      )}
      {attendanceFor && (
        <AttendanceModal
          member={attendanceFor}
          log={data.log}
          readOnly={readOnly}
          onClose={() => setAttendanceFor(null)}
        />
      )}
    </>
  )
}

// 새가족 정보를 교회가 쓰는 '대청 새가족 리스트' 스프레드시트와 같은 모양(부서별 탭, 파란
// 머리줄, 성별 색칠, 10개 열)으로 내보낸다. XLSX.writeFile이 유일한 DOM 부수효과 — 행·색
// 구성은 순수 함수 (newFamilySheets, ./exports)에 있다.
async function exportNewFamilyExcel(members: Member[], today: string): Promise<void> {
  const XLSX = await import('xlsx-js-style')
  const wb = XLSX.utils.book_new()
  // 이름 / 등록일 / 성별 / 생년월일 / 전화번호 / 이메일·카톡아이디 / 학교·직장 / 세례 / 목사님 심방 / 노트
  const colWidths = [14, 11, 7, 11, 14, 24, 26, 18, 11, 26].map((wch) => ({ wch }))
  const cols = newFamilyHeader().length
  for (const { name, aoa, fills } of newFamilySheets(members)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // 시트는 모든 칸이 가운데 정렬이다. 등록일(열 1)·생년월일(열 3)은 템플릿과 같은 실제
    // 날짜 셀 — 글자로 내보내면 시트에서 정렬도 계산도 되지 않는다.
    for (let r = 0; r < aoa.length; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (!cell) continue
        cell.s = { alignment: { horizontal: 'center', vertical: 'center' } }
        if ((c === 1 || c === 3) && cell.t === 'n') cell.z = 'm/d/yyyy'
      }
    }
    // 시트와 같은 색 — 머리줄 파랑(굵게), 성별 칸 남 연파랑 / 여 연분홍.
    for (const f of fills) {
      const addr = XLSX.utils.encode_cell({ r: f.r, c: f.c })
      const cell = ws[addr] ?? (ws[addr] = { t: 's', v: '' })
      cell.s = {
        ...cell.s,
        fill: { patternType: 'solid', fgColor: { rgb: f.rgb } },
        ...(f.r === 0 ? { font: { name: 'Arial', bold: true } } : {}),
      }
    }
    // 글자 크기는 맨 마지막에 — 머리줄의 Arial/굵게는 그대로 두고 크기만 얹는다.
    applyFontSize(ws)
    ws['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  XLSX.writeFile(wb, `새가족등록정보-${today}.xlsx`)
}

// Pick which 새가족 to export — as 등록 카드 JPGs, or as an Excel roster. Lists the whole
// current-semester tab (name-searchable), with today's registrations pre-checked — the
// previous "export today" behavior stays the default, but any subset of the semester can
// be chosen. Both actions share the same selection so there's one selection UI, not two.
function ExportModal({ members, today, onClose }: { members: Member[]; today: string; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(members.filter((m) => m.registration_date === today).map((m) => m.id)),
  )
  const [busy, setBusy] = useState<'cardsCopy' | 'cardsSave' | 'excel' | null>(null)

  const q = search.trim().toLowerCase()
  const visible = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members
  // 카드·QR은 탭의 표시 순서(최신 등록 먼저) 그대로 나간다. 엑셀만은 시트에 맞춰
  // 등록일 오름차순으로 다시 정렬한다 (exports.ts newFamilySheets).
  const chosen = () => members.filter((m) => selected.has(m.id))

  async function confirmCopyCards() {
    const list = chosen()
    if (!list.length) return
    setBusy('cardsCopy')
    try {
      const { copied } = await copyNewFamilyCards(list)
      toast({ title: t(copied ? 'admin.mergedCopy.cardsDone' : 'admin.kakaoQr.copyFailed'), tone: copied ? 'ok' : 'err' })
    } catch {
      toast({ title: t('admin.newfamily.export.cardsSaveFailed'), tone: 'err' })
    }
    onClose()
  }

  async function confirmSaveCards() {
    const list = chosen()
    if (!list.length) return
    setBusy('cardsSave')
    try {
      await saveNewFamilyCards(list, today)
      toast({ title: t('admin.newfamily.export.cardsSaveDone'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.newfamily.export.cardsSaveFailed'), tone: 'err' })
    }
    onClose()
  }

  async function confirmExcel() {
    const list = chosen()
    if (!list.length) return
    setBusy('excel')
    try {
      await exportNewFamilyExcel(list, today)
      toast({ title: t('admin.newfamily.export.excelDone'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.newfamily.export.excelFailed'), tone: 'err' })
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.newfamily.export.title')}>
      <p className="mb-3 text-sm text-muted">{t('admin.newfamily.export.select')}</p>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.members.search')}
          aria-label={t('admin.members.search')}
          className="pl-10"
        />
      </div>
      <div className="mb-2 flex items-center justify-between">
        <span className="section-kicker">
          {t('admin.newfamily.export.selected', { n: selected.size })}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setSelected((cur) => new Set([...cur, ...visible.map((m) => m.id)]))}
            className="rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
          >
            {t('admin.newfamily.export.all')}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted hover:bg-fill"
          >
            {t('admin.newfamily.export.none')}
          </button>
        </div>
      </div>
      <ul className="flex max-h-[42vh] flex-col gap-1.5 overflow-y-auto pr-1">
        {visible.length === 0 && <li className="py-4 text-center text-sm text-muted">{t('admin.newfamily.export.noMatch')}</li>}
        {visible.map((m) => {
          const checked = selected.has(m.id)
          return (
          <li key={m.id}>
            <label className={'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ' + (checked ? 'border-primary/40 bg-primary/[0.06]' : 'border-border bg-surface hover:bg-fill')}>
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={checked}
                disabled={busy !== null}
                onChange={() => setSelected((cur) => toggleId(cur, m.id))}
              />
              <span className="font-medium text-text">{m.name}</span>
              <span className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ')}</span>
              {m.registration_date && (
                <span className="ml-auto tabular-nums text-[11px] text-subtle">{m.registration_date}</span>
              )}
            </label>
          </li>
          )
        })}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void confirmCopyCards()} disabled={busy !== null || selected.size === 0} className="flex-1 whitespace-pre-line text-center leading-tight">
          {busy === 'cardsCopy' ? t('admin.newfamily.export.cardsCopyBusy') : t('admin.newfamily.export.cardsCopyConfirm', { n: selected.size })}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void confirmSaveCards()}
          disabled={busy !== null || selected.size === 0}
          className="flex-1 whitespace-pre-line text-center leading-tight"
        >
          {busy === 'cardsSave' ? t('admin.newfamily.export.cardsSaveBusy') : t('admin.newfamily.export.cardsSaveConfirm', { n: selected.size })}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void confirmExcel()}
          disabled={busy !== null || selected.size === 0}
          className="flex-1 whitespace-pre-line text-center leading-tight"
        >
          {busy === 'excel' ? t('admin.newfamily.export.excelBusy') : t('admin.newfamily.export.excelConfirm', { n: selected.size })}
        </Button>
      </div>
    </Dialog>
  )
}

function NewFamilyCard({ member, onOpen }: { member: Member; onOpen: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  // 카톡 아이디는 여태 이 화면에 나오지 않았다 — 보려면 사람마다 편집 창을 열어야 했고,
  // 그러면서 손으로 옮겨 적었다. 탭 한 번으로 복사되면 그 왕복이 사라진다.
  const kakao = classifyKakaoId(member.kakao_id)

  return (
    <li className="rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow-sm)] transition-[box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-[var(--shadow)]">
      {/* Tap the card to open the member's full info/editor (feature parity with 멤버 탭).
          Education tracking (1·2주차) lives on the 새가족 교육 탭 — this card stays
          focused on registration info, with a read-only glance at their education
          status. */}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
          {member.name}
          {member.pastoral_visit_requested && (
            <HandHeart className="size-3.5 text-primary" aria-label={t('admin.newfamily.pastoralVisit')} />
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted">{[member.group_name, member.subgroup].filter(Boolean).join(' · ') || '—'}</div>
        {member.phone && <div className="text-xs text-subtle">{member.phone}</div>}
        {(member.new_member_edu_week1 || member.new_member_edu_week2) && (
          <div className="mt-1.5 flex gap-1">
            {member.new_member_edu_week1 && (
              <Tag tone="info" className="text-[10px]">{t('admin.iconKey.eduWeek1')}</Tag>
            )}
            {member.new_member_edu_week2 && (
              <Tag tone="info" className="text-[10px]">{t('admin.iconKey.eduWeek2')}</Tag>
            )}
          </div>
        )}
      </button>
      {/* 카드를 여는 버튼 밖에 둔다 — 안에 넣으면 복사 탭이 편집 창까지 같이 연다.
          고정폭 글꼴은 장식이 아니다: 아이디는 사전이 없어 l/I/1, O/0을 눈으로만 갈라야 한다. */}
      {kakao.kind !== 'none' && (
        <button
          type="button"
          onClick={() => void copyToClipboard(kakao.raw).then((ok) =>
            toast({ title: t(ok ? 'admin.kakaoQr.idCopied' : 'admin.kakaoQr.copyFailed'), tone: ok ? 'ok' : 'err' }),
          )}
          className="mt-1.5 flex w-full items-center gap-1 rounded-lg bg-fill px-1.5 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-fill-hover hover:text-text"
          title={t('admin.kakaoQr.copyOne')}
        >
          <Copy className="size-3 shrink-0 text-subtle" aria-hidden />
          <span className="truncate">{kakao.raw}</span>
        </button>
      )}
    </li>
  )
}

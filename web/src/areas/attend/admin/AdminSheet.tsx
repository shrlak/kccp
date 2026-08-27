import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import {
  buildAttendanceModel,
  attendanceGroupBy,
  awayOn,
  blockColors,
  cssColor,
  exportSundays,
  semesterLabel,
  filterLabel,
  HEADER_TOTAL_FILL,
  KEY_FILL,
  NOTE_FILL,
  type Lang,
} from './exports'
import { addBulkAttendance, clearAttendance, configCalendar, type LogEntry, type Member, type RosterResponse } from '../../../lib/api'
import type { CalendarLike } from '../../../lib/semester'
import { easternNow } from '../../../lib/checkinWindow'
import { checkinCandidates } from './today'
import { memberIdsPresentOn, toggleId } from './bulk'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { orderByDongsanRole } from './dongsan'
import { useDongsanRole } from './useDongsanRole'
import { useUnitTerms } from '../../../lib/useAppConfig'
import { computeStats } from './stats'
import { GroupFilter } from './GroupFilter'
import { ExportMenu } from './ExportMenu'
import { ArchiveSection } from './ArchiveSection'
import { StatsBar } from './StatsBar'
import { Dialog } from '../../../components/ui/Dialog'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { Plus, Trash2, AlertTriangle, Search, Calendar, Check } from '../../../components/ui/Icon'
import { refreshRoster } from '../../../lib/live'
import { useAppConfig, usePartition } from '../../../lib/useAppConfig'

// Attendance spreadsheet: the Excel-style 출석부 grid — an on-screen replica of the exported
// "Attendance" sheet (color-coded 동산 blocks, O/X cells, 예배 총 출석 + 총 출석 rows) — plus a
// bulk attendance entry (any admin except pastor).
//
// 시간순 '기록' 화면은 없앴다. 표가 이미 같은 사실을 담고 있고(누가 어느 주일에 왔나) 기록은
// 그것을 한 번 더 늘어놓을 뿐이라, 두 화면을 같이 두면 어느 쪽이 정본인지가 흐려진다. 한 줄
// 단위로 봐야 할 때는 내보내기의 엑셀(전체 기록 시트)이 그 자리를 대신한다.
export function AdminSheet() {
  const { t, i18n } = useTranslation()
  const [bulk, setBulk] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useAppConfig()

  if (isLoading) return (
    <div className="fx-fade space-y-3">
      <div className="fx-skeleton h-16 rounded-2xl" />
      <div className="fx-skeleton h-64 rounded-2xl" />
    </div>
  )
  if (isError) return (
    <div className="fx-rise grid place-items-center py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-danger">{t('common.error')}</p>
    </div>
  )
  if (!data) return null

  const lang: Lang = i18n.language === 'en' ? 'en' : 'ko'
  const today = easternNow().date
  // `data.members` already has the 숨긴 멤버 taken out (useRoster), so every number and row
  // on this screen is about who is actually on the roster now.
  const members = filterMembers(data.members, filter)
  const fLog = filterLog(data.log, filter)
  // 동산모임 출석 (구글 시트 연동이 들어오기 전에는 비어 있다). 예배 출석과 같은 필터를
  // 거쳐야 부서/동산을 좁혔을 때 두 값이 같은 사람들의 것으로 남는다.
  const fDongsanLog = filterLog(data.dongsanLog ?? [], filter)
  const canBulk = data.role !== 'pastor'
  // 아카이브만은 숨긴 멤버까지 되돌려 넣는다: 이미 끝난 학기의 출석부는 그때 실제로 있던
  // 사람이 다 들어 있어야 하는 기록이고, 그 안에서 누구를 넣고 뺄지는 buildAttendanceModel의
  // 기간 규칙(awayForRange)이 학기별로 판단한다.
  const archiveMembers = filterMembers([...data.members, ...data.hiddenMembers], filter)

  return (
    <>
      <StatsBar stats={computeStats(members, fLog, today)} />
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap gap-2">
          <ExportMenu members={members} log={fLog} filter={filter} />
          {canBulk && (
            <Button variant="secondary" size="sm" onClick={() => setBulk(true)} disabled={data.members.length === 0}>
              <Plus className="size-4" aria-hidden />
              {t('admin.sheet.bulk.action')}
            </Button>
          )}
          {data.canClearAttendance && (
            <Button variant="danger" size="sm" onClick={() => setClearing(true)}>
              <Trash2 className="size-4" aria-hidden />
              {t('admin.sheet.clearAll.action')}
            </Button>
          )}
        </div>
      </div>
      <GridView
        members={members}
        log={fLog}
        dongsanLog={fDongsanLog}
        lang={lang}
        today={today}
        filter={filter}
        semesterDates={configCalendar(cfg)}
      />
      {/* Finished 학기 / 전환 기간 / 연도 출석부, downloadable — the tab's closing section. */}
      <ArchiveSection
        members={archiveMembers}
        log={fLog}
        filter={filter}
        today={today}
        lang={lang}
        semesterDates={configCalendar(cfg)}
        dongsanHistory={data.dongsanHistory}
      />
      {bulk && <BulkModal data={data} onClose={() => setBulk(false)} />}
      {clearing && <ClearDialog isSuper={data.role === 'super_admin'} onClose={() => setClearing(false)} />}
    </>
  )
}

function ClearDialog({ isSuper, onClose }: { isSuper: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      const res = await clearAttendance()
      if (res.status === 'cleared') {
        toast({ title: t('admin.sheet.clearAll.cleared'), tone: 'ok' })
        refreshRoster(qc)
      } else {
        toast({ title: t('admin.sheet.clearAll.requested'), tone: 'ok' })
      }
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.sheet.clearAll.title')}>
      <p className="flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-3 text-sm text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t(isSuper ? 'admin.sheet.clearAll.warnSuper' : 'admin.sheet.clearAll.warnRequest')}</span>
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={confirm} disabled={busy} className="flex-1">
          {busy ? t('common.loading') : t(isSuper ? 'admin.sheet.clearAll.confirm' : 'admin.sheet.clearAll.request')}
        </Button>
      </div>
    </Dialog>
  )
}

function BulkModal({ data, onClose }: { data: RosterResponse; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [date, setDate] = useState(easternNow().date)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const present = memberIdsPresentOn(data.log, date)
  // 한국 귀국 / 이주 중인 멤버는 출석부에서 숨기므로 일괄 출석 목록에도 올리지 않는다.
  const candidates = checkinCandidates(data.members.filter((m) => !awayOn(m, date)), search)
  const selectable = candidates.filter((m) => !present.has(m.id))

  function setDateReset(d: string) {
    setDate(d)
    setSelected(new Set()) // present-set changes with the date — start clean
  }

  async function submit() {
    if (selected.size === 0) return
    setSaving(true)
    try {
      const res = await addBulkAttendance([...selected], date)
      toast({ title: t('admin.sheet.bulk.done', { n: res.added }), tone: 'ok' })
      refreshRoster(qc)
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.sheet.bulk.title')}>
      <div className="mb-3 flex items-end gap-2">
        <label className="flex-1">
          <span className="field-label inline-flex items-center gap-1.5"><Calendar className="size-3.5" aria-hidden />{t('admin.sheet.bulk.date')}</span>
          <Input type="date" value={date} onChange={(e) => setDateReset(e.target.value)} />
        </label>
      </div>
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
          {t('admin.sheet.bulk.selected', { n: selected.size })}
        </span>
        <div className="flex gap-1">
          <button type="button" onClick={() => setSelected(new Set(selectable.map((m) => m.id)))} className="rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10">
            {t('admin.sheet.bulk.all')}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted hover:bg-fill">
            {t('admin.sheet.bulk.none')}
          </button>
        </div>
      </div>
      <ul className="flex max-h-[42vh] flex-col gap-1.5 overflow-y-auto pr-1">
        {candidates.length === 0 && <li className="py-4 text-center text-sm text-muted">{t('admin.today.manualCheckin.none')}</li>}
        {candidates.map((m) => {
          const here = present.has(m.id)
          const checked = here || selected.has(m.id)
          return (
            <li key={m.id}>
              <label
                className={
                  'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ' +
                  (here
                    ? 'border-success/30 bg-success/5 opacity-70'
                    : checked
                      ? 'cursor-pointer border-primary/40 bg-primary/[0.06]'
                      : 'cursor-pointer border-border bg-surface hover:bg-fill')
                }
              >
                <span className={'grid size-5 shrink-0 place-items-center rounded-full ' + (checked ? 'bg-primary text-primary-fg' : 'border border-border')}>
                  {checked && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  disabled={here || saving}
                  onChange={() => setSelected((cur) => toggleId(cur, m.id))}
                />
                <span className="font-medium text-text">{m.name}</span>
                <span className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ')}</span>
                {here && <Check className="ml-auto size-4 text-success" strokeWidth={3} aria-hidden />}
              </label>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} disabled={selected.size === 0 || saving} className="flex-1">
          {saving ? t('common.loading') : t('admin.sheet.bulk.confirm', { n: selected.size })}
        </Button>
      </div>
    </Dialog>
  )
}

// On-screen 출석부: an exact preview of the exported "Attendance" sheet. Members are split
// into color-coded 동산 blocks (green → blue → yellow → red), each a single date-header row
// over O = 출석 (green) / X = 결석 (red) cells — status marks (한국 귀국 / 이주 / 새가족 …)
// render as grey cells spanning the dates they cover, like the master sheet — a per-member
// 예배 총 출석 count and a 총 출석 totals row, opened by the KEY legend up top — see
// exports.ts (gridSheet / reportHtml) for the shared spine. Date columns are the term's
// worship Sundays. Each block lists its 동산지기 first, then 부동산지기, then the rest in
// roster order, with the leaders' name cells bolded + highlighted (no icon).
const CELL = 'whitespace-nowrap border border-[#b7b7b7] px-3 py-1.5'
// Variable-length cells (names, status notes) truncate instead of stretching their
// column, so every 동산 block's table keeps the same fixed-layout width.
const CLIP = 'overflow-hidden text-ellipsis'
// The 이름 column is pinned to the left edge of the horizontal scroll. `border-collapse`
// doesn't repaint a sticky cell's own right border reliably, so the column's separating
// edge is drawn as a box-shadow instead.
const STICKY_NAME = 'sticky left-0 z-[1] shadow-[1px_0_0_#b7b7b7]'
const DARK = '#1f2937'

// Fixed column widths (px), shared by every 동산 block so all tables end up the exact
// same overall width regardless of name/label lengths: 이름 · 예배 총 출석 · one per date.
// 날짜 칸은 헤더의 MM/DD/YYYY(시트와 같은 표기)가 이 글자 크기·좌우 여백에서 실제로
// 차지하는 만큼이다 — 이보다 좁게 적어 두면 표가 그 값을 지키지 못하고 저 혼자 넓어진다.
const NAME_COL = 160
const TOTAL_COL = 120
const DATE_COL = 112

// `table-layout: fixed`는 표의 너비가 정해져 있을 때만 colgroup의 값을 지킨다. 너비를
// 비워 두면 브라우저가 내용에 맞춰 다시 재므로, 긴 이름 하나가 그 블록의 이름 칸을 넓혀
// 셀마다 표 너비가 어긋났다 (칸이 서로 안 맞던 원인). 그래서 열 너비의 합을 표에 직접
// 적어 준다 — 모든 블록이 같은 수의 날짜 열을 그리므로 값도 하나로 같다.
function tableWidth(dates: number): number {
  return NAME_COL + TOTAL_COL + dates * DATE_COL
}

function GridView({
  members,
  log,
  dongsanLog,
  lang,
  today,
  filter,
  semesterDates,
}: {
  members: Member[]
  log: LogEntry[]
  dongsanLog: LogEntry[]
  lang: Lang
  today: string
  filter: Filter
  semesterDates?: CalendarLike
}) {
  const roleOf = useDongsanRole()
  const partition = usePartition()
  // 하위 단위를 뭐라 부르는지는 부서마다 다르다 — 대학·청년부는 동산·동산지기·부동산지기,
  // 장년부는 셀·셀장·부셀장 (lib/partition.ts unitTerms). 범례와 미지정 블록의 제목이 그것.
  const U = useUnitTerms(lang)
  const L =
    lang === 'ko'
      ? { name: '이름', memberTotal: '예배 총 출석', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', etc: '기타', leaderKey: U.leader, subleaderKey: U.subLeader, unassigned: U.unassigned, newFamily: '새가족', empty: '출석 기록이 없습니다', dongsanMeeting: `${U.unit}모임` }
      : { name: 'Name', memberTotal: 'Worship Total', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', etc: 'Other', leaderKey: U.leader, subleaderKey: U.subLeader, unassigned: U.unassigned, newFamily: 'New family', empty: 'No attendance records', dongsanMeeting: `${U.unit} meeting` }

  // 동산지기/부동산지기(셀장/부셀장) float to the top of their own block (roster order otherwise).
  const ordered = orderByDongsanRole(members, roleOf)
  const model = buildAttendanceModel(
    ordered,
    log,
    exportSundays(today, semesterDates, partition),
    today,
    { unassigned: L.unassigned, newFamily: L.newFamily },
    attendanceGroupBy(today, semesterDates, L.unassigned, partition),
    dongsanLog,
  )
  const hasDongsan = dongsanLog.length > 0
  const pink = cssColor(HEADER_TOTAL_FILL)
  const grey = cssColor(NOTE_FILL)

  if (model.sections.length === 0) return <p className="text-sm text-muted">{L.empty}</p>

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        {semesterLabel(today, lang, semesterDates, partition)} · {filterLabel(filter.group, filter.subgroup, lang)}
      </p>
      {/* Legend text uses theme tokens so it stays readable in dark mode; only the
          swatches keep the sheet's hardcoded paper palette. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-muted">
        <b className="rounded px-2.5 py-0.5 text-white" style={{ background: cssColor(KEY_FILL) }}>{L.key}</b>
        <span><b>O</b> {L.present}</span>
        <span><b>X</b> {L.absent}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: grey }} />
          {L.etc}
        </span>
        {/* 동산모임 표시는 시트 연동이 붙은 뒤에만 칸에 나타나므로, 범례도 그때만 보여준다. */}
        {hasDongsan && (
          <span className="inline-flex items-center gap-1">
            <b>O</b><sup className="text-[9px] font-bold opacity-70">O</sup>
            <span className="ml-0.5">{L.dongsanMeeting}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: '#FFF3C4' }} />
          <b>{L.leaderKey}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: '#FFF9E1' }} />
          <b>{L.subleaderKey}</b>
        </span>
      </div>
      {/* Only the tables scroll sideways — the caption and legend above stay put, where
          before they were dragged along inside the scroll area and slid off screen on a
          phone. The 이름 column is pinned so a row stays identifiable once the Sunday
          columns are scrolled past it. */}
      <div className="scroll-x flex flex-col gap-6 text-sm" style={{ color: DARK }}>
        {model.sections.map((s, si) => {
          const { light: lightArgb, medium: mediumArgb } = blockColors(si)
          const light = cssColor(lightArgb)
          const medium = cssColor(mediumArgb)
          return (
            <section key={s.subgroup} className="w-max">
              <h3 className="mb-1.5 inline-block rounded px-3 py-1 text-base font-bold" style={{ background: medium, color: DARK }}>
                {s.subgroup}
              </h3>
              <table className="table-fixed border-collapse bg-white" style={{ width: tableWidth(model.dateLabels.length) }}>
                <colgroup>
                  <col style={{ width: NAME_COL }} />
                  <col style={{ width: TOTAL_COL }} />
                  {model.dateLabels.map((d) => (
                    <col key={d} style={{ width: DATE_COL }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className={`${CELL} ${CLIP} ${STICKY_NAME} text-left font-bold`} style={{ background: light }}>{L.name}</th>
                    <th className={`${CELL} text-center font-bold`} style={{ background: pink }}>{L.memberTotal}</th>
                    {model.dateLabels.map((d) => (
                      <th key={d} className={`${CELL} text-center font-bold`} style={{ background: medium }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => {
                    const role = roleOf(r.member.name, r.member.group_name, r.member.subgroup || '')
                    return (
                    <tr key={r.member.id}>
                      {role ? (
                        // 동산지기 / 부동산지기: bold, warm-highlighted name cell (no icon). The
                        // grid is fixed light-scheme (hex fills) like the export, so hardcoded
                        // hex highlights are consistent here.
                        <td
                          className={`${CELL} ${CLIP} ${STICKY_NAME} text-left font-bold`}
                          style={{ background: role === '동산지기' ? '#FFF3C4' : '#FFF9E1' }}
                        >
                          {r.member.name}
                        </td>
                      ) : (
                        <td className={`${CELL} ${CLIP} ${STICKY_NAME} bg-white text-left font-medium`}>{r.member.name}</td>
                      )}
                      <td className={`${CELL} bg-white text-center font-bold`}>{r.total}</td>
                      {r.marks.map((c, di) => {
                        const d = model.dates[di]
                        // Status marks: one grey cell spanning the covered dates (master-sheet style).
                        if (c.kind === 'note')
                          return (
                            <td key={d} colSpan={c.span} className={`${CELL} ${CLIP} text-center`} style={{ background: grey }}>
                              {c.note}
                            </td>
                          )
                        if (c.kind === 'inNote') return null
                        // Pre-등록일자, upcoming Sundays and not-yet-entered dates render blank.
                        if (c.kind === 'blank') return <td key={d} className={`${CELL} bg-white`} />
                        const here = c.kind === 'present'
                        return (
                          <td
                            key={d}
                            className={`${CELL} bg-white text-center ${here ? 'font-bold text-[#16a34a]' : 'text-[#dc2626]'}`}
                          >
                            {here ? 'O' : 'X'}
                            {/* 동산모임은 예배와 다른 사실이라 같은 칸에 작게 덧붙는다 —
                                예배엔 못 왔지만 동산모임엔 온 주가 실제로 있다. 그날 동산모임을
                                아무도 적지 않았으면 아무것도 붙지 않는다. */}
                            {c.dongsan && (
                              <sup
                                className={`ml-0.5 text-[9px] font-bold ${c.dongsan === 'present' ? 'text-[#16a34a]' : 'text-[#dc2626]'} opacity-70`}
                                title={L.dongsanMeeting}
                              >
                                {c.dongsan === 'present' ? 'O' : 'X'}
                              </sup>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className={`${CELL} ${STICKY_NAME} text-left font-bold`} style={{ background: medium }}>{L.total}</td>
                    {model.dates.map((d, i) => (
                      <td key={d} className={`${CELL} bg-white text-center font-bold`}>
                        {s.totals[i]}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </section>
          )
        })}
      </div>
    </div>
  )
}

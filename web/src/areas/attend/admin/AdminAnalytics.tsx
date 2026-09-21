import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { GroupFilter } from './GroupFilter'
import { AnalyticsCharts, NewFamilyCharts } from './AnalyticsCharts'
import {
  monthlySummary,
  semesterSummary,
  weeklyRecap,
  recapText,
  excludeOnBreak,
  newFamilyMonthly,
  newFamilyTotals,
  RECENT_WEEKS,
  type SemesterRow,
  type NewFamilyTotals,
  type NewFamilyMonthRow,
} from './analytics'
import { semesterBounds } from './newFamily'
import { Button } from '../../../components/ui/Button'
import { StatTile } from './StatsBar'
import { useToast } from '../../../components/ui/Toast'
import { GraduationCap, Calendar, ListChecks, Copy, BarChart3, Sprout } from '../../../components/ui/Icon'
import { configCalendar, type Member, type LogEntry } from '../../../lib/api'
import { usePartition, usePartitionT, useAppConfig } from '../../../lib/useAppConfig'
import { easternNow } from '../../../lib/checkinWindow'

// Analytics tab: trend + group-comparison charts, monthly/semester summary tables, and
// a weekly recap — all derived client-side from the scoped roster and reactive to the
// shared 부서/동산 filter.
export function AdminAnalytics() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  // 숨긴 멤버는 useRoster가 이미 빼뒀다 — 이미 떠난 사람이 계속 결석으로 세여 출석률을
  // 끌어내리지 않는다. (방학은 excludeOnBreak가 따로 걷어낸다.)
  const members = filterMembers(data.members, filter)
  const log = excludeOnBreak(data.members, filterLog(data.log, filter))

  return (
    <>
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />
      <AnalyticsCharts members={members} log={log} />
      <div className="fx-rise grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <SemesterTable members={members} log={log} />
        <MonthlyTable members={members} log={log} />
        <WeeklyRecap log={log} />
      </div>
      <NewFamilySection members={members} log={log} />
    </>
  )
}

// ── 새가족만 따로 ────────────────────────────────────────────────────────────
// 위쪽 통계가 전체를 세는 자리라면 여기부터는 새가족만 센다 — 숫자 타일 · 등록/출석 추이
// 그래프 · 월별 표. 입력은 위와 같은(부서/동산 필터가 이미 걸린) members + log이므로 필터를
// 바꾸면 이 블록도 같이 좁혀진다.
function NewFamilySection({ members, log }: { members: Member[]; log: LogEntry[] }) {
  const { t } = useTranslation()
  const { data: cfg } = useAppConfig()
  const partition = usePartition()
  const today = easternNow().date
  // "이번 학기"의 경계. 부마다 한 해를 나누는 방식이 다르므로(장년부는 상·하반기) 판단은
  // newFamily.ts가 하고 통계는 그 결과만 받는다.
  const term = semesterBounds(today, configCalendar(cfg), partition)
  const totals = newFamilyTotals(members, log, term)
  const rows = newFamilyMonthly(members, log)
  // 장년부에는 새가족 교육이 없다 — 이수 타일도, 출석 추이의 단계별 칩도 그 부에서는 뜻이 없다.
  const showEdu = partition !== 'adult'

  return (
    <section className="fx-rise mt-6">
      <header className="mb-4 flex items-center gap-2">
        <span className="shrink-0 text-subtle">
          <Sprout size={16} strokeWidth={2} aria-hidden />
        </span>
        <h2 className="font-display text-lg font-bold tracking-tight text-text">{t('admin.newfamily.title')}</h2>
        {/* 등록일이 없는 새가족은 어느 달에도 놓을 수 없어 그래프와 월별 표에서 빠진다.
            숫자만 맞고 추이에 안 보이면 "왜 하나가 모자라지"가 되므로 여기서 밝혀 둔다. */}
        {totals.undated > 0 && (
          <span className="ml-auto text-xs text-muted">{t('admin.analytics.nfUndated', { n: totals.undated })}</span>
        )}
      </header>

      {totals.total === 0 ? (
        <section className="surface-panel p-5">
          <Empty />
        </section>
      ) : (
        <>
          <NewFamilyTiles totals={totals} showEdu={showEdu} />
          <NewFamilyCharts members={members} log={log} showEdu={showEdu} />
          <div className="mt-5">
            <NewFamilyMonthlyTable rows={rows} />
          </div>
        </>
      )}
    </section>
  )
}

// 숫자 넷(장년부는 셋 — 그 부에는 새가족 교육이 없다). 출석부 탭의 StatsBar와 같은 타일이다.
function NewFamilyTiles({ totals, showEdu }: { totals: NewFamilyTotals; showEdu: boolean }) {
  // 장년부에는 학기가 없어 "이번 학기 등록"이 "이번 반기 등록"이 된다 (nfThisTerm_adult).
  const t = usePartitionT()
  const items: { key: string; label: string; value: number; hint?: string }[] = [
    { key: 'total', label: t('admin.analytics.nfTotal'), value: totals.total },
    { key: 'term', label: t('admin.analytics.nfThisTerm'), value: totals.thisTerm },
    {
      key: 'recent',
      label: t('admin.analytics.nfRecent', { n: RECENT_WEEKS }),
      value: totals.recent,
      // 기록이 4주일보다 적으면 라벨의 "4주"가 거짓말이 되므로 실제로 센 주일 수를 적는다.
      hint: totals.recentWeeks < RECENT_WEEKS ? t('admin.analytics.nfWeeksCounted', { n: totals.recentWeeks }) : undefined,
    },
  ]
  if (showEdu) items.push({ key: 'edu', label: t('admin.analytics.nfEduDone'), value: totals.eduDone })

  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      {items.map(({ key, label, value, hint }) => (
        <StatTile key={key} label={label} value={value} hint={hint} />
      ))}
    </div>
  )
}

function NewFamilyMonthlyTable({ rows }: { rows: NewFamilyMonthRow[] }) {
  const { t } = useTranslation()
  return (
    <Section title={t('admin.analytics.nfMonthly')} icon={<Calendar size={15} strokeWidth={2} aria-hidden />}>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <SummaryTable
          head={[
            t('admin.analytics.month'),
            t('admin.analytics.nfRegistered'),
            t('admin.analytics.nfAttendees'),
            t('admin.analytics.nfShare'),
          ]}
          rows={rows.map((r) => ({
            key: r.month,
            cells: [r.month, r.registered, r.attendees, `${r.share}%`],
          }))}
        />
      )}
    </Section>
  )
}

function MonthlyTable({ members, log }: { members: Member[]; log: LogEntry[] }) {
  const { t } = useTranslation()
  const rows = monthlySummary(members, log)
  return (
    <Section title={t('admin.analytics.monthly')} icon={<Calendar size={15} strokeWidth={2} aria-hidden />}>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <SummaryTable
          head={[t('admin.analytics.month'), t('admin.analytics.sundays'), t('admin.analytics.attendees'), t('admin.analytics.firstVisits')]}
          rows={rows.map((r) => ({ key: r.month, cells: [r.month, r.sundays, r.attendees, r.firstVisits] }))}
        />
      )}
    </Section>
  )
}

function SemesterTable({ members, log }: { members: Member[]; log: LogEntry[] }) {
  const { t } = useTranslation()
  const rows = semesterSummary(members, log)
  return (
    <Section title={t('admin.analytics.semester')} icon={<GraduationCap size={15} strokeWidth={2} aria-hidden />}>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <SummaryTable
          head={[t('admin.analytics.semester'), t('admin.analytics.sundays'), t('admin.analytics.attendees'), t('admin.analytics.firstVisits')]}
          rows={rows.map((r) => ({ key: r.key, cells: [semesterLabel(r, t), r.sundays, r.attendees, r.firstVisits] }))}
        />
      )}
    </Section>
  )
}

// "2026 상반기" / "2026 Spring" (한국어), "2026 H1" / "2026 H2" via the i18n half label.
function semesterLabel(r: SemesterRow, t: (k: string) => string): string {
  return `${r.year} ${t(r.half === 1 ? 'admin.analytics.half1' : 'admin.analytics.half2')}`
}

function WeeklyRecap({ log }: { log: LogEntry[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const rows = weeklyRecap(log)

  async function copy() {
    try {
      await navigator.clipboard.writeText(recapText(rows))
      toast({ title: t('admin.analytics.copied'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    }
  }

  return (
    <Section
      title={t('admin.analytics.weeklyRecap')}
      icon={<ListChecks size={15} strokeWidth={2} aria-hidden />}
      action={
        rows.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={copy}>
            <Copy size={14} strokeWidth={2} aria-hidden />
            {t('admin.analytics.copy')}
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <SummaryTable
          head={[t('admin.analytics.date'), t('admin.analytics.attendance'), t('admin.analytics.firstVisits')]}
          rows={rows.map((r) => ({ key: r.date, cells: [r.date, r.attendance, r.firstVisits] }))}
        />
      )}
    </Section>
  )
}

function SummaryTable({ head, rows }: { head: string[]; rows: { key: string; cells: (string | number)[] }[] }) {
  return (
    <div className="scroll-x -mx-1">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={'px-3 pb-2 section-kicker ' + (i === 0 ? 'text-left' : 'text-right')}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-separator">
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={
                    'px-3 py-2.5 ' +
                    (i === 0 ? 'text-left font-semibold text-text' : 'text-right font-mono tabular-nums text-muted')
                  }
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="surface-panel p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-separator pb-3">
        {icon && <span className="shrink-0 text-subtle">{icon}</span>}
        <h3 className="font-display text-base font-bold tracking-tight text-text">{title}</h3>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-8 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-fill text-muted">
        <BarChart3 size={20} strokeWidth={1.75} aria-hidden />
      </span>
      <p className="text-sm text-muted">{t('admin.sheet.empty')}</p>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Chart as ChartType, ChartConfiguration, Plugin } from 'chart.js'
import { useTheme } from '../../../stores/useTheme'
import { shortDate, shortMonth } from './sheet'
import { trendSeries, groupSeries, newFamilyRegistrations, newFamilyTrend } from './analytics'
import { type Member, type LogEntry } from '../../../lib/api'
import { resolveGroupColor } from './groupColors'
import { Activity, BarChart3, Sprout, UserPlus } from '../../../components/ui/Icon'
import { Pill } from './GroupFilter'
import { type EduFilter } from './newFamily'
import { useAppConfig } from '../../../lib/useAppConfig'

// Inline plugin that prints each datapoint's value just above its dot on the trend
// line. `tick` is the theme-aware label color already resolved for the axes.
function pointValueLabels(tick: string): Plugin {
  return {
    id: 'pointValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart
      const meta = chart.getDatasetMeta(0)
      const data = chart.data.datasets[0]?.data ?? []
      ctx.save()
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = tick
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      meta.data.forEach((point, i) => {
        const value = data[i]
        if (value == null) return
        ctx.fillText(String(value), point.x, point.y - 6)
      })
      ctx.restore()
    },
  }
}

// Chart.js is loaded once, lazily, on first chart mount — it must never be in the
// initial bundle. registerables wires up the line/bar controllers, scales, etc.
let chartLib: Promise<typeof import('chart.js')> | null = null
function loadChart() {
  if (!chartLib) {
    chartLib = import('chart.js').then((mod) => {
      mod.Chart.register(...mod.registerables)
      return mod
    })
  }
  return chartLib
}

// A single <canvas> driven by a Chart.js config builder. The instance is recreated
// whenever the config (data) or theme changes, and destroyed on unmount.
export function ChartCanvas({ build }: { build: (tick: string, grid: string) => ChartConfiguration }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<ChartType | null>(null)
  const theme = useTheme((s) => s.theme)

  useEffect(() => {
    let cancelled = false
    const tick = theme === 'dark' ? '#9ca3af' : '#6b7280'
    const grid = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
    loadChart().then(({ Chart }) => {
      if (cancelled || !canvasRef.current) return
      chartRef.current?.destroy()
      chartRef.current = new Chart(canvasRef.current, build(tick, grid))
    })
    return () => {
      cancelled = true
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [build, theme])

  return <canvas ref={canvasRef} role="img" />
}

// 4.1 + 4.2 — trend line + (when more than one 부서 is in scope) the grouped bar chart.
export function AnalyticsCharts({ members, log }: { members: Member[]; log: LogEntry[] }) {
  const { t } = useTranslation()
  const { data: cfg } = useAppConfig()
  const trend = useMemo(() => trendSeries(log), [log])
  const groups = useMemo(() => groupSeries(members, log), [members, log])
  const showGroups = groups.groups.length > 1 && groups.dates.length > 0

  // Builders are memoized on their data so the chart only rebuilds when the underlying
  // series (or theme, handled inside ChartCanvas) actually changes.
  const trendBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'line',
      data: {
        labels: trend.map((p) => shortDate(p.date)),
        datasets: [
          {
            label: t('admin.analytics.attendance'),
            data: trend.map((p) => p.count),
            borderColor: '#0071E3',
            backgroundColor: 'rgba(0,113,227,0.12)',
            tension: 0.25,
            fill: true,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Headroom so the label drawn above the topmost point isn't clipped.
        layout: { padding: { top: 16 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
      // Inline plugin: draw each point's count just above its dot.
      plugins: [pointValueLabels(tick)],
    }),
    [trend, t],
  )

  const groupBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: groups.dates.map((d) => shortDate(d)),
        datasets: groups.groups.map((g) => ({
          label: g,
          data: groups.counts[g],
          backgroundColor: resolveGroupColor(cfg?.groupColors, g),
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tick } } },
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
    }),
    [cfg?.groupColors, groups],
  )

  if (trend.length === 0)
    return (
      <div className="fx-fade mb-5 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-2 py-16 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-fill text-muted">
          <Activity size={26} strokeWidth={1.75} aria-hidden />
        </span>
        <p className="text-sm font-semibold text-text">{t('admin.sheet.empty')}</p>
      </div>
    )

  return (
    <div className={'fx-rise mb-5 grid gap-5 ' + (showGroups ? 'md:grid-cols-2' : 'grid-cols-1')}>
      <Panel title={t('admin.analytics.trend')} icon={<Activity size={16} strokeWidth={2} aria-hidden />}>
        <ChartCanvas build={trendBuild} />
      </Panel>
      {showGroups && (
        <Panel title={t('admin.analytics.groupCompare')} icon={<BarChart3 size={16} strokeWidth={2} aria-hidden />}>
          <ChartCanvas build={groupBuild} />
        </Panel>
      )}
    </div>
  )
}

// 새가족 차트의 색. 전체 출석 추이의 파랑(#0071E3)과 갈라 보이도록 초록 하나로 두 그래프를
// 묶는다 — 등록과 출석은 다른 사실이지만 둘 다 "새가족의 것"이라는 표시다. 기존 차트처럼
// 테마별로 나누지 않는 중간 명도라 밝은 바탕과 어두운 바탕 양쪽에서 읽힌다.
const NEW_FAMILY_COLOR = '#2E9E63'
const NEW_FAMILY_TINT = 'rgba(46,158,99,0.14)'

// 새가족만 따로 본 두 그래프 — 월별 등록(막대)과 주일별 새가족 출석(선). 둘 다 값이 점/막대
// 위에 적히므로 그래프에서 바로 숫자를 읽을 수 있다.
export function NewFamilyCharts({
  members,
  log,
  showEdu,
}: {
  members: Member[]
  log: LogEntry[]
  showEdu: boolean
}) {
  const { t } = useTranslation()
  // 새가족 출석 추이를 새가족 교육 단계로 갈라 본다. 장년부에는 그 교육이 없으므로 칩도 없고
  // 언제나 '전체'다.
  const [edu, setEdu] = useState<EduFilter>('all')
  const cohort = showEdu ? edu : 'all'
  // 최근 12개월만 그린다. 그 앞은 아래 월별 표가 그대로 들고 있고, 막대가 스무 개를 넘으면
  // x축 이름이 겹쳐 읽히지 않는다.
  const regs = useMemo(() => newFamilyRegistrations(members).slice(-12), [members])
  const trend = useMemo(() => newFamilyTrend(members, log, cohort), [members, log, cohort])
  const cohortLabel = cohort === 'all' ? t('admin.analytics.nfAttendance') : t(`admin.newfamily.eduFilter.${cohort}`)

  const regBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: regs.map((p) => shortMonth(p.month)),
        datasets: [
          {
            label: t('admin.analytics.nfRegistered'),
            data: regs.map((p) => p.count),
            backgroundColor: NEW_FAMILY_COLOR,
            borderRadius: 4,
            maxBarThickness: 32,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tick }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
      plugins: [pointValueLabels(tick)],
    }),
    [regs, t],
  )

  const trendBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'line',
      data: {
        labels: trend.map((p) => shortDate(p.date)),
        datasets: [
          {
            label: cohortLabel,
            data: trend.map((p) => p.count),
            borderColor: NEW_FAMILY_COLOR,
            backgroundColor: NEW_FAMILY_TINT,
            tension: 0.25,
            fill: true,
            pointRadius: 3,
          },
          // 한 단계만 골랐을 때 그 뒤에 새가족 전체를 흐린 점선으로 깔아 준다 — 미수강 3명은
          // 새가족이 4명일 때와 40명일 때가 다른 사실이라, 고른 선만으로는 읽을 수 없다.
          ...(cohort === 'all'
            ? []
            : [
                {
                  label: t('admin.analytics.nfAllNewFamily'),
                  data: trend.map((p) => p.newFamily),
                  borderColor: tick,
                  borderDash: [4, 4],
                  borderWidth: 1.5,
                  tension: 0.25,
                  fill: false,
                  pointRadius: 0,
                },
              ]),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: {
          // 선이 둘일 때만 범례를 켠다 — 하나뿐이면 제목이 이미 그 이름이다.
          legend: { display: cohort !== 'all', labels: { color: tick, boxHeight: 1 } },
          // 점 위에 적히는 것은 인원수뿐이라, 그날 전체 출석 대비 비중은 눌렀을 때 나온다 —
          // 20명 중 5명과 200명 중 5명은 같은 5가 아니다.
          tooltip: {
            callbacks: {
              label: (item: { dataIndex: number; datasetIndex: number }) => {
                const p = trend[item.dataIndex]
                if (!p) return ''
                if (item.datasetIndex === 1) return `${t('admin.analytics.nfAllNewFamily')} ${p.newFamily}`
                const share = p.total === 0 ? 0 : Math.round((p.count / p.total) * 100)
                return `${cohortLabel} ${p.count} / ${p.total} (${share}%)`
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
      plugins: [pointValueLabels(tick)],
    }),
    [trend, t, cohort, cohortLabel],
  )

  if (regs.length === 0 && trend.length === 0) return null
  const both = regs.length > 0 && trend.length > 0

  return (
    <div className={'grid gap-5 ' + (both ? 'md:grid-cols-2' : 'grid-cols-1')}>
      {regs.length > 0 && (
        <Panel title={t('admin.analytics.nfRegTrend')} icon={<UserPlus size={16} strokeWidth={2} aria-hidden />}>
          <ChartCanvas build={regBuild} />
        </Panel>
      )}
      {trend.length > 0 && (
        <Panel
          title={t('admin.analytics.nfAttendTrend')}
          icon={<Sprout size={16} strokeWidth={2} aria-hidden />}
          toolbar={showEdu ? <EduPills value={edu} onChange={setEdu} /> : undefined}
        >
          <ChartCanvas build={trendBuild} />
        </Panel>
      )}
    </div>
  )
}

// 새가족 교육 단계 칩. 갈래와 문구는 새가족 교육 탭의 것을 그대로 쓴다 — 같은 네 갈래를
// 두 화면이 다르게 부르면 "1주차만"이 어디서는 다른 뜻인가 싶어진다.
const EDU_COHORTS: EduFilter[] = ['both', 'week1', 'week2', 'none']

function EduPills({ value, onChange }: { value: EduFilter; onChange: (v: EduFilter) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5">
      <Pill active={value === 'all'} onClick={() => onChange('all')}>
        {t('admin.filter.all')}
      </Pill>
      {EDU_COHORTS.map((key) => (
        <Pill key={key} active={value === key} onClick={() => onChange(key)}>
          {t(`admin.newfamily.eduFilter.${key}`)}
        </Pill>
      ))}
    </div>
  )
}

// `toolbar`는 제목 줄과 그래프 상자 **사이**에 놓인다 — 제목 오른쪽에 붙이면 칩 다섯 개가
// 좁은 화면에서 제목을 밀어낸다.
export function Panel({
  title,
  icon,
  toolbar,
  children,
}: {
  title: string
  icon: ReactNode
  toolbar?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="surface-panel p-5">
      <div className={'flex items-center gap-2 border-b border-separator pb-3 ' + (toolbar ? 'mb-3' : 'mb-4')}>
        <span className="shrink-0 text-subtle">{icon}</span>
        <h3 className="font-display text-base font-bold tracking-tight text-text">{title}</h3>
      </div>
      {toolbar && <div className="mb-3">{toolbar}</div>}
      <div className="relative h-56">{children}</div>
    </div>
  )
}

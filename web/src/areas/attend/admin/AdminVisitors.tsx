import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'
import { easternNow } from '../../../lib/checkinWindow'
import { visitorsByDate, visitCounts } from './visitors'
import { Tag } from '../../../components/ui/Tag'
import { DoorOpen, Calendar, Sparkles } from '../../../components/ui/Icon'

// 방문자 tab: every guest check-in — past and today — grouped by date, newest first.
// Visitors aren't members (they come from the kiosk/공용 방문자 check-in), so this reads
// straight from the attendance log. Visible to every admin; scoped leaders' rosters
// carry no guest rows, so they just see the empty state.
export function AdminVisitors() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <StateNote tone="muted">{t('common.loading')}</StateNote>
  if (isError) return <StateNote tone="danger">{t('common.error')}</StateNote>
  if (!data) return null

  const today = easternNow().date
  const groups = visitorsByDate(data.log)
  const counts = visitCounts(groups)
  const total = groups.reduce((n, g) => n + g.entries.length, 0)
  const todayCount = groups.find((g) => g.date === today)?.entries.length ?? 0

  return (
    <div className="fx-rise">
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat icon={<Calendar size={16} strokeWidth={2} aria-hidden />} tone="primary" label={t('admin.visitors.stats.today')} value={todayCount} />
        <Stat icon={<DoorOpen size={16} strokeWidth={2} aria-hidden />} tone="info" label={t('admin.visitors.stats.total')} value={total} />
        <Stat icon={<Sparkles size={16} strokeWidth={2} aria-hidden />} tone="gold" label={t('admin.visitors.stats.unique')} value={counts.size} />
      </div>

      {/* The stat cards above, the visit history below. */}
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
          <DoorOpen size={17} strokeWidth={2} aria-hidden />
        </span>
        <h3 className="font-display text-lg font-bold tracking-tight text-text">{t('admin.visitors.title')}</h3>
        <Tag tone="muted" className="tabular-nums">{total}</Tag>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={<DoorOpen size={26} strokeWidth={1.75} aria-hidden />} title={t('admin.visitors.empty')} />
      ) : (
        <div className="fx-stagger flex flex-col gap-6">
          {groups.map((g) => (
            <div key={g.date}>
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="font-display text-sm font-bold tabular-nums tracking-tight text-text">{g.date}</span>
                {g.date === today && <Tag tone="primary">{t('admin.visitors.today')}</Tag>}
                <span className="ml-auto text-xs font-semibold tabular-nums text-subtle">{g.entries.length}</span>
              </div>
              <ul className="inset-list">
                {g.entries.map((e) => (
                  <li key={`${e.name}-${e.ts}`} className="inset-row justify-between py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-bold text-primary">
                        {(e.name || '?').slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
                          <span className="truncate">{e.name}</span>
                          {(counts.get(e.name) ?? 0) > 1 && (
                            <Tag tone="info" className="shrink-0">
                              {t('admin.visitors.returning', { n: counts.get(e.name) })}
                            </Tag>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted">{e.group || '—'}</div>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-subtle">{e.time}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const STAT_TONES = {
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info/10 text-info',
  gold: 'bg-gold/15 text-gold',
} as const

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: keyof typeof STAT_TONES }) {
  return (
    <div className="surface-panel p-4">
      <span className={'grid h-8 w-8 place-items-center rounded-xl ' + STAT_TONES[tone]}>{icon}</span>
      <div className="mt-3 font-display text-2xl font-bold tabular-nums tracking-tight text-text sm:text-3xl">{value}</div>
      <div className="section-kicker mt-0.5">{label}</div>
    </div>
  )
}

function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="fx-fade flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-2 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-fill text-muted">{icon}</span>
      <p className="text-sm font-semibold text-text">{title}</p>
    </div>
  )
}

function StateNote({ children, tone }: { children: ReactNode; tone: 'muted' | 'danger' }) {
  return <p className={'py-8 text-center text-sm ' + (tone === 'danger' ? 'text-danger' : 'text-muted')}>{children}</p>
}

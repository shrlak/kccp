import { useTranslation } from 'react-i18next'
import type { Stats } from './stats'
import { CalendarCheck, Users, ClipboardList, type LucideIcon } from '../../../components/ui/Icon'

// The reactive stat tiles shown atop the Sheet tab, reflecting the active filter.
export function StatsBar({ stats }: { stats: Stats }) {
  const { t } = useTranslation()
  const items: { label: string; value: number; icon: LucideIcon }[] = [
    { label: t('admin.stats.today'), value: stats.today, icon: CalendarCheck },
    { label: t('admin.stats.members'), value: stats.members, icon: Users },
    { label: t('admin.stats.days'), value: stats.days, icon: ClipboardList },
  ]
  return (
    <div className="mb-5 grid grid-cols-3 gap-2.5 sm:gap-3">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="surface-panel flex flex-col p-4 sm:p-5">
          <span className="mb-3 grid size-8 place-items-center rounded-full bg-fill text-muted">
            <Icon className="size-4" strokeWidth={2} aria-hidden />
          </span>
          <div className="font-display text-3xl font-bold tabular-nums tracking-tight text-text sm:text-4xl">{value}</div>
          <div className="section-kicker mt-1 leading-4">{label}</div>
        </div>
      ))}
    </div>
  )
}

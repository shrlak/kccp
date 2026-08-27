import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { Member } from '../../../lib/api'
import { groupsOf, subgroupsOf, type Filter } from './filters'

// Shared 부서 → 동산 pill filter for the Today/Sheet tabs. Renders nothing when the
// scoped roster has only one group and one 동산 (e.g. a 동산 leader — already pinned).
export function GroupFilter({ members, value, onChange }: { members: Member[]; value: Filter; onChange: (f: Filter) => void }) {
  const { t } = useTranslation()
  const groups = groupsOf(members)
  const subgroups = subgroupsOf(members, value.group)
  if (groups.length <= 1 && subgroups.length <= 1) return null

  return (
    <div className="mb-5 flex flex-col gap-2.5">
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <Pill active={!value.group} onClick={() => onChange({ group: '', subgroup: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {groups.map((g) => (
            <Pill key={g} active={value.group === g} onClick={() => onChange({ group: g, subgroup: '' })}>
              {g}
            </Pill>
          ))}
        </div>
      )}
      {subgroups.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 h-4 w-1 shrink-0 rounded-full bg-primary/40" aria-hidden />
          <Pill active={!value.subgroup} onClick={() => onChange({ ...value, subgroup: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {subgroups.map((s) => (
            <Pill key={s} active={value.subgroup === s} onClick={() => onChange({ ...value, subgroup: s })}>
              {s}
            </Pill>
          ))}
        </div>
      )}
    </div>
  )
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'min-h-9 rounded-full px-3.5 py-1 text-xs font-semibold ' +
        'transition-[background-color,border-color,color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.94] ' +
        (active
          ? 'bg-primary text-primary-fg shadow-[var(--shadow-sm)]'
          : 'bg-fill text-muted hover:bg-fill-hover hover:text-text')
      }
    >
      {children}
    </button>
  )
}

import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { Member } from '../../../lib/api'
import { groupsOf, subgroupsOf, type Filter } from './filters'

// 고르는 자리는 **닫힌 집합**이다 (부서도 동산도 목록이 정해져 있다). 그런 자리에 꽉 찬
// 파란 알약을 늘어놓으면 화면에서 가장 센 색이 "지금 아무것도 안 걸러져 있다"는 사실이
// 되고, 그 아래 진짜 내용은 그보다 조용해진다. 그래서 iOS의 분절 컨트롤처럼 **하나의
// 옅은 트랙 안에서 고른 것만 떠오르게** 한다 — 트랙이 "이 중 하나"라는 것을 모양으로
// 말해 주므로 색을 쓸 필요가 없다.
export function Segmented({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="segmented max-w-full flex-wrap" role="group" aria-label={label}>
      {children}
    </div>
  )
}

// Shared 부서 → 동산 pill filter for the Today/Sheet tabs. Renders nothing when the
// scoped roster has only one group and one 동산 (e.g. a 동산 leader — already pinned).
export function GroupFilter({ members, value, onChange }: { members: Member[]; value: Filter; onChange: (f: Filter) => void }) {
  const { t } = useTranslation()
  const groups = groupsOf(members)
  const subgroups = subgroupsOf(members, value.group)
  if (groups.length <= 1 && subgroups.length <= 1) return null

  // 두 트랙은 한 줄에 나란히 선다 — 부서와 동산은 **같은 물음의 두 칸**이라(어느 부서의
  // 어느 동산인가) 줄을 갈라 쌓으면 내용이 시작되기 전에 두 줄이 먼저 지나간다. 좁으면
  // 저절로 아래로 접힌다.
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {groups.length > 1 && (
        <Segmented label={t('admin.nav.members')}>
          <Pill active={!value.group} onClick={() => onChange({ group: '', subgroup: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {groups.map((g) => (
            <Pill key={g} active={value.group === g} onClick={() => onChange({ group: g, subgroup: '' })}>
              {g}
            </Pill>
          ))}
        </Segmented>
      )}
      {subgroups.length > 1 && (
        <Segmented>
          <Pill active={!value.subgroup} onClick={() => onChange({ ...value, subgroup: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {subgroups.map((s) => (
            <Pill key={s} active={value.subgroup === s} onClick={() => onChange({ ...value, subgroup: s })}>
              {s}
            </Pill>
          ))}
        </Segmented>
      )}
    </div>
  )
}

// 분절 컨트롤의 한 칸. 고른 것은 트랙 위로 **떠오르고**(표면색 + 그림자) 나머지는 글자만
// 남는다. `Segmented` 밖에서 홀로 써도 말이 되도록 고르지 않은 상태에 배경을 두지 않았다.
export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'min-h-8 rounded-full px-3.5 py-1 text-xs font-semibold whitespace-nowrap ' +
        'transition-[background-color,color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
        (active
          ? 'bg-surface text-text shadow-[var(--shadow-sm)]'
          : 'text-muted hover:text-text')
      }
    >
      {children}
    </button>
  )
}

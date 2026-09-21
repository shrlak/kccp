import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Stats } from './stats'

// 탭마다 숫자 타일을 따로 짓고 있었다 — 출석부는 아이콘을 동그란 칩에 담아 왼쪽에 쌓고,
// 오늘은 아이콘을 가운데 올려 세웠다. 한 로그인 뒤의 두 화면이 서로 다른 앱처럼 보이던
// 자리라, 타일은 여기 하나로 모은다. 모양도 한 단 낮췄다: 숫자가 주인공인 타일에서
// 아이콘 칩은 가장 크고 가장 색이 있는 요소였다.
export function StatTile({
  label,
  value,
  tone = 'plain',
  valueClass = '',
  hint,
  icon,
}: {
  label: string
  value: ReactNode
  // 'accent'는 그 줄에서 눈이 먼저 가야 하는 하나(오늘 출석 인원). 배경을 칠하는 대신
  // 숫자만 강조색으로 둔다 — 칠하면 타일 셋 중 하나가 버튼처럼 보인다.
  tone?: 'plain' | 'accent'
  valueClass?: string
  // 숫자만으로는 거짓이 되는 라벨에 붙는 한 줄 ("최근 4주"인데 기록이 2주뿐일 때).
  hint?: string
  icon?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3.5 shadow-[var(--shadow-sm)] sm:px-5 sm:py-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold leading-4 text-muted sm:text-xs">
        {icon && <span className="shrink-0 text-subtle">{icon}</span>}
        {/* 두 줄까지 허용하되 자리는 두 줄만큼 늘 잡아 둔다. 한 줄로 자르면 폰에서
            "지난 주 출석…"이 되어 무엇의 숫자인지가 사라지고, 자리를 안 잡아 두면
            라벨이 긴 타일만 키가 커져 셋이 어긋난다. */}
        <span className="line-clamp-2 min-h-8">{label}</span>
      </div>
      <div
        className={
          'mt-1.5 font-display text-[26px] font-bold leading-none tabular-nums tracking-[-0.02em] sm:text-3xl ' +
          (valueClass || (tone === 'accent' ? 'text-primary' : 'text-text'))
        }
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[11px] leading-4 text-subtle">{hint}</div>}
    </div>
  )
}

// 타일 셋이 화면 너비를 다 가져가면 숫자 하나에 600px이 붙어 카드 안이 텅 빈다.
// 폭을 묶어 두면 그 줄이 하나의 덩어리로 읽히고, 아래 목록이 화면의 주인이 된다.
export const STAT_ROW = 'mb-5 grid max-w-3xl grid-cols-3 gap-2.5 sm:gap-3'

// The reactive stat tiles shown atop the Sheet tab, reflecting the active filter.
export function StatsBar({ stats }: { stats: Stats }) {
  const { t } = useTranslation()
  const items: { label: string; value: number; tone?: 'accent' }[] = [
    { label: t('admin.stats.today'), value: stats.today, tone: 'accent' },
    { label: t('admin.stats.members'), value: stats.members },
    { label: t('admin.stats.days'), value: stats.days },
  ]
  return (
    <div className={STAT_ROW}>
      {items.map(({ label, value, tone }) => (
        <StatTile key={label} label={label} value={value} tone={tone} />
      ))}
    </div>
  )
}

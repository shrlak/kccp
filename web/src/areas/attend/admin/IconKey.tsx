import { useTranslation } from 'react-i18next'

export type IconKeyItem = 'newFamily' | 'visitor' | 'firstVisit' | 'newMemberStar' | 'eduWeek1' | 'eduWeek2'

// Each legend entry gets a small on-brand color dot echoing the tag colors used in the
// roster/attendance rows. Dots are decorative (no text) so the label stays the sole
// textContent of each chip.
const dotTone: Record<IconKeyItem, string> = {
  newFamily: 'bg-primary',
  visitor: 'bg-info',
  firstVisit: 'bg-gold',
  newMemberStar: 'bg-gold',
  eduWeek1: 'bg-info',
  eduWeek2: 'bg-success',
}

// 카드 위의 칩은 좁아서 "1"·"2"로 적지만, 범례는 그 숫자가 무엇인지 말하는 자리다 —
// 같은 키를 두 곳에 쓰는 바람에 범례가 "● 새가족  ● 1  ● 2"로 나와, 읽는 사람에게
// 아무것도 알려주지 못하면서 자리만 차지했다.
const LEGEND_KEY: Partial<Record<IconKeyItem, string>> = {
  eduWeek1: 'eduWeek1Legend',
  eduWeek2: 'eduWeek2Legend',
}

// Compact status legend shared by roster and attendance views.
export function IconKey({ items }: { items: IconKeyItem[] }) {
  const { t } = useTranslation()
  return (
    <div className="mb-4 flex flex-wrap gap-1.5" aria-label={t('admin.iconKey.legend')}>
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1.5 rounded-full border border-separator bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-subtle shadow-[var(--shadow-sm)]"
        >
          <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + dotTone[item]} aria-hidden />
          {t(`admin.iconKey.${LEGEND_KEY[item] ?? item}`)}
        </span>
      ))}
    </div>
  )
}

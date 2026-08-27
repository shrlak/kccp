import type { CSSProperties } from 'react'
import { KccpMark } from './KccpMark'

// A compact church wordmark for operational screens. The official mark stays intact,
// while the typography is intentionally quieter than the attendance content around it.
// `stacked` centers the mark above the wordmark for hero placements.
//
// 부서 이름은 걸지 않는다. 랜딩은 두 부가 함께 여는 문이라 (대학·청년부도 장년부도 여기서
// 시작한다) 어느 한쪽의 이름을 내걸면 나머지 한쪽에게 남의 집 문패가 된다. 부는 로그인
// 뒤에야 정해지고, 그때부터는 관리자 패널 머리글이 매 화면에서 그것을 말해 준다.
export function KccpLogo({
  size = 52,
  className = '',
  stacked = false,
}: {
  size?: number
  className?: string
  stacked?: boolean
}) {
  if (stacked) {
    // Hero placement, so it sizes against the viewport instead of the `size` prop alone:
    // CSS width/height beat the SVG's presentation attributes, and a vmin clamp shrinks
    // the mark on a phone held sideways (short *and* wide) where a fixed 92 px would push
    // the rest of the hero off-screen. `size` remains the desktop ceiling.
    return (
      <div
        className={'flex flex-col items-center text-center ' + className}
        style={{ '--kccp-mark-max': `${size}px` } as CSSProperties}
        role="img"
        aria-label="Korean Central Church of Pittsburgh"
      >
        <KccpMark size={size} className="h-auto w-[clamp(3.25rem,13vmin,var(--kccp-mark-max))]" />
        <div className="mt-6 font-display text-[11px] font-semibold uppercase leading-none tracking-[0.16em] text-subtle short:mt-3">
          Korean Central Church
        </div>
        <div className="mt-2 font-display text-lg font-bold leading-tight tracking-tight text-text short:mt-1.5 short:text-base">
          피츠버그 한인중앙교회
        </div>
      </div>
    )
  }
  return (
    <div
      className={'inline-flex items-center gap-3 text-left ' + className}
      role="img"
      aria-label="Korean Central Church of Pittsburgh"
    >
      <KccpMark size={size} className="shrink-0" />
      <div className="border-l border-border pl-3">
        <div className="font-display text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-subtle">
          Korean Central Church
        </div>
        <div className="mt-1 font-display text-sm font-bold leading-tight tracking-tight text-text">
          피츠버그 한인중앙교회
        </div>
      </div>
    </div>
  )
}

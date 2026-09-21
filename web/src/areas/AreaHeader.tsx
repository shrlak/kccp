import type { ReactNode } from 'react'
import { useAdminAuth } from '../stores/useAdminAuth'
import { KccpMark } from './attend/checkin/KccpMark'
import { Button } from '../components/ui/Button'
import { iconBtnClass } from '../components/ui/ThemeLangToggle'
import { useTheme } from '../stores/useTheme'
import { Sun, Moon } from '../components/ui/Icon'

// 슬라이드·찬양 화면의 머리. 출석 패널의 헤더(AdminApp)와 **같은 것**이다 — 서 있는
// 자리(붙박이 material-bar), 제목의 활자(font-display bold + 아래 한 줄의 작은 설명),
// 오른쪽 조각들의 크기까지.
//
// 색 토큰만 맞추는 것으로는 한 벌이 되지 않는다는 것을 여기서 배웠다. 옮겨 온 ppt 화면은
// 출석과 같은 색을 쓰면서도 제목이 `text-xl font-semibold`로 맨바닥에 있었고, 로그아웃은
// 버튼이 아니라 파란 글자였다. 같은 로그인 뒤의 두 화면이 서로 다른 앱처럼 보이는 것은
// 대개 색이 아니라 **모양**이다.
//
// 언어 토글은 싣지 않는다. 이 두 영역의 문구는 코드에 한국어로 박혀 있어서 EN을 눌러도
// 아무것도 바뀌지 않는다 — 아무 일도 안 하는 버튼은 없는 버튼보다 나쁘다. 테마 토글만
// 같은 `iconBtnClass`로 둔다 (주일 아침의 어두운 무대 뒤에서 실제로 쓰인다).
export function AreaHeader({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  const signOut = useAdminAuth((s) => s.signOut)
  const theme = useTheme((s) => s.theme)
  const toggleTheme = useTheme((s) => s.toggle)

  return (
    <header className="material-bar safe-x sticky top-0 z-20 -mx-gutter border-b py-3 pt-[calc(0.75rem+var(--safe-top))]">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 sm:gap-4">
        <span className="grid shrink-0 place-items-center" aria-hidden>
          <KccpMark size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold tracking-tight text-text sm:text-2xl">{title}</h1>
          {meta && <p className="mt-0.5 truncate text-xs text-muted">{meta}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {children}
          <button type="button" onClick={toggleTheme} className={iconBtnClass} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          </button>
          <Button variant="ghost" size="sm" onClick={signOut}>
            로그아웃
          </Button>
        </div>
      </div>
    </header>
  )
}

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ThemeLangToggle } from '../ui/ThemeLangToggle'
import { KccpMark } from '../../areas/attend/checkin/KccpMark'

// 두 잠금 화면(관리자 로그인 · 키오스크)이 함께 쓰는 껍데기 — 가운데 카드 하나.
//
// 예전에는 왼쪽 절반이 브랜드 패널이었는데, 거기 적힌 것이 대학·청년부의 말이었다
// ("COLLEGE · YOUNG ADULT", 사역 소개 문구). 이제 장년부도 같은 문으로 들어오므로
// 어느 한 부의 이름을 내걸 수 없고, 부를 지운 패널은 로고와 여백만 남는다. 그래서 패널을
// 통째로 걷어내고 카드를 화면 가운데 놓는다 — 문 앞에서 필요한 것은 들어가는 길뿐이다.
export function AccessShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string
  title: string
  subtitle: string
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <main className="relative grid min-h-dvh bg-canvas">
      {/* Soft ambient accents for depth behind the card. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />
        <div className="absolute -bottom-40 right-[-6rem] h-80 w-80 rounded-full bg-gold/[0.06] blur-3xl" />
      </div>

      {/* py-20 alone leaves the card taller than a phone in landscape, where the whole
          viewport is ~370 px — the top of the form would sit above the fold with nothing
          indicating it. `short:` trims the vertical padding so the card fits or, failing
          that, starts at the top of a scroll rather than centered off-screen. */}
      <section className="safe-x relative flex min-h-dvh items-center justify-center py-20 short:items-start short:py-8 sm:[--gutter:2rem]">
        <div className="absolute right-[max(1.25rem,var(--safe-right))] top-5 flex items-center gap-1 pt-[var(--safe-top)] sm:right-8 sm:top-7">
          <ThemeLangToggle />
        </div>

        <div className="fx-rise w-full max-w-[420px]">
          <Link to="/" className="mb-10 inline-flex items-center gap-2.5 short:mb-6">
            <KccpMark size={32} />
            <span className="text-sm font-bold tracking-tight text-text">KCCP</span>
          </Link>

          <div className="surface-panel p-7 shadow-[var(--shadow-lg)] sm:p-8">
            <div className="section-kicker">{eyebrow}</div>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-text">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-muted">{subtitle}</p>

            <div className="mt-7 border-t border-separator pt-7">{children}</div>
          </div>

          <Link to="/" className="mt-6 inline-flex text-xs font-semibold text-muted underline-offset-4 hover:text-text hover:underline">
            {t('access.backHome')}
          </Link>
        </div>
      </section>
    </main>
  )
}

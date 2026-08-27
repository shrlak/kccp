import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, ArrowLeft } from '../components/ui/Icon'
import { KccpMark } from '../areas/attend/checkin/KccpMark'

export function NotFound() {
  const { t } = useTranslation()
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6">
      <div className="surface-panel fx-rise w-full max-w-md px-8 py-11 text-center shadow-[var(--shadow-lg)]">
        <div className="mb-8 flex justify-center">
          <KccpMark size={36} />
        </div>
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-full bg-fill text-subtle">
          <Search className="size-7" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="section-kicker">Error · 404</div>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-text">{t('notFound.message')}</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-muted">{t('notFound.description')}</p>
        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-5 py-3 text-sm font-semibold text-primary-fg shadow-[var(--shadow-sm)] transition-[background-color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-primary-hover hover:shadow-[0_6px_20px_color-mix(in_srgb,var(--primary)_30%,transparent)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden />
          {t('notFound.home')}
        </Link>
      </div>
    </main>
  )
}

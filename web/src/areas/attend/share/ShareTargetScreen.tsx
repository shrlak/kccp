import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CardScanDialog } from '../admin/CardScanDialog'
import { KccpMark } from '../checkin/KccpMark'
import { Button } from '../../../components/ui/Button'
import { ThemeLangToggle } from '../../../components/ui/ThemeLangToggle'
import { ScanLine, ImagePlus } from '../../../components/ui/Icon'
import { readSharedCards, clearSharedCards } from '../../../lib/sharedCards'
import { ADULT_GROUP, type Partition } from '../../../lib/partition'

// ── /share — 새가족 카드 사진 등록, 로그인 없이 ────────────────────────────────
// Deliberately unauthenticated. Registering a paper 새가족 card is a job for whoever is
// holding the card at the welcome desk, and making them sign in first — on a borrowed
// phone, mid-service — was the whole friction this route exists to remove. So this screen
// never gates: it talks to the /api/share/* endpoints, which resolve no admin role. The
// shared daily scan quota still applies, and every registration is audited as `share-link`.
//
// Two ways in:
//   1. The phone's share sheet (Android). 사진 앱 → 공유 → KCCP 출석 posts the photos to
//      the service worker (src/sw.ts), which parks them and sends the browser here; they
//      are already waiting by the time this screen mounts.
//   2. share.html on the home screen, or this URL directly — one tap to the picker. That
//      path works everywhere, and is what iPhones use, since iOS doesn't implement Web
//      Share Target.
export function ShareTargetScreen({ partition = 'youth' }: { partition?: Partition } = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // null while the hand-off is being read out of the Cache API.
  const [shared, setShared] = useState<File[] | null>(null)
  // Set only by the 사진 선택 button — the picker path, for when nothing was shared.
  const [pickerOpen, setPickerOpen] = useState(false)

  const ready = shared !== null
  const count = shared?.length ?? 0
  // A real share has nothing left to decide, so it goes straight into review; the picker
  // path waits for a tap. Derived rather than held in state, so there's no frame where
  // the screen has the photos but hasn't opened the dialog yet.
  const scanning = count > 0 || pickerOpen

  useEffect(() => {
    let live = true
    void readSharedCards()
      .then((files) => live && setShared(files))
      .catch(() => live && setShared([]))
    return () => {
      live = false
    }
  }, [])

  // The dialog owns the files from here; drop the hand-off so a reload — or a later visit
  // to /share — never re-registers the same card.
  useEffect(() => {
    if (scanning && count > 0) void clearSharedCards()
  }, [scanning, count])

  return (
    <main className="relative flex min-h-dvh flex-col bg-canvas">
      <header className="material-bar sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)]">
        <div className="safe-x mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <KccpMark size={24} />
            <span className="truncate text-sm font-bold tracking-tight text-text">{t('share.title')}</span>
          </Link>
          <ThemeLangToggle />
        </div>
      </header>

      <section className="safe-x mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span
          className={
            'grid size-16 place-items-center rounded-[22px] border border-border bg-surface shadow-[var(--shadow)] ' +
            (ready ? '' : 'fx-pulse')
          }
        >
          {count > 0 ? (
            <ImagePlus className="size-7 text-primary" strokeWidth={1.75} aria-hidden />
          ) : (
            <ScanLine className="size-7 text-primary" strokeWidth={1.75} aria-hidden />
          )}
        </span>

        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-text">
          {count > 0 ? t('share.received', { n: count }) : t('share.title')}
        </h1>
        <p className="text-sm leading-6 text-muted">{count > 0 ? t('share.receivedHint') : t('share.emptyHint')}</p>
        {ready && count === 0 && (
          <Button onClick={() => setPickerOpen(true)} className="w-full max-w-xs">
            <ScanLine className="size-4" strokeWidth={2} aria-hidden />
            {t('share.pick')}
          </Button>
        )}
        <Link
          to="/admin"
          className="text-xs font-semibold text-muted underline-offset-4 hover:text-text hover:underline"
        >
          {t('share.goToPanel')}
        </Link>
      </section>

      {partition === 'adult' && (
        <p className="mb-4 inline-flex w-fit items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {ADULT_GROUP}
        </p>
      )}

      {scanning && (
        <CardScanDialog
          open
          publicMode
          forcePartition={partition}
          initialFiles={shared ?? undefined}
          // Closing returns to this screen rather than the admin panel — whoever opened
          // the share link may well have no panel to go back to.
          onClose={() => {
            setPickerOpen(false)
            setShared([])
            navigate(partition === 'adult' ? '/share/adult' : '/share', { replace: true })
          }}
        />
      )}
    </main>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../../stores/useAdminAuth'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import { Monitor } from '../../../components/ui/Icon'
import { AccessShell } from '../../../components/layout/AccessShell'

// Login gate for /kiosk reached from the public landing page. Same credentials as the
// admin panel — any team password or an authorized Google account — but unlocking lands
// straight on the kiosk (KioskShell) instead of the admin panel. Google sign-in passes
// returnTo:'/kiosk' so the OAuth callback comes back here rather than /admin.
export function KioskGate() {
  const { t } = useTranslation()
  const verify = useAdminAuth((s) => s.verify)
  const signInWithGoogle = useAdminAuth((s) => s.signInWithGoogle)
  const status = useAdminAuth((s) => s.status)
  const [pw, setPw] = useState('')
  // Which method the last attempt used, so a failure shows the matching message.
  const [method, setMethod] = useState<'password' | 'google'>('password')
  const busy = status === 'verifying'

  async function submit() {
    if (!pw || busy) return
    setMethod('password')
    await verify(pw)
    // On success KioskShell re-renders straight into the kiosk; on failure the store's
    // error status shows below.
  }

  return (
    <AccessShell eyebrow={t('access.kioskEyebrow')} title={t('kiosk.gate.title')} subtitle={t('kiosk.gate.subtitle')}>
      <div>
        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t('kiosk.gate.passwordPlaceholder')}
          aria-label={t('kiosk.gate.passwordPlaceholder')}
          autoFocus
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pw) void submit()
          }}
        />
        {status === 'error' && method === 'password' && (
          <p className="mt-2 text-xs text-danger">{t('kiosk.gate.wrong')}</p>
        )}
        <Button onClick={() => void submit()} disabled={busy || !pw} className="mt-3 w-full">
          <Monitor className="size-4" strokeWidth={2} aria-hidden />
          {busy && method === 'password' ? t('common.loading') : t('kiosk.gate.submit')}
        </Button>

        <div className="my-5 flex items-center gap-3 text-xs text-subtle">
          <span className="h-px flex-1 bg-border" aria-hidden />
          {t('kiosk.gate.or')}
          <span className="h-px flex-1 bg-border" aria-hidden />
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            setMethod('google')
            void signInWithGoogle('/kiosk')
          }}
          disabled={busy}
          className="w-full"
        >
          {busy && method === 'google' ? t('common.loading') : t('admin.signInWithGoogle')}
        </Button>
        {status === 'error' && method === 'google' && (
          <p className="mt-2 text-xs text-danger">{t('admin.googleError')}</p>
        )}
      </div>
    </AccessShell>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../../stores/useAdminAuth'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import { Lock, ChevronRight } from '../../../components/ui/Icon'
import { AccessShell } from '../../../components/layout/AccessShell'

export function LoginGate() {
  const { t } = useTranslation()
  const status = useAdminAuth((s) => s.status)
  const verify = useAdminAuth((s) => s.verify)
  const signInWithGoogle = useAdminAuth((s) => s.signInWithGoogle)
  const [pw, setPw] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const busy = status === 'verifying'

  return (
    <AccessShell eyebrow={t('access.adminEyebrow')} title={t('admin.title')} subtitle={t('admin.subtitle')}>
      <div>
        <Button onClick={() => void signInWithGoogle()} disabled={busy} className="w-full">
          {busy && !showPassword ? t('common.loading') : t('admin.signInWithGoogle')}
        </Button>

        {status === 'error' && (
          <p className="mt-2 text-xs text-danger">{t('admin.googleError')}</p>
        )}

        <button
          type="button"
          className="mt-6 inline-flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-text"
          onClick={() => setShowPassword((v) => !v)}
        >
          <Lock className="size-3.5" strokeWidth={2} aria-hidden />
          {t('admin.usePassword')}
          <ChevronRight
            className={'size-3.5 transition-transform duration-200 ' + (showPassword ? 'rotate-90' : '')}
            strokeWidth={2}
            aria-hidden
          />
        </button>

        {showPassword && (
          <div className="fx-fade mt-4 rounded-2xl border border-border bg-surface-2 p-4 shadow-[var(--shadow-sm)]">
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={t('admin.passwordPlaceholder')}
              aria-label={t('admin.passwordPlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pw) void verify(pw)
              }}
            />
            {status === 'error' && (
              <p className="mt-2 text-xs text-danger">{t('admin.wrongPassword')}</p>
            )}
            <Button
              onClick={() => void verify(pw)}
              disabled={busy || !pw}
              className="mt-3 w-full"
            >
              <Lock className="size-4" strokeWidth={2} aria-hidden />
              {busy ? t('common.loading') : t('admin.unlock')}
            </Button>
          </div>
        )}
      </div>
    </AccessShell>
  )
}

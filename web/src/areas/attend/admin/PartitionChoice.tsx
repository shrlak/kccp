import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../../stores/useAdminAuth'
import { AccessShell } from '../../../components/layout/AccessShell'
import { ChevronRight } from '../../../components/ui/Icon'
import type { Partition } from '../../../lib/partition'

// ── 어느 부로 들어갈까 ────────────────────────────────────────────────────────────────
//
// 거의 모든 사람에게 부는 고를 것이 아니다 — 자기 members 행이 어느 스키마에 있느냐가 곧
// 자기 부이고, 로그인하면 그 부의 패널이 뜬다. 두 부를 다 맡는 계정 하나만 이 화면을 본다
// (서버가 identity.canChoosePartition으로 알려 준다).
//
// 문 하나에 갈림길을 두는 대신 **로그인 다음 화면**으로 둔 이유: 로그인 화면에서 부를 고르게
// 하면 나머지 모두가 자기와 상관없는 선택지를 보게 된다. 여기까지 온 사람은 이미 신원이
// 확인된 그 한 사람이다.
export function PartitionChoice() {
  const { t } = useTranslation()
  const choosePartition = useAdminAuth((s) => s.choosePartition)
  const busy = useAdminAuth((s) => s.status) === 'verifying'

  return (
    <AccessShell
      eyebrow={t('access.adminEyebrow')}
      title={t('admin.partitionChoice.title')}
      subtitle={t('admin.partitionChoice.subtitle')}
    >
      <div className="grid gap-3">
        {(['youth', 'adult'] as Partition[]).map((partition) => (
          <button
            key={partition}
            type="button"
            disabled={busy}
            onClick={() => void choosePartition(partition)}
            className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 px-5 py-4 text-left transition-colors hover:border-primary hover:bg-surface disabled:opacity-60"
          >
            <span>
              <span className="block font-display text-lg font-bold tracking-tight text-text">
                {t(`admin.ministry.${partition}`)}
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                {t(`admin.partitionChoice.hint.${partition}`)}
              </span>
            </span>
            <ChevronRight
              className="size-5 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
              strokeWidth={2}
              aria-hidden
            />
          </button>
        ))}
      </div>
    </AccessShell>
  )
}

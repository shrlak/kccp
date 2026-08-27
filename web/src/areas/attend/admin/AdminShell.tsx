import { useAdminAuth } from '../../../stores/useAdminAuth'
import { LoginGate } from './LoginGate'
import { AdminApp } from './AdminApp'
import { PartitionChoice } from './PartitionChoice'
import { KccpMark } from '../checkin/KccpMark'

export function AdminShell() {
  const status = useAdminAuth((s) => s.status)
  const identity = useAdminAuth((s) => s.identity)
  const chosenPartition = useAdminAuth((s) => s.chosenPartition)
  // 두 부를 다 맡는 계정은 로그인 다음에 어느 부로 들어갈지 한 번 고른다. 고른 뒤에는 패널
  // 헤더의 전환 버튼으로 오간다 — 이 화면은 다시 뜨지 않는다 (로그아웃하면 선택도 지워진다).
  if (status === 'authed' && identity?.canChoosePartition && !chosenPartition) return <PartitionChoice />
  if (status === 'authed') return <AdminApp />
  // Show a neutral loading screen during OAuth callback processing so the login form
  // doesn't flash briefly while the session is being verified.
  if (status === 'verifying') return (
    <main className="grid min-h-dvh place-items-center bg-canvas">
      <span className="fx-pulse grid size-16 place-items-center rounded-[22px] border border-border bg-surface shadow-[var(--shadow)]">
        <KccpMark size={36} className="text-primary" />
      </span>
    </main>
  )
  return <LoginGate />
}

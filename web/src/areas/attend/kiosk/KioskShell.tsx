import { Navigate, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../../../stores/useAdminAuth'
import { KioskGate } from './KioskGate'
import { KioskView } from './KioskView'

// The /kiosk route, reachable straight from the landing page's 출석 키오스크 button.
// Unauthenticated visitors get the kiosk login gate (same credentials as the admin
// panel: any team password or an authorized Google account). An already-authed session
// opens the kiosk directly — no detour through the admin panel — for every role except
// the read-only pastor, who can't check anyone in and is sent to the panel instead.
// 나가기 exits in one tap — no password, no confirm — keeping the session and landing
// on the admin panel, same as exiting an admin-launched kiosk.
export function KioskShell() {
  const status = useAdminAuth((s) => s.status)
  const role = useAdminAuth((s) => s.identity?.role)
  const navigate = useNavigate()
  if (status !== 'authed') return <KioskGate />
  if (role === 'pastor') return <Navigate to="/admin" replace />
  return <KioskView onExit={() => navigate('/admin')} />
}

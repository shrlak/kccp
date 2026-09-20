import { lazy, Suspense } from 'react'
import { useAdminAuth } from '../../../stores/useAdminAuth'
import { areasOf } from '../../../lib/api'
import { LoginGate } from './LoginGate'
import { AdminApp } from './AdminApp'
import { PartitionChoice } from './PartitionChoice'
import { AreaChoice } from '../../AreaChoice'
import { KccpMark } from '../checkin/KccpMark'

// 슬라이드 영역은 자기 조각으로 떨어진다. 출석 담당자가 여는 화면이 pdfjs·jszip·성경
// 본문을 내려받을 이유가 없기 때문이다 — 지금은 껍데기라 가볍지만, 마법사가 들어오면
// 이 한 줄이 랜딩의 무게를 지키는 것이 된다. (AdminShell·KioskShell과 같은 이유.)
const SlidesShell = lazy(() => import('../../slides/SlidesShell').then((m) => ({ default: m.SlidesShell })))
// 찬양 영역도 같은 이유로 떨어뜨린다. 인도자의 폰이 명단 UI를 내려받을 이유가 없고,
// 출석 담당자가 pdfjs·jszip을 내려받을 이유도 없다. 이 화면은 슬라이드 조각과 대부분을
// 나눠 쓰므로(조립·인식) 새로 지는 무게는 화면 하나뿐이다.
const PraiseLeaderShell = lazy(() =>
  import('../../praise/PraiseLeaderShell').then((m) => ({ default: m.PraiseLeaderShell })),
)

export function AdminShell() {
  const status = useAdminAuth((s) => s.status)
  const identity = useAdminAuth((s) => s.identity)
  const chosenPartition = useAdminAuth((s) => s.chosenPartition)
  const chosenArea = useAdminAuth((s) => s.chosenArea)

  if (status === 'authed') {
    // 영역이 먼저다. 부(部) 고르기는 **출석 영역 안의** 물음이라(어느 명단을 볼 것인가),
    // 슬라이드로 들어가는 사람에게 물으면 뜻이 없다.
    const areas = areasOf(identity)
    const area = areas.length === 1 ? areas[0] : chosenArea
    // 고를 것이 둘 이상인데 아직 안 골랐다 → 한 번만 묻는다.
    if (!area) return <AreaChoice />
    if (area === 'slides') {
      return (
        <Suspense fallback={<Splash />}>
          <SlidesShell />
        </Suspense>
      )
    }
    if (area === 'praise') {
      return (
        <Suspense fallback={<Splash />}>
          <PraiseLeaderShell />
        </Suspense>
      )
    }
  }

  // 두 부를 다 맡는 계정은 로그인 다음에 어느 부로 들어갈지 한 번 고른다. 고른 뒤에는 패널
  // 헤더의 전환 버튼으로 오간다 — 이 화면은 다시 뜨지 않는다 (로그아웃하면 선택도 지워진다).
  if (status === 'authed' && identity?.canChoosePartition && !chosenPartition) return <PartitionChoice />
  if (status === 'authed') return <AdminApp />
  // Show a neutral loading screen during OAuth callback processing so the login form
  // doesn't flash briefly while the session is being verified.
  if (status === 'verifying') return <Splash />
  return <LoginGate />
}

function Splash() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas">
      <span className="fx-pulse grid size-16 place-items-center rounded-[22px] border border-border bg-surface shadow-[var(--shadow)]">
        <KccpMark size={36} className="text-primary" />
      </span>
    </main>
  )
}

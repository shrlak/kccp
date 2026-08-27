import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RouteSplash } from './RouteSplash'
import { CheckinScreen } from '../areas/attend/checkin/CheckinScreen'
import { NotFound } from './NotFound'

// The landing page is the entry point for everyone, so it ships in the first chunk.
// Everything behind a login is split out: the admin panel drags in the whole roster UI
// (and, on demand, SheetJS and Chart.js), which a phone opening the landing page or the
// kiosk should never have to download, parse, and execute first. The service worker
// precaches these chunks, so the split costs a round trip only on a cold first visit.
const AdminShell = lazy(() => import('../areas/attend/admin/AdminShell').then((m) => ({ default: m.AdminShell })))
const KioskShell = lazy(() => import('../areas/attend/kiosk/KioskShell').then((m) => ({ default: m.KioskShell })))
const ShareTargetScreen = lazy(() =>
  import('../areas/attend/share/ShareTargetScreen').then((m) => ({ default: m.ShareTargetScreen })),
)
// 동산지기가 링크로 여는 출석 화면. 로그인이 없고 관리자 패널의 코드도 필요 없으므로 자기
// 조각으로 떨어뜨린다 — 리더의 폰이 명단 UI 전체를 내려받을 이유가 없다.
const DongsanBoardScreen = lazy(() =>
  import('../areas/attend/dongsan/DongsanBoardScreen').then((m) => ({ default: m.DongsanBoardScreen })),
)

// A reload stays where it was — the URL is the screen, and the admin session (sessionStorage
// password / Supabase's own Google session) survives it, so reloading the admin panel or the
// kiosk lands back on the same screen rather than the landing page. The panel's own tab is
// remembered alongside it (see adminTab.ts). Signing out is what goes home.
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<CheckinScreen />} />
        <Route
          path="/admin"
          element={
            <Suspense fallback={<RouteSplash />}>
              <AdminShell />
            </Suspense>
          }
        />
        <Route
          path="/kiosk"
          element={
            <Suspense fallback={<RouteSplash />}>
              <KioskShell />
            </Suspense>
          }
        />
        {/* Target of the phone's share sheet and the home-screen 카드 등록 shortcut. */}
        <Route
          path="/share"
          element={
            <Suspense fallback={<RouteSplash />}>
              <ShareTargetScreen />
            </Suspense>
          }
        />
        {/* 장년부용 카드 등록 링크. 부마다 종이가 다르고 담기는 표도 다르므로 문을 따로 둔다 —
            이 링크로 들어온 사진은 장년부 카드로만 읽고 장년부 명단에만 들어간다. */}
        <Route
          path="/share/adult"
          element={
            <Suspense fallback={<RouteSplash />}>
              <ShareTargetScreen partition="adult" />
            </Suspense>
          }
        />
        {/* 동산지기가 받은 링크. 토큰이 곧 신원이라 로그인 문을 지나지 않는다. */}
        <Route
          path="/dongsan/:token"
          element={
            <Suspense fallback={<RouteSplash />}>
              <DongsanBoardScreen />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

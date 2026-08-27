import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RouteSplash } from './RouteSplash'
import { CheckinScreen } from '../areas/attend/checkin/CheckinScreen'
import { NotFound } from './NotFound'

// 첫 화면은 이제 **KCCP 관리자 로그인**이다. 합쳐진 앱은 출석과 슬라이드를 함께 담고,
// 어느 쪽을 보느냐는 자격이 정하므로(auth.ts의 areas), 문이 하나여야 한다.
//
// 부원이 폰에서 여는 공개 체크인 화면은 지우지 않고 /checkin 으로 내렸다. 그 화면은
// 여전히 쓸 수 있고, 실제로 쓰지 않기로 하면 최고관리자가 설정에서 끄면 된다 —
// 그 스위치는 지금도 있다(config.checkin_days / 개인 체크인 토글).
//
// 무거운 것은 전부 로그인 뒤로 쪼개 둔다: 관리자 패널은 명단 UI 전체(때에 따라 SheetJS와
// Chart.js)를 끌고 오고, 슬라이드 영역은 앞으로 pdfjs·jszip·성경 본문을 끌고 온다.
// 서비스 워커가 이 조각들을 미리 캐시하므로, 쪼개는 값은 첫 방문의 왕복 한 번뿐이다.
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
        {/* 랜딩 = 관리자 로그인. AdminShell이 로그인 전에는 LoginGate를, 로그인 뒤에는
            자격이 가진 영역을 띄운다. */}
        <Route
          path="/"
          element={
            <Suspense fallback={<RouteSplash />}>
              <AdminShell />
            </Suspense>
          }
        />
        {/* 옛 주소를 그대로 살려 둔다 — 홈 화면에 추가해 둔 관리자, 북마크, 문서의 링크가
            /admin 을 가리킨다. 같은 화면이므로 리다이렉트할 것도 없다. */}
        <Route
          path="/admin"
          element={
            <Suspense fallback={<RouteSplash />}>
              <AdminShell />
            </Suspense>
          }
        />
        {/* 부원 개인 체크인 — 로그인 없음. 옛 랜딩이 여기로 내려왔다. */}
        <Route path="/checkin" element={<CheckinScreen />} />
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

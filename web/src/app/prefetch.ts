// Route chunks are lazy (see routes.tsx), which costs one round trip the first time
// someone opens the panel or the kiosk. Start that fetch on intent instead — a pointer
// settling on the link, or the first touch before the tap completes — so the chunk is
// usually parsed by the time the navigation happens. Dynamic imports are idempotent, so
// firing these repeatedly is free; the specifiers must stay identical to the ones at the
// use site or the prefetch would warm a second copy of the chunk.

export function prefetchAdmin(): void {
  void import('../areas/attend/admin/AdminShell')
}

export function prefetchKiosk(): void {
  void import('../areas/attend/kiosk/KioskShell')
}

export function prefetchShare(): void {
  void import('../areas/attend/share/ShareTargetScreen')
}

// Chart.js backs the 분석 탭 and is the heaviest thing inside the admin chunk — big enough
// that switching to the tab used to sit on an empty panel while it downloaded. Same module
// specifier as AnalyticsCharts' own loader, so warming it here is what that call resolves.
export function prefetchCharts(): void {
  void import('chart.js')
}

// SheetJS, for the 출석부 내보내기 and the 학기 아카이브 downloads. Deliberately *not* part
// of the idle sweep: it is the largest dependency in the app and exporting is a deliberate,
// occasional act, so it is warmed on intent (hovering or touching a download control) only.
export function prefetchExcel(): void {
  void import('xlsx-js-style')
}

// Intent handlers spread across a button: a pointer arriving is the earliest honest signal,
// and touchstart fires before the tap completes on a phone (where there is no hover).
export const onIntent = (prefetch: () => void) => ({
  onPointerEnter: prefetch,
  onTouchStart: prefetch,
})

// Run `fn` when the browser is next idle — after first paint and whatever the page is
// still doing, never competing with it. Safari only shipped requestIdleCallback in 17, so
// fall back to a timeout well clear of the initial render.
function whenIdle(fn: () => void, timeoutMs = 1_200): void {
  const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback
  if (ric) ric(() => fn(), { timeout: 4_000 })
  else setTimeout(fn, timeoutMs)
}

// Warm every screen the app can navigate to, once the current one is done painting. The
// first tap on 관리자 or 키오스크 then renders from memory instead of waiting on a chunk —
// and the service worker has usually precached these anyway, so on a repeat visit this
// costs nothing but a cache read.
export function prefetchRoutesOnIdle(): void {
  whenIdle(() => {
    prefetchAdmin()
    prefetchKiosk()
    prefetchShare()
  })
}

// Called once the admin panel is up: the tabs all live in the panel's own chunk, so the
// only thing that can still stall a tab switch is Chart.js.
export function prefetchPanelExtrasOnIdle(): void {
  whenIdle(prefetchCharts)
}

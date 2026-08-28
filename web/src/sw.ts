/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { clientsClaim } from 'workbox-core'
import { stashSharedCards } from './lib/sharedCards'

// `__WB_MANIFEST` is the precache list vite-plugin-pwa injects at build time.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | import('workbox-precaching').PrecacheEntry>
}

// The app's own scope, e.g. '/kccp/' in production and '/' in dev.
const BASE = new URL(self.registration.scope).pathname
const SHARE_PATH = `${BASE}share`

// ── Share target ─────────────────────────────────────────────────────────────
// The reason this worker is hand-written. The manifest points `share_target.action`
// here, so picking KCCP 출석 in the phone's share sheet sends a multipart POST that
// never reaches the network — it's answered below. The files are parked in the Cache
// API (a POST body can't survive a redirect) and the browser is sent on to /share,
// which reads them back and opens the 카드 사진 등록 review flow directly.
//
// Registered before the precache routes so a share is handled even mid-update.
registerRoute(
  ({ url, request }) => request.method === 'POST' && url.pathname === SHARE_PATH,
  async ({ request }) => {
    let count = 0
    try {
      const form = await request.formData()
      const files = form.getAll('photos').filter((v): v is File => v instanceof File)
      count = await stashSharedCards(files)
    } catch {
      // A malformed share still lands on /share, which shows its own "pick a photo"
      // state rather than a browser error page.
    }
    // 303 so the browser re-issues the follow-up as a GET navigation.
    return Response.redirect(`${SHARE_PATH}?shared=${count}`, 303)
  },
  'POST',
)

// ── Precache (the generated worker's job, done by hand) ───────────────────────
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Client-side routes (/admin, /kiosk, /share) are not real files, so every navigation
// resolves to the app shell. Anything that looks like a file request falls through to
// the network so the precache never shadows a real asset.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${BASE}index.html`), {
    denylist: [/\/[^/?]+\.[^/]+$/],
  }),
)

// The heavyweights kept out of the precache (see vite.config.ts globIgnores): cached the
// first time someone exports a sheet or opens 분석, instant every time after. Content
// hashes are in the filenames, so a stale entry is impossible — only unreferenced.
registerRoute(
  ({ url }) => /\/assets\/(xlsx|chart-)/.test(url.pathname),
  new CacheFirst({
    cacheName: 'kccp-heavy-chunks-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true }),
    ],
  }),
)

// Pretendard is loaded from jsDelivr and is otherwise re-validated on every cold start;
// cached here so a reload never waits on a third-party origin for the Korean text.
registerRoute(
  ({ url }) => url.origin === 'https://cdn.jsdelivr.net',
  new StaleWhileRevalidate({
    cacheName: 'kccp-webfont-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365, purgeOnQuotaError: true }),
    ],
  }),
)

// registerType: 'autoUpdate' — take over immediately so a deploy lands on the next load
// rather than waiting for every tab to close.
self.skipWaiting()
clientsClaim()
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') self.skipWaiting()
})

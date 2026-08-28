import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { I18nextProvider } from 'react-i18next'
import { i18n } from './lib/i18n'
import './stores/useTheme'
import { queryClient } from './lib/queryClient'
import { hydrateQueryCache, startQueryPersistence } from './lib/queryPersist'
import { AppRoutes } from './app/routes'
import { prefetchRoutesOnIdle } from './app/prefetch'

registerSW({ immediate: true })

// Put last session's roster/config back before the first render, so a reload paints the
// panel instead of its loading skeletons while the refetch is still in flight.
hydrateQueryCache(queryClient)
startQueryPersistence(queryClient)

// The Google OAuth redirect deliberately lands on the site root (a real file on GitHub
// Pages, so it never depends on the 404.html fallback) and the auth store's module-level
// listener is what verifies the session and forwards to /admin. That store now arrives
// with the lazily-loaded admin chunk, which the landing page never pulls in — so on the
// one page load that *is* the callback, load it explicitly. Supabase leaves `?code=`
// (PKCE) or a `#access_token=` hash on the URL, and the store reads the same markers.
if (
  new URLSearchParams(window.location.search).has('code') ||
  window.location.hash.includes('access_token')
) {
  void import('./stores/useAdminAuth')
}

// Match the Vite base (GitHub Project Pages subpath) so client routes resolve under
// /kccp/ instead of the domain root. BASE_URL is '/' in dev → basename '/'.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

// share.html is the iPhone home-screen entry (see the comment at the top of that file):
// a real document, because iOS launches a home-screen app at its manifest's start_url
// and a manifest can only point at one. It boots this same app, so rewrite the URL to
// the /share route the router actually knows before the first render — replaceState, so
// there's no flash of a 404 and no extra history entry to back into.
if (window.location.pathname.endsWith('/share.html')) {
  window.history.replaceState({}, '', `${import.meta.env.BASE_URL}share${window.location.search}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <BrowserRouter basename={basename}>
          <AppRoutes />
        </BrowserRouter>
      </I18nextProvider>
    </QueryClientProvider>
  </StrictMode>,
)

// With the first screen painted, pull the other screens' chunks in the background so the
// first tap on 관리자 or 키오스크 doesn't wait on a download.
prefetchRoutesOnIdle()

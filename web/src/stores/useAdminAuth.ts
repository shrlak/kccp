import { create } from 'zustand'
import { adminVerify, adminVerifyGoogle, getLoginPosition, GEO_LOGIN_WAIT_MS, setAdminPassword, setAdminPartition, setAdminToken, type AdminIdentity, type Area } from '../lib/api'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { clearPersistedQueries } from '../lib/queryPersist'
import { readStoredPartition, type Partition } from '../lib/partition'

const PW_KEY = 'kccp-admin-pw'
// Where the Google OAuth callback should land. Set before the redirect (the kiosk gate
// passes '/kiosk'), read once when the callback verifies; anything else means /admin.
const RETURN_KEY = 'kccp-oauth-return'
// Last-activity timestamp for password (break-glass) sessions only — Google sessions rely
// on Supabase's own persisted session and are exempt. If a reload finds this stale by more
// than IDLE_TIMEOUT_MS, the saved password is dropped instead of silently re-authing, so
// the tab falls back to the login screen after a long-idle reload.
const ACTIVITY_KEY = 'kccp-admin-activity'
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2h

function readPw(): string | null {
  try { return sessionStorage.getItem(PW_KEY) } catch { return null }
}
function writePw(pw: string | null): void {
  try {
    if (pw) sessionStorage.setItem(PW_KEY, pw)
    else sessionStorage.removeItem(PW_KEY)
  } catch { /* non-fatal */ }
}

function writeActivity(): void {
  try { sessionStorage.setItem(ACTIVITY_KEY, String(Date.now())) } catch { /* non-fatal */ }
}
function clearActivity(): void {
  try { sessionStorage.removeItem(ACTIVITY_KEY) } catch { /* non-fatal */ }
}
function isIdleExpired(): boolean {
  try {
    const raw = sessionStorage.getItem(ACTIVITY_KEY)
    if (!raw) return false
    return Date.now() - Number(raw) > IDLE_TIMEOUT_MS
  } catch { return false }
}

// Is there a session this tab is about to restore — a saved break-glass password, or one
// of supabase-js's persisted token entries? Used only to pick the *initial* status, so a
// signed-in admin opens on the loading screen instead of watching the login form flash
// past while the restore (which is always at least a round trip away) completes.
function hasRestorableSession(): boolean {
  try {
    if (readPw() && !isIdleExpired()) return true
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('sb-') && key.includes('auth-token')) return true
    }
  } catch {
    /* non-fatal */
  }
  return false
}

export type AdminStatus = 'idle' | 'verifying' | 'authed' | 'error'
export type AdminAuthMethod = 'password' | 'google' | null

interface AdminAuthState {
  status: AdminStatus
  identity: AdminIdentity | null
  method: AdminAuthMethod
  // captureLocation requests the browser's GPS for the login record — only on an explicit
  // user sign-in. Passive rehydration (silent reload) passes false so reloads never prompt.
  verify: (password: string, captureLocation?: boolean) => Promise<boolean>
  signInWithGoogle: (returnTo?: '/kiosk') => Promise<void>
  signOut: () => void
  // 두 부를 다 맡는 계정이 부를 고르거나 건너간다 (identity.canChoosePartition).
  chosenPartition: Partition | null
  choosePartition: (partition: Partition) => Promise<void>
  // 영역을 둘 이상 가진 자격이 고른 영역. 부(部) 고르기와 같은 자리에 사는 같은 성질의
  // 값이다 — 서버가 준 것 중에서 **화면을 고르는** 것일 뿐, 권한이 아니다. 하나뿐인
  // 자격에게는 AdminShell이 자동으로 채워 넣어 이 화면이 뜨지 않는다.
  chosenArea: Area | null
  chooseArea: (area: Area) => void
}

export const useAdminAuth = create<AdminAuthState>((set) => ({
  status: hasRestorableSession() ? 'verifying' : 'idle',
  identity: null,
  method: null,
  // api 계층도 같은 값을 같은 자리에서 읽는다 (lib/partition) — 첫 요청의 헤더와 첫 렌더가
  // 같은 부를 보게 하려면 둘 중 하나가 다른 하나를 기다려선 안 된다.
  chosenPartition: readStoredPartition(),
  chosenArea: null,

  // Break-glass: device + master password (unchanged).
  verify: async (password, captureLocation = true) => {
    set({ status: 'verifying' })
    try {
      setAdminPassword(password)
      // Best-effort precise location, only for an explicit sign-in (not a silent reload).
      // Guarded against hanging (see getLoginPosition); resolves null if declined/unsupported.
      const coords = captureLocation ? await getLoginPosition(GEO_LOGIN_WAIT_MS) : null
      const identity = await adminVerify(password, coords)
      writePw(password)
      writeActivity()
      set({ status: 'authed', identity, method: 'password' })
      return true
    } catch {
      setAdminPassword(null)
      writePw(null)
      clearActivity()
      set({ status: 'error', identity: null, method: null })
      return false
    }
  },

  // Google sign-in: triggers the OAuth redirect; onAuthStateChange handles the callback,
  // which lands on `returnTo` ('/kiosk' from the kiosk gate) or /admin by default.
  signInWithGoogle: async (returnTo) => {
    set({ status: 'verifying' })
    try {
      if (returnTo) sessionStorage.setItem(RETURN_KEY, returnTo)
      else sessionStorage.removeItem(RETURN_KEY)
    } catch { /* non-fatal */ }
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Redirect to the site root (a real file) so GitHub Pages serves it directly — no
      // dependence on the 404.html SPA fallback. The auth handler routes to /admin once
      // the session verifies.
      options: { redirectTo: 'https://shrlak.github.io/kccp-attendance/' },
    })
    // Page redirects away — control does not return here.
  },

  // 부를 고른다 / 건너간다. 고른 값은 다음 요청부터 X-Partition으로 실려 나가고, 서버가
  // 그 이메일이 고를 수 있는 사람인지 확인한 뒤에만 따른다.
  //
  // 캐시를 먼저 비우는 것이 핵심이다: 화면에 남아 있는 명단·출석·설정은 전부 **저쪽 부의
  // 것**이라, 비우지 않으면 새 부의 패널이 이전 부의 사람들로 한 번 그려진다. 그리고 신원을
  // 다시 받아야(identity.partition) 탭 구성과 부 이름이 새 부의 것이 된다.
  choosePartition: async (partition) => {
    if (useAdminAuth.getState().chosenPartition === partition) return
    setAdminPartition(partition)
    set({ chosenPartition: partition, status: 'verifying' })
    clearPersistedQueries()
    queryClient.clear()
    try {
      // 부를 바꾸는 것은 로그인이 아니다 — 위치를 다시 물어보지 않는다.
      const identity = await adminVerifyGoogle(null)
      set({ status: 'authed', identity })
    } catch {
      set({ status: 'authed' })
    }
  },

  chooseArea: (area) => set({ chosenArea: area }),

  signOut: () => {
    setAdminPassword(null)
    setAdminToken(null)
    setAdminPartition(null)
    writePw(null)
    clearActivity()
    // The roster snapshot kept for fast reloads (lib/queryPersist) belongs to whoever
    // was signed in — drop it with the session, in memory and on disk alike, so the next
    // login never paints the previous admin's scope.
    clearPersistedQueries()
    queryClient.clear()
    void supabase.auth.signOut()
    set({ status: 'idle', identity: null, method: null, chosenPartition: null, chosenArea: null })
  },
}))

// Keep the password-session activity timestamp warm while the tab is actually in use, so
// the idle clock measures inactivity rather than just time-since-login. Google sessions
// don't track this — they're exempt from the idle re-login requirement. Throttled so a
// burst of interaction doesn't hammer sessionStorage.
let lastActivityWrite = 0
function bumpActivity(): void {
  if (useAdminAuth.getState().method !== 'password') return
  const now = Date.now()
  if (now - lastActivityWrite < 60_000) return
  lastActivityWrite = now
  writeActivity()
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', bumpActivity, { passive: true })
  window.addEventListener('keydown', bumpActivity, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') bumpActivity()
  })
}

// Whether this page load is the OAuth redirect landing. Supabase appends `?code=` (PKCE)
// or a `#access_token=` hash (implicit) to the redirect URL. Captured at module load —
// before supabase-js strips it — so we can route to /admin once the session verifies,
// regardless of whether the callback surfaces as INITIAL_SESSION or SIGNED_IN (the event
// differs across supabase-js versions).
const isOAuthCallback =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('code') ||
    window.location.hash.includes('access_token'))

// Route to the post-login page without a full reload (the OAuth redirect lands at the
// site root). Honors the stored return path — '/kiosk' when the sign-in started at the
// kiosk gate, /admin otherwise. React Router listens for popstate, so dispatching one
// makes it render the new path.
function navigateAfterOAuth(): void {
  if (typeof window === 'undefined') return
  let path = '/admin'
  try {
    if (sessionStorage.getItem(RETURN_KEY) === '/kiosk') path = '/kiosk'
    sessionStorage.removeItem(RETURN_KEY)
  } catch { /* non-fatal */ }
  const full = `/kccp-attendance${path}`
  if (window.location.pathname.startsWith(full)) return
  window.history.pushState({}, '', full)
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
}

// Verify a Google session with the edge function. On success, reflect it in the store and
// — when this load is the fresh OAuth callback — route to the return path (/admin, or
// /kiosk when the sign-in started at the kiosk gate) so the user lands where they meant
// to go instead of the public landing page. Returns false if the session isn't an
// authorized admin (caller decides how to surface that).
async function verifyGoogleSession(accessToken: string, captureLocation: boolean): Promise<boolean> {
  useAdminAuth.setState({ status: 'verifying' })
  try {
    setAdminToken(accessToken)
    // Best-effort precise location, only on a fresh sign-in (not a passive session restore
    // on every reload). Guarded against hanging; resolves null if declined/unsupported.
    const coords = captureLocation ? await getLoginPosition(GEO_LOGIN_WAIT_MS) : null
    const identity = await adminVerifyGoogle(coords)
    useAdminAuth.setState({ status: 'authed', identity, method: 'google' })
    if (isOAuthCallback) navigateAfterOAuth()
    return true
  } catch {
    setAdminToken(null)
    return false
  }
}

// A saved break-glass password is only worth rehydrating if the tab hasn't been idle past
// the timeout — otherwise drop it so the reload lands on the login screen instead of
// silently re-authing a long-stale session.
// Nothing left to restore: drop the optimistic 'verifying' the store may have started in
// (see hasRestorableSession) so the login form actually appears. Only ever moves *out* of
// 'verifying', so it can't stomp on a real sign-in that's already in flight.
function settleIdle(): void {
  if (useAdminAuth.getState().status === 'verifying') {
    useAdminAuth.setState({ status: 'idle', identity: null, method: null })
  }
}

function rehydratePassword(): void {
  const stored = readPw()
  if (!stored) {
    settleIdle()
    return
  }
  if (isIdleExpired()) {
    writePw(null)
    clearActivity()
    settleIdle()
    return
  }
  // Silent reload re-auth — not an explicit sign-in, so don't prompt for location.
  void useAdminAuth.getState().verify(stored, false)
}

// Handle Supabase auth state. An OAuth callback may arrive as INITIAL_SESSION or SIGNED_IN
// depending on the supabase-js version, so both verify + route through the same helper.
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'INITIAL_SESSION') {
    if (session?.access_token) {
      // Active Google session — verify it; if it's not an admin, fall back to a saved
      // break-glass password rather than showing an error on a passive page load. Capture
      // location only when this load is the fresh OAuth callback (a real sign-in), not a
      // passive session restore on an ordinary reload.
      const ok = await verifyGoogleSession(session.access_token, isOAuthCallback)
      if (!ok) {
        useAdminAuth.setState({ status: 'idle', identity: null, method: null })
        rehydratePassword()
      }
    } else {
      // No Google session — try a saved break-glass password.
      rehydratePassword()
    }
  } else if (event === 'SIGNED_IN' && session?.access_token) {
    if (useAdminAuth.getState().status === 'authed') return
    // Active sign-in — surface an error if this Google account isn't an authorized admin.
    // This is an explicit login, so capture location.
    const ok = await verifyGoogleSession(session.access_token, true)
    if (!ok) useAdminAuth.setState({ status: 'error', identity: null })
  } else if (event === 'SIGNED_OUT') {
    setAdminToken(null)
  }
})

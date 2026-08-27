// The admin panel's tabs, and where the last-viewed one is remembered so a reload comes
// back to the screen the admin was actually on instead of dropping them on 오늘. Kept in
// sessionStorage — the same scope as the admin session itself (per browser tab, gone when
// the tab closes), so a shared kiosk/office computer never resurrects someone else's tab.
export const ADMIN_TABS = [
  'today',
  'sheet',
  'members',
  'analytics',
  'newfamily',
  'newfamilyEdu',
  'visitors',
  'admins',
  'dongsan',
  'settings',
] as const

export type Tab = (typeof ADMIN_TABS)[number]

const KEY = 'kccp-admin-tab'

export function isTab(value: unknown): value is Tab {
  return typeof value === 'string' && (ADMIN_TABS as readonly string[]).includes(value)
}

// The remembered tab, or null when there is none, it's unrecognised (an older build's id),
// or storage is unreachable — Safari private mode throws on the very access.
export function readLastTab(): Tab | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return isTab(raw) ? raw : null
  } catch {
    return null
  }
}

export function writeLastTab(tab: Tab): void {
  try { sessionStorage.setItem(KEY, tab) } catch { /* non-fatal */ }
}

// Signing out ends the session, so the next person to sign in on this device starts on
// 오늘 rather than wherever the previous admin left off.
export function clearLastTab(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* non-fatal */ }
}

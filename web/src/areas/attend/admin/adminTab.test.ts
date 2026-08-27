import { describe, it, expect, beforeEach } from 'vitest'
import { ADMIN_TABS, isTab, readLastTab, writeLastTab, clearLastTab } from './adminTab'

beforeEach(() => { sessionStorage.clear() })

describe('adminTab (마지막으로 보던 탭 기억)', () => {
  it('round-trips a tab through sessionStorage', () => {
    expect(readLastTab()).toBeNull()
    writeLastTab('newfamilyEdu')
    expect(readLastTab()).toBe('newfamilyEdu')
    clearLastTab()
    expect(readLastTab()).toBeNull()
  })

  it('rejects anything that is not a known tab id', () => {
    expect(isTab('today')).toBe(true)
    expect(isTab('nope')).toBe(false)
    expect(isTab(null)).toBe(false)
    expect(isTab(3)).toBe(false)
    // A value left by an older build must not resurrect a tab that no longer exists.
    sessionStorage.setItem('kccp-admin-tab', 'retired-tab')
    expect(readLastTab()).toBeNull()
  })

  it('every id in ADMIN_TABS survives a round trip', () => {
    for (const tab of ADMIN_TABS) {
      writeLastTab(tab)
      expect(readLastTab()).toBe(tab)
    }
  })
})

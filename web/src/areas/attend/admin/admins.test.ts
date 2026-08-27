import { describe, it, expect } from 'vitest'
import {
  sortAdminRoles,
  auditDetail,
  formatLoginLocation,
  loginLocationDisplay,
  groupLoginsByPartition,
  roleNeedsScope,
  formatBytes,
  backupTotalSize,
  formatBackupTimestamp,
  storagePercent,
  formatStoragePercent,
} from './admins'
import type { AdminRoleRow, DbBackupEntry, LoginLogEntry } from '../../../lib/api'

const row = (name: string, role: AdminRoleRow['role']): AdminRoleRow => ({
  memberId: name, name, role, group: '', subgroup: '', ministry: '',
})

describe('sortAdminRoles', () => {
  it('orders by role seniority then name', () => {
    const rows = [row('Zed', 'leader'), row('Amy', 'super_admin'), row('Bob', 'leader'), row('Cara', 'pastor')]
    expect(sortAdminRoles(rows).map((r) => r.name)).toEqual(['Amy', 'Cara', 'Bob', 'Zed'])
  })
  it('does not mutate the input', () => {
    const rows = [row('B', 'leader'), row('A', 'super_admin')]
    sortAdminRoles(rows)
    expect(rows[0].name).toBe('B')
  })
})

describe('roleNeedsScope', () => {
  it('only leader needs a group scope', () => {
    expect(roleNeedsScope('leader')).toBe(true)
    expect(roleNeedsScope('super_admin')).toBe(false)
    expect(roleNeedsScope('pastor')).toBe(false)
    expect(roleNeedsScope('welcoming')).toBe(false)
  })
})

describe('auditDetail', () => {
  it('handles string, {info}, object, and null', () => {
    expect(auditDetail('hi')).toBe('hi')
    expect(auditDetail({ info: '김호연 | 2026-06-07' })).toBe('김호연 | 2026-06-07')
    expect(auditDetail({ a: 1 })).toBe('{"a":1}')
    expect(auditDetail(null)).toBe('')
    expect(auditDetail(undefined)).toBe('')
  })
})

describe('formatBytes', () => {
  it('stays in bytes under 1000', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
  })
  it('steps up through KB/MB/GB', () => {
    expect(formatBytes(1000)).toBe('1.0 KB')
    expect(formatBytes(123_456)).toBe('123.5 KB')
    expect(formatBytes(1_500_000)).toBe('1.5 MB')
    expect(formatBytes(2_300_000_000)).toBe('2.3 GB')
  })
})

describe('backup metadata', () => {
  const backup: DbBackupEntry = {
    date: '2026-07-19',
    current: true,
    sqlSize: 1_500_000,
    schemaSize: 250_000,
  }

  it('uses the encrypted SQL and schema sizes when the API total is absent', () => {
    expect(backupTotalSize(backup)).toBe(1_750_000)
    expect(backupTotalSize({ ...backup, totalSize: 2_000_000 })).toBe(2_000_000)
  })

  it('formats the completion time in Pittsburgh rather than the browser timezone', () => {
    expect(formatBackupTimestamp('2026-07-19T21:15:00.000Z', 'en-US')).toContain('5:15 PM')
    expect(formatBackupTimestamp(undefined, 'en-US')).toBe('')
    expect(formatBackupTimestamp('not-a-date', 'en-US')).toBe('')
  })
})

describe('backup storage usage', () => {
  it('computes a clamped percent', () => {
    expect(storagePercent(0, 10e9)).toBe(0)
    expect(storagePercent(5e9, 10e9)).toBe(50)
    expect(storagePercent(20e9, 10e9)).toBe(100)
    expect(storagePercent(1, 0)).toBe(0)
  })

  it('labels tiny-but-nonzero usage as <0.1% instead of rounding to zero', () => {
    expect(formatStoragePercent(0, 10e9)).toBe('0.0%')
    expect(formatStoragePercent(700_000, 10e9)).toBe('<0.1%')
    expect(formatStoragePercent(1.5e9, 10e9)).toBe('15.0%')
    expect(formatStoragePercent(10e9, 10e9)).toBe('100.0%')
  })
})

describe('formatLoginLocation', () => {
  const loc = { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', lat: 40.44, lon: -79.99, org: 'Comcast' }
  it('joins city, region, country', () => {
    expect(formatLoginLocation(loc)).toBe('Pittsburgh, Pennsylvania, United States')
  })
  it('drops empty parts', () => {
    expect(formatLoginLocation({ ...loc, city: '', region: '' })).toBe('United States')
  })
  it('is empty for unresolved or private-IP entries', () => {
    expect(formatLoginLocation(null)).toBe('')
    expect(formatLoginLocation(undefined)).toBe('')
    expect(formatLoginLocation({ city: '', region: '', country: '', lat: null, lon: null, org: '' })).toBe('')
  })
})

describe('loginLocationDisplay', () => {
  const ipLoc = { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', lat: 40.44, lon: -79.99, org: 'Comcast' }
  it('prefers precise GPS with its reverse-geocoded address', () => {
    const d = loginLocationDisplay({ location: ipLoc, gps: { lat: 40.4502, lon: -79.9348, accuracy: 12, address: '123 Main St, Pittsburgh, PA' } })
    expect(d).toEqual({ text: '123 Main St, Pittsburgh, PA', lat: 40.4502, lon: -79.9348, accuracy: 12, precise: true })
  })
  it('falls back to raw GPS coordinates when the address has not resolved yet', () => {
    const d = loginLocationDisplay({ location: null, gps: { lat: 40.45021, lon: -79.93481, accuracy: 8, address: '' } })
    expect(d.precise).toBe(true)
    expect(d.text).toBe('40.45021, -79.93481')
  })
  it('falls back to the city-level IP estimate when no GPS was granted', () => {
    const d = loginLocationDisplay({ location: ipLoc, gps: null })
    expect(d).toEqual({ text: 'Pittsburgh, Pennsylvania, United States', lat: 40.44, lon: -79.99, accuracy: null, precise: false })
  })
  it('is empty when neither GPS nor IP resolved', () => {
    const d = loginLocationDisplay({ location: null, gps: null })
    expect(d.text).toBe('')
    expect(d.lat).toBeNull()
  })
})

describe('groupLoginsByPartition', () => {
  const ipLoc = { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', lat: 40.44, lon: -79.99, org: 'Comcast' }
  const entry = (extra: Partial<LoginLogEntry> = {}): LoginLogEntry => ({
    ts: 1_000, role: 'super_admin', memberName: '김호연', deviceId: 'DEV-1', ip: '1.2.3.4',
    method: 'google', location: ipLoc, gps: null, partition: 'youth', ...extra,
  })

  it('부마다 자기 묶음으로 간다', () => {
    const groups = groupLoginsByPartition([
      entry({ ts: 3, partition: 'adult' }),
      entry({ ts: 2, partition: 'youth' }),
      entry({ ts: 1, partition: 'adult' }),
    ])
    expect(groups.map((g) => g.partition)).toEqual(['youth', 'adult'])
    expect(groups[0].entries.map((e) => e.ts)).toEqual([2])
    expect(groups[1].entries.map((e) => e.ts)).toEqual([3, 1])
  })

  it('순서는 고정이다 — 최근 활동으로 자리가 바뀌지 않는다', () => {
    // 장년부 로그인이 훨씬 최근이어도 대학·청년부가 먼저다: 부는 닫힌 집합이라 자리가
    // 움직이면 매번 어디를 봐야 할지 다시 찾게 된다.
    const groups = groupLoginsByPartition([
      entry({ ts: 9_999, partition: 'adult' }),
      entry({ ts: 1, partition: 'youth' }),
    ])
    expect(groups.map((g) => g.partition)).toEqual(['youth', 'adult'])
  })

  it('부 안에서는 받은 순서(새 것부터) 그대로다', () => {
    const groups = groupLoginsByPartition([
      entry({ ts: 30 }), entry({ ts: 20 }), entry({ ts: 10 }),
    ])
    expect(groups[0].entries.map((e) => e.ts)).toEqual([30, 20, 10])
  })

  it("부가 없는 지난 기록은 '부 미기록'으로 모여 맨 아래에 남는다", () => {
    const groups = groupLoginsByPartition([
      entry({ ts: 9, partition: '' }),        // 제일 최근이지만
      entry({ ts: 8, partition: undefined }), // 옛 엣지 함수 응답에는 칸 자체가 없다
      entry({ ts: 1, partition: 'youth' }),
    ])
    expect(groups.map((g) => g.partition)).toEqual(['youth', ''])
    expect(groups[1].entries.map((e) => e.ts)).toEqual([9, 8])
  })

  it('알 수 없는 값은 지어내지 않고 미기록으로 떨어진다', () => {
    const groups = groupLoginsByPartition([entry({ partition: 'em' as never })])
    expect(groups.map((g) => g.partition)).toEqual([''])
  })

  it('비어 있는 부는 아예 내놓지 않는다 — 제목만 있고 아래가 빈 묶음은 만들지 않는다', () => {
    const groups = groupLoginsByPartition([entry({ partition: 'adult' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].partition).toBe('adult')
  })

  it('빈 목록은 빈 결과다', () => {
    expect(groupLoginsByPartition([])).toEqual([])
  })
})

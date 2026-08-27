import type { AdminRoleRow, AdminRole, DbBackupEntry, LoginLocation, LoginLogEntry } from '../../../lib/api'
import type { Partition } from '../../../lib/partition'

// 'staff'는 합성 비상구 역할이라 admin 행으로 저장되지 않는다 — 순위는 Record의 빠짐없음을
// 만족시키려고 있을 뿐, 관리자 목록에 실제로 나타나지 않는다.
//
// 'owner'와 'media'도 같다. 둘 다 member_roles 행이 아니라 **자격 자체**에서 나온다
// (auth.ts의 OWNER_EMAIL·MEDIA_ACCOUNTS). 그래서 이 표에는 자리만 있고 쓰이지 않는다.
// Record를 빠짐없이 두는 것이 여기서 값을 한다: 서버에 역할이 하나 늘면 이 줄이
// 컴파일을 멈춰, 새 역할이 목록에서 조용히 순위 undefined로 정렬되는 일을 막는다.
const RANK: Record<AdminRole, number> = {
  super_admin: 0, pastor: 1, leader: 2, welcoming: 3, staff: 4, owner: 5, media: 6,
}

// Admin grants ordered by role seniority, then by name.
export function sortAdminRoles(rows: AdminRoleRow[]): AdminRoleRow[] {
  return [...rows].sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name))
}

// A leader grant must carry a 부서 (group); other roles are global. Drives the add form.
export function roleNeedsScope(role: AdminRole): boolean {
  return role === 'leader'
}

// One display line for a login's IP-derived place — "City, Region, Country" with empty
// parts dropped; '' when nothing resolved (private IP, or the lookup hasn't run yet).
export function formatLoginLocation(loc: LoginLocation | null | undefined): string {
  if (!loc) return ''
  return [loc.city, loc.region, loc.country].filter(Boolean).join(', ')
}

// Best available location for a login entry: the precise device GPS (street-level address,
// or raw coordinates until reverse-geocoded) when the admin allowed location at sign-in,
// otherwise the approximate city-level IP estimate. `precise` distinguishes the two so the
// UI can label + map them accordingly; `lat`/`lon` drive the map link.
export interface LoginLocationDisplay {
  text: string
  lat: number | null
  lon: number | null
  accuracy: number | null
  precise: boolean
}
export function loginLocationDisplay(e: Pick<LoginLogEntry, 'location' | 'gps'>): LoginLocationDisplay {
  if (e.gps) {
    return {
      text: e.gps.address || `${e.gps.lat.toFixed(5)}, ${e.gps.lon.toFixed(5)}`,
      lat: e.gps.lat,
      lon: e.gps.lon,
      accuracy: e.gps.accuracy,
      precise: true,
    }
  }
  return { text: formatLoginLocation(e.location), lat: e.location?.lat ?? null, lon: e.location?.lon ?? null, accuracy: null, precise: false }
}

// ── 로그인 기록을 부서별로 가른다 ─────────────────────────────────────────────────────
//
// login_log는 부서를 가리지 않는 공용 표라 두 부의 로그인이 한 목록에 섞여 있다. 한 사람이
// 두 부를 오갈 수 있게 된 뒤로는 "누가 들어왔나"와 "어느 부로 들어왔나"가 서로 다른 사실이
// 되었고, 뒤엣것이 이 목록에서 제일 먼저 눈에 들어와야 한다.
//
// 묶음의 순서는 **고정**이다 (대학·청년부 → 장년부 → 부 미기록). 주소와 달리 부는 닫힌
// 집합이라, 최근 활동에 따라 자리가 바뀌면 매번 어디를 봐야 할지 다시 찾게 된다.
//
// 부 미기록('')은 부가 기록되기 전의 공용 비밀번호 로그인이다. 어느 비밀번호를 쳤는지는
// 어디에도 남지 않아 되살릴 수 없으므로(20260814 참고), 지어내지 않고 따로 모아 맨 아래 둔다.
export type LoginPartitionKey = Partition | ''

export interface LoginPartitionGroup {
  /** 'youth' · 'adult' · '' (부 미기록). React key로도 쓴다. */
  partition: LoginPartitionKey
  /** 이 부의 로그인 — 들어온 순서 그대로(새 것부터). */
  entries: LoginLogEntry[]
}

const PARTITION_ORDER: LoginPartitionKey[] = ['youth', 'adult', '']

export function groupLoginsByPartition(entries: LoginLogEntry[]): LoginPartitionGroup[] {
  const buckets = new Map<LoginPartitionKey, LoginLogEntry[]>()
  for (const e of entries) {
    const key: LoginPartitionKey = e.partition === 'youth' || e.partition === 'adult' ? e.partition : ''
    const found = buckets.get(key)
    if (found) found.push(e)
    else buckets.set(key, [e])
  }
  // 비어 있는 부는 아예 내놓지 않는다 — 제목만 있고 아래가 빈 묶음은 읽는 사람을 멈추게 한다.
  return PARTITION_ORDER.filter((p) => buckets.has(p)).map((partition) => ({
    partition,
    entries: buckets.get(partition)!,
  }))
}

// Flatten an audit entry's details (string, {info}, or arbitrary object) to one line.
export function auditDetail(details: unknown): string {
  if (details == null) return ''
  if (typeof details === 'string') return details
  if (typeof details === 'object' && 'info' in (details as Record<string, unknown>)) {
    return String((details as Record<string, unknown>).info)
  }
  return JSON.stringify(details)
}

// Human-readable file size, e.g. 1234 -> "1.2 KB". Decimal (1000-based), matching
// scripts/backup/prune-retention.py's GB math so the two size displays agree.
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let i = 0
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

// Prefer the server-computed encrypted payload size, but derive it for legacy dated
// entries returned during the one-time transition to the stable current.* object names.
export function backupTotalSize(backup: DbBackupEntry): number | undefined {
  if (backup.totalSize != null) return backup.totalSize
  if (backup.sqlSize == null && backup.schemaSize == null) return undefined
  return (backup.sqlSize ?? 0) + (backup.schemaSize ?? 0)
}

// Percent of the backup-storage allowance used, clamped to [0, 100] for the bar width.
export function storagePercent(usedBytes: number, limitBytes: number): number {
  if (!(limitBytes > 0)) return 0
  return Math.min(100, Math.max(0, (usedBytes / limitBytes) * 100))
}

// Label next to the bar: tiny-but-nonzero usage reads "<0.1%" instead of a misleading
// "0.0%" (a few hundred KB of encrypted dump against a 10 GB allowance rounds to zero).
export function formatStoragePercent(usedBytes: number, limitBytes: number): string {
  const pct = storagePercent(usedBytes, limitBytes)
  if (usedBytes > 0 && pct < 0.1) return '<0.1%'
  return `${pct.toFixed(1)}%`
}

// Backup times are operational Pittsburgh times regardless of the browser's location.
export function formatBackupTimestamp(updatedAt: string | undefined, locale = 'ko'): string {
  if (!updatedAt) return ''
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale, {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

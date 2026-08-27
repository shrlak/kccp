import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAdminRoles,
  getAuditLog,
  getLoginLog,
  setAdminRole,
  removeAdminRole,
  getClearPending,
  approveClear,
  rejectClear,
  runDbBackupNow,
  listDbBackups,
  getDbBackupDownloadUrl,
  restoreDbBackup,
  type AdminRole,
  type RoleAssignment,
  type DbBackupEntry,
} from '../../../lib/api'
import {
  sortAdminRoles,
  auditDetail,
  loginLocationDisplay,
  groupLoginsByPartition,
  roleNeedsScope,
  formatBytes,
  backupTotalSize,
  formatBackupTimestamp,
  storagePercent,
  formatStoragePercent,
} from './admins'
import { useRoster } from './useRoster'
import { useAdminAuth } from '../../../stores/useAdminAuth'
import { groupsOf, subgroupsOf } from './filters'
import { checkinCandidates } from './today'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { Tag } from '../../../components/ui/Tag'
import {
  Shield, UserPlus, ClipboardList, MapPin, X, Check, AlertTriangle,
} from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import type { ReactNode } from 'react'
import { refreshRoster, refreshRosterSettled } from '../../../lib/live'
import { usePartition, usePartitionT } from '../../../lib/useAppConfig'

const ROLES: AdminRole[] = ['super_admin', 'leader', 'pastor', 'welcoming']

type TagTone = 'primary' | 'gold' | 'info' | 'success' | 'muted'
const ROLE_TONE: Record<string, TagTone> = {
  super_admin: 'gold',
  leader: 'primary',
  pastor: 'info',
  welcoming: 'success',
}
const roleTone = (role: string): TagTone => ROLE_TONE[role] ?? 'muted'

// Section header: a soft icon chip, a display title, an optional count badge, and an
// optional right-aligned action — the shared heading for every block on this screen.
function Heading({
  icon,
  tone,
  title,
  count,
  action,
}: {
  icon: ReactNode
  tone: string
  title: string
  count?: number
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className={`grid size-8 shrink-0 place-items-center rounded-full ${tone}`}>{icon}</span>
      <h3 className="font-display text-lg font-bold tracking-tight text-text">{title}</h3>
      {count != null && (
        <span className="rounded-full bg-fill px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">{count}</span>
      )}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

type DbRestoreTarget = { source: 'online'; key: string; date: string } | { source: 'upload'; file: File }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

// Admins tab (super-admin): the admin roster with add/remove, the audit + login logs,
// the clear-attendance request queue, and backups.
export function AdminAdmins() {
  const t = usePartitionT()
  const { i18n } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  // 백업은 부서별 줄기다 — 대학·청년부는 데이터베이스 전체 스냅숏, 장년부는 장년부 데이터만.
  // 목록·다운로드·복원은 서버가 이미 자기 접두사만 보여주므로, 여기서는 설명 문구만 맞춘다.
  const partition = usePartition()
  const { data: rolesData, isLoading: rolesLoading } = useQuery({ queryKey: ['adminRoles'], queryFn: getAdminRoles })
  const { data: clearPending } = useQuery({ queryKey: ['clearPending'], queryFn: getClearPending })
  const [clearBusy, setClearBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [roleBusy, setRoleBusy] = useState<string | null>(null)
  const [showAudit, setShowAudit] = useState(false)
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => getAuditLog(100),
    enabled: showAudit,
  })
  // The login-history (with per-IP location) section is 김호연-only — the server decides
  // via the verify response (see AdminIdentity.canViewLoginLog) and 403s everyone else.
  const canViewLogins = useAdminAuth((s) => !!s.identity?.canViewLoginLog)
  const [showLogins, setShowLogins] = useState(false)
  const { data: loginData, isLoading: loginLoading } = useQuery({
    queryKey: ['loginLog'],
    queryFn: () => getLoginLog(100),
    enabled: showLogins && canViewLogins,
  })
  async function removeRole(memberId: string) {
    setRoleBusy(memberId)
    try {
      await removeAdminRole(memberId)
      await qc.invalidateQueries({ queryKey: ['adminRoles'] })
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setRoleBusy(null)
    }
  }

  // ── Off-site encrypted DB backup (scripts/backup/) ──────────────────────
  const dbRestoreFileRef = useRef<HTMLInputElement>(null)
  const [showDbBackups, setShowDbBackups] = useState(false)
  const { data: dbBackupsData, isLoading: dbBackupsLoading } = useQuery({
    queryKey: ['dbBackups'],
    queryFn: listDbBackups,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  const [dbBackupRunBusy, setDbBackupRunBusy] = useState(false)
  const [dbRestoreTarget, setDbRestoreTarget] = useState<DbRestoreTarget | null>(null)

  async function runDbBackup() {
    setDbBackupRunBusy(true)
    try {
      await runDbBackupNow()
      toast({ title: t('admin.admins.dbBackup.dispatched'), tone: 'ok' })
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setDbBackupRunBusy(false)
    }
  }

  async function downloadDbBackup(key: string) {
    try {
      const { url } = await getDbBackupDownloadUrl(key)
      window.open(url, '_blank')
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    }
  }

  function pickDbRestoreFile(file: File | null) {
    if (file) setDbRestoreTarget({ source: 'upload', file })
    if (dbRestoreFileRef.current) dbRestoreFileRef.current.value = ''
  }

  async function clearDecide(approve: boolean) {
    setClearBusy(true)
    try {
      if (approve) {
        await approveClear()
        refreshRoster(qc)
      } else {
        await rejectClear()
      }
      await qc.invalidateQueries({ queryKey: ['clearPending'] })
      toast({ title: t(approve ? 'admin.sheet.clearAll.cleared' : 'admin.admins.clearReq.rejected'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setClearBusy(false)
    }
  }

  const roles = sortAdminRoles(rolesData?.roles ?? [])
  const clearReqs = clearPending ?? []
  const currentBackup = dbBackupsData?.backups[0]
  const currentBackupSize = currentBackup ? backupTotalSize(currentBackup) : undefined
  const currentBackupTime = formatBackupTimestamp(currentBackup?.updatedAt, i18n.resolvedLanguage || i18n.language)

  return (
    <div className="w-full">
      {clearReqs.length > 0 && (
        <>
          <Heading icon={<AlertTriangle size={16} strokeWidth={2} aria-hidden />} tone="bg-danger/12 text-danger" title={t('admin.admins.clearReq.title')} />
          <div className="mb-6 rounded-2xl border border-danger/40 bg-danger/5 p-4">
            <p className="mb-3 text-xs text-muted">
              {t('admin.admins.clearReq.by', { name: clearReqs.map((r) => r.requestedByName).join(', ') })}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="danger" onClick={() => clearDecide(true)} disabled={clearBusy}>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                {t('admin.admins.clearReq.approve')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => clearDecide(false)} disabled={clearBusy}>
                {t('admin.admins.clearReq.reject')}
              </Button>
            </div>
          </div>
          <hr className="my-6 border-border" />
        </>
      )}
      <Heading
        icon={<Shield size={16} strokeWidth={2} aria-hidden />}
        tone="bg-primary/10 text-primary"
        title={t('admin.admins.adminsList')}
        count={roles.length}
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus size={15} strokeWidth={2} aria-hidden />
            {t('admin.admins.addAdmin')}
          </Button>
        }
      />
      {rolesLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.admins.noAdmins')}</p>
      ) : (
        <ul className="inset-list">
          {roles.map((r) => (
            <li key={r.memberId} className="inset-row min-h-14 justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-text">{r.name}</div>
                {(r.group || r.subgroup) && (
                  <div className="truncate text-xs text-muted">{[r.group, r.subgroup].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Tag tone={roleTone(r.role)}>{t(`admin.roles.${r.role}`)}</Tag>
                <button
                  type="button"
                  onClick={() => removeRole(r.memberId)}
                  disabled={roleBusy !== null}
                  aria-label={t('admin.admins.remove')}
                  className="grid min-h-11 min-w-11 place-items-center rounded-full text-danger transition-[background-color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-danger/10 active:scale-90 disabled:opacity-40"
                >
                  <X size={17} strokeWidth={2.25} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddAdminModal onClose={() => setAdding(false)} />}

      <hr className="my-6 border-border" />

      <Heading
        icon={<ClipboardList size={16} strokeWidth={2} aria-hidden />}
        tone="bg-fill text-muted"
        title={t('admin.admins.auditLog')}
        action={
          showAudit ? (
            <Button variant="ghost" size="sm" onClick={() => setShowAudit(false)}>
              {t('admin.admins.collapse')}
            </Button>
          ) : undefined
        }
      />
      {!showAudit ? (
        <Button variant="secondary" onClick={() => setShowAudit(true)}>
          {t('admin.admins.loadAudit')}
        </Button>
      ) : auditLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (auditData?.log.length ?? 0) === 0 ? (
        <p className="text-sm text-muted">{t('admin.admins.noAudit')}</p>
      ) : (
        <ul className="fx-rise inset-list text-xs">
          {auditData!.log.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-text">{e.action}</span>
                <span className="tabular-nums text-subtle">{new Date(e.ts).toLocaleString()}</span>
              </div>
              <div className="mt-0.5 text-muted">
                {e.adminName}
                {auditDetail(e.details) && <span className="text-subtle"> · {auditDetail(e.details)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canViewLogins && (
        <>
          <hr className="my-6 border-border" />

          <Heading
            icon={<MapPin size={16} strokeWidth={2} aria-hidden />}
            tone="bg-info/10 text-info"
            title={t('admin.admins.loginLog')}
            action={
              showLogins ? (
                <Button variant="ghost" size="sm" onClick={() => setShowLogins(false)}>
                  {t('admin.admins.collapse')}
                </Button>
              ) : undefined
            }
          />
          <p className="mb-3 -mt-1 text-xs text-muted">{t('admin.admins.loginLocationNote')}</p>
          {!showLogins ? (
            <Button variant="secondary" onClick={() => setShowLogins(true)}>
              {t('admin.admins.loadLogins')}
            </Button>
          ) : loginLoading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : (loginData?.log.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">{t('admin.admins.noLogins')}</p>
          ) : (
            // 부서가 묶음의 제목이다. 한 사람이 두 부를 오갈 수 있게 된 뒤로 "누가"와 "어느
            // 부로"는 서로 다른 사실이 되었고, 이 목록에서는 뒤엣것이 먼저 보여야 한다.
            <div className="fx-rise grid gap-4">
              {groupLoginsByPartition(loginData!.log).map((group) => (
                <section key={group.partition || 'unknown'}>
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 text-xs">
                    <span className="font-semibold text-text">
                      {group.partition
                        ? t(`admin.ministry.${group.partition}`)
                        : t('admin.admins.noPartition')}
                    </span>
                    <span className="tabular-nums text-subtle">
                      {t('admin.admins.loginCount', { n: group.entries.length })}
                    </span>
                  </div>
                  <ul className="inset-list text-xs">
                    {group.entries.map((e, i) => (
                      <li key={`${e.ts}-${i}`} className="px-4 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-semibold text-text">
                            {e.memberName || t('admin.admins.sharedLogin')}
                            <Tag tone={roleTone(e.role)}>{t(`admin.roles.${e.role}`)}</Tag>
                          </span>
                          <span className="tabular-nums text-subtle">{new Date(e.ts).toLocaleString()}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-muted">
                          {e.ip || '—'}
                          <span className="text-subtle"> · {t(`admin.admins.method.${e.method}`)}</span>
                        </div>
                        {(() => {
                          const loc = loginLocationDisplay(e)
                          if (!loc.text && loc.lat == null) return null
                          return (
                            <div className="mt-1 text-muted">
                              <span
                                className={`mr-1.5 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  loc.precise ? 'bg-primary/15 text-primary' : 'bg-fill text-subtle'
                                }`}
                              >
                                <MapPin size={10} strokeWidth={2.25} aria-hidden />
                                {loc.precise ? t('admin.admins.gpsPrecise') : t('admin.admins.gpsApprox')}
                              </span>
                              {loc.text}
                              {loc.precise && loc.accuracy != null && (
                                <span className="text-subtle"> · ±{Math.round(loc.accuracy)}m</span>
                              )}
                              {loc.lat != null && loc.lon != null && (
                                <a
                                  href={`https://www.google.com/maps?q=${loc.lat},${loc.lon}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ml-1.5 font-semibold text-primary underline"
                                >
                                  {t('admin.admins.map')}
                                </a>
                              )}
                            </div>
                          )
                        })()}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <hr className="my-6 border-border" />

      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="font-display text-lg font-semibold text-text">{t('admin.admins.dbBackup.title')}</h2>
        {currentBackup && currentBackupSize != null && currentBackupTime && (
          <span className="font-mono text-xs tabular-nums text-subtle" aria-live="polite">
            {t('admin.dbBackupCurrentMeta', { size: formatBytes(currentBackupSize), time: currentBackupTime })}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-muted">
        {t(partition === 'adult' ? 'admin.dbBackupCurrentDescAdult' : 'admin.dbBackupCurrentDesc')}
      </p>

      {dbBackupsData?.storage && (
        <div className="mb-3 rounded-lg border border-border bg-surface p-3">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
            <span className="font-semibold text-text">{t('admin.admins.dbBackup.storage')}</span>
            <span className="font-mono tabular-nums text-subtle">
              {t('admin.admins.dbBackup.storageUsage', {
                used: formatBytes(dbBackupsData.storage.usedBytes),
                limit: formatBytes(dbBackupsData.storage.limitBytes),
                percent: formatStoragePercent(dbBackupsData.storage.usedBytes, dbBackupsData.storage.limitBytes),
              })}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(storagePercent(dbBackupsData.storage.usedBytes, dbBackupsData.storage.limitBytes))}
            aria-label={t('admin.admins.dbBackup.storage')}
          >
            {/* Keep a visible sliver for any nonzero usage — real backups are a few
                hundred KB against a 10 GB allowance and would otherwise render 0px. */}
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{
                width: `${Math.max(
                  storagePercent(dbBackupsData.storage.usedBytes, dbBackupsData.storage.limitBytes),
                  dbBackupsData.storage.usedBytes > 0 ? 1 : 0,
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={runDbBackup} disabled={dbBackupRunBusy}>
          {dbBackupRunBusy ? t('common.loading') : t('admin.admins.dbBackup.runNow')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowDbBackups((v) => !v)}>
          {showDbBackups ? t('admin.admins.dbBackup.hideList') : t('admin.admins.dbBackup.showList')}
        </Button>
      </div>

      {showDbBackups && (
        <div className="mt-3">
          {dbBackupsLoading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : !dbBackupsData?.backups.length ? (
            <p className="text-sm text-muted">{t('admin.admins.dbBackup.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {dbBackupsData.backups.map((b: DbBackupEntry) => {
                const size = backupTotalSize(b)
                const time = formatBackupTimestamp(b.updatedAt, i18n.resolvedLanguage || i18n.language)
                return (
                <li key={b.sqlKey ?? b.date} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
                  <span className="font-semibold text-text">
                    {time || b.date}
                    {size != null && <span className="ml-2 font-normal text-subtle">{formatBytes(size)}</span>}
                  </span>
                  {b.sqlKey && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => downloadDbBackup(b.sqlKey!)}>
                        {t('admin.admins.dbBackup.download')}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDbRestoreTarget({ source: 'online', key: b.sqlKey!, date: time || b.date })}>
                        {t('admin.admins.dbBackup.restore')}
                      </Button>
                    </div>
                  )}
                </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
        <label className="text-sm font-semibold text-text">{t('admin.admins.dbBackup.restoreFromFile')}</label>
        <input
          ref={dbRestoreFileRef}
          type="file"
          accept=".age"
          onChange={(e) => pickDbRestoreFile(e.target.files?.[0] ?? null)}
          className="text-xs text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-xs file:font-semibold file:text-text hover:file:bg-surface-alt"
        />
      </div>

      {dbRestoreTarget && <RestoreDbDialog target={dbRestoreTarget} onClose={() => setDbRestoreTarget(null)} />}
    </div>
  )
}

function AddAdminModal({ onClose }: { onClose: () => void }) {
  const t = usePartitionT()
  const qc = useQueryClient()
  const toast = useToast()
  const { data } = useRoster(true)
  const [search, setSearch] = useState('')
  const [memberId, setMemberId] = useState('')
  const [role, setRole] = useState<AdminRole>('leader')
  const [group, setGroup] = useState('')
  const [subgroup, setSubgroup] = useState('')
  const [saving, setSaving] = useState(false)

  const members = data?.members ?? []
  const candidates = checkinCandidates(members, search).slice(0, 50)
  const groups = groupsOf(members)
  const subgroups = subgroupsOf(members, group)
  const needsScope = roleNeedsScope(role)
  const valid = !!memberId && !!role && (!needsScope || !!group)

  async function save() {
    if (!valid) return
    setSaving(true)
    try {
      const payload: RoleAssignment = needsScope
        ? { memberId, role, group, subgroup, ministry: 'KM' }
        : { memberId, role, ministry: role === 'welcoming' ? 'KM' : '' }
      await setAdminRole(payload)
      await qc.invalidateQueries({ queryKey: ['adminRoles'] })
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
      onClose()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.admins.addAdmin')}>
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.admins.member')}</span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('admin.members.search')} className="mb-2" />
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">—</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {[m.group_name, m.subgroup].filter(Boolean).length ? ` (${[m.group_name, m.subgroup].filter(Boolean).join(' · ')})` : ''}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.admins.role')}</span>
          <Select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`admin.roles.${r}`)}
              </option>
            ))}
          </Select>
        </label>
        {needsScope && (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.members.group')}</span>
              <Select value={group} onChange={(e) => { setGroup(e.target.value); setSubgroup('') }}>
                <option value="">—</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.members.subgroup')}</span>
              <Select value={subgroup} onChange={(e) => setSubgroup(e.target.value)} disabled={!group}>
                <option value="">{t('admin.filter.all')}</option>
                {subgroups.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button onClick={save} disabled={!valid || saving} className="flex-1">
          {saving ? t('common.loading') : t('admin.admins.addAdmin')}
        </Button>
      </div>
    </Dialog>
  )
}

// Confirms + runs a destructive DB-level restore (see /api/admin/db-backup/restore).
// Stronger gate than the JSON restore above: a private key must be typed in fresh (it is
// never stored anywhere, client or server) and the literal word RESTORE must be typed to
// enable the button, on top of this already only being reachable via its own confirm step.
function RestoreDbDialog({ target, onClose }: { target: DbRestoreTarget; onClose: () => void }) {
  // 장년부 복원은 장년부 행만 되돌린다 (엣지 함수의 ADULT_PARTITION_TABLES) — 경고 문구가
  // "전부 대체됩니다"라고 말하면 사실과 다르다.
  const partition = usePartition()
  const t = usePartitionT()
  const qc = useQueryClient()
  const toast = useToast()
  const [privateKey, setPrivateKey] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = privateKey.trim().startsWith('AGE-SECRET-KEY-1') && confirmText === 'RESTORE'

  async function run() {
    if (!valid) return
    setBusy(true)
    try {
      const fileBase64 = target.source === 'upload' ? await fileToBase64(target.file) : undefined
      const result = await restoreDbBackup({
        source: target.source,
        key: target.source === 'online' ? target.key : undefined,
        fileBase64,
        privateKey: privateKey.trim(),
        confirm: confirmText,
      })
      // Restoring swaps out the whole database — every other open device needs to drop
      // what it is showing, not just this tab. Unlike an ordinary save this one does wait
      // for the refetches: the dialog is about to hand the panel back with an entirely
      // different dataset behind it.
      await Promise.all([
        refreshRosterSettled(qc),
        qc.invalidateQueries({ queryKey: ['config'] }),
        qc.invalidateQueries({ queryKey: ['adminRoles'] }),
        qc.invalidateQueries({ queryKey: ['dbBackups'] }),
      ])
      toast({ title: t('admin.admins.dbBackup.restored', { count: result.tables }), tone: 'ok' })
      onClose()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()} title={t('admin.admins.dbBackup.restoreTitle')}>
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
          {t(partition === 'adult' ? 'admin.dbBackupRestoreWarningAdult' : 'admin.admins.dbBackup.restoreWarning')}
        </div>
        <p className="text-xs text-muted">
          {target.source === 'online'
            ? t('admin.admins.dbBackup.restoreFromOnline', { date: target.date })
            : t('admin.admins.dbBackup.restoreFromUpload', { name: target.file.name })}
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.admins.dbBackup.privateKey')}</span>
          <textarea
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="AGE-SECRET-KEY-1..."
            rows={3}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <span className="mt-1 block text-[11px] text-subtle">{t('admin.admins.dbBackup.privateKeyHint')}</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.admins.dbBackup.confirmPhrase', { phrase: 'RESTORE' })}</span>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={run} disabled={!valid || busy} className="flex-1">
          {busy ? t('common.loading') : t('admin.admins.dbBackup.restoreConfirm')}
        </Button>
      </div>
    </Dialog>
  )
}

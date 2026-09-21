import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { mergeMembers, bulkSetSubgroup, deleteMembers, getDongsanNames, type Member } from '../../../lib/api'
import { Dialog } from '../../../components/ui/Dialog'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { Search, ListChecks, Merge as MergeIcon, Users, AlertTriangle, EyeOff, ChevronDown, Trash2 } from '../../../components/ui/Icon'
import { mergeTargets, canMerge, mergeSummary, type MergeState } from './merge'
import { groupsOf } from './filters'
import { summerDongsanList } from './dongsan'
import { newFamilyWeek } from './newFamily'
import { NewFamilyWeekChip } from './NewFamilyWeekChip'
import { easternNow } from '../../../lib/checkinWindow'
import { noteOn } from '../../../lib/status'
import { IconKey } from './IconKey'
import { EditModal, AttendanceModal, Field } from './MemberDialogs'
import { resolveGroupColor } from './groupColors'
import { refreshRoster } from '../../../lib/live'
import { useAppConfig, usePartitionT } from '../../../lib/useAppConfig'

// Members management: searchable card grid; tap a card to edit (scoped + read-only
// enforced server-side). Renaming, group/동산 changes (= transfer), role, new-member,
// and contact fields all go through PUT /api/admin/member.
export function AdminMembers() {
  const t = usePartitionT()
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useAppConfig()
  // 일괄 이동의 동산 목록은 설정된 동산 이름에서 온다 — 학기가 바뀌어 아무도 동산에
  // 속해 있지 않을 때도 새 학기 동산으로 여러 명을 한 번에 넣을 수 있어야 하므로.
  const { data: dongsanNames } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [merging, setMerging] = useState(false)
  const [search, setSearch] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [showHidden, setShowHidden] = useState(false)

  if (isLoading) return (
    <div className="fx-fade space-y-6">
      <div className="fx-skeleton h-11 rounded-xl" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => <div key={i} className="fx-skeleton h-20 rounded-2xl" />)}
      </div>
    </div>
  )
  if (isError) return (
    <div className="fx-rise grid place-items-center py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-danger">{t('common.error')}</p>
    </div>
  )
  if (!data) return null

  const today = easternNow().date
  const q = search.trim().toLowerCase()
  const byName = (list: Member[]) => (q ? list.filter((m) => m.name.toLowerCase().includes(q)) : list)
  // useRoster has already taken the 숨긴 멤버 out of `data.members` — they are off the roster
  // everywhere in the app, and this tab is the one place they still surface: the 숨긴 멤버
  // section at the bottom. 지워진 게 아니라 접혀 있을 뿐이라, 카드를 눌러 표기를 풀거나
  // 종료일을 넣으면 바로 명단으로 돌아온다.
  const members = byName(data.members)
  const hiddenMembers = byName(data.hiddenMembers)
  const staffMembers = byName(data.staffMembers)
  const selectableMembers = [...data.members, ...data.hiddenMembers]
  const selectedMembers = selectableMembers.filter((m) => selected.has(m.id))
  // 일괄 이동 목록: 고른 멤버의 부서에 설정된 동산만 보여준다 — 대학부를 골랐으면 대학부
  // 동산, 청년부를 골랐으면 청년부 동산. 아직 아무도 안 골랐으면 양쪽을 다 보여주고,
  // 두 부서를 섞어 골랐으면 두 부서의 동산이 함께 나온다. 여름 모드는 합동 한 벌뿐.
  const selectedGroups = new Set(
    selectableMembers.filter((m) => selected.has(m.id)).map((m) => m.group_name).filter(Boolean),
  )
  const nameGroups = Object.keys(dongsanNames ?? {})
  const activeGroups = selectedGroups.size ? [...selectedGroups] : nameGroups
  const configuredDongsan = cfg?.summerMode
    ? summerDongsanList(dongsanNames ?? {})
    : activeGroups.flatMap((g) => dongsanNames?.[g] ?? [])
  // 이미 그 부서 누군가가 속해 있는 동산도 (설정에서 빠졌더라도) 고를 수 있게 둔다.
  const inUse = selectableMembers
    .filter((m) => (selectedGroups.size ? selectedGroups.has(m.group_name) : true))
    .map((m) => m.subgroup)
  const dongsanOptions = [...new Set([...configuredDongsan, ...inUse].filter(Boolean))].sort() as string[]

  // The card grid is split into one section per 부서 (대학부 first, then 청년부, …);
  // members without a 부서 gather in a trailing "—" section.
  const sections = [
    ...groupsOf(members).map((g) => ({ group: g, list: members.filter((m) => m.group_name === g) })),
    { group: '', list: members.filter((m) => !m.group_name) },
  ].filter((s) => s.list.length > 0)

  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    // 부서가 달라지면 고른 동산이 더 이상 후보가 아닐 수 있다 — 그때는 비운다.
    setTarget((cur) => (cur && !dongsanOptions.includes(cur) ? '' : cur))
  }
  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
    setTarget('')
  }
  async function applyBulk(subgroup: string) {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const res = await bulkSetSubgroup([...selected], subgroup)
      toast({ title: t('admin.members.bulkMove.done', { n: res.updated }), tone: 'ok' })
      refreshRoster(qc)
      exitSelect()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBulkBusy(false)
    }
  }
  async function applyBulkDelete() {
    if (selectedMembers.length === 0) return
    setBulkBusy(true)
    try {
      const res = await deleteMembers(selectedMembers.map((m) => m.id))
      toast({ title: t('admin.members.bulkDelete.done', { n: res.deleted }), tone: 'ok' })
      refreshRoster(qc)
      setConfirmBulkDelete(false)
      exitSelect()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <>
      {/* 검색 · 동산 이동 · 병합은 명단을 한참 내려가도 계속 손이 닿아야 한다 — 아래에서
          사람을 고르다가 이동시키려고 매번 맨 위로 되돌아가지 않도록 패널 헤더 바로 밑에
          붙여 둔다. 카드가 이 줄 뒤로 지나가므로 배경은 불투명해야 하고, 좌우 여백만큼
          늘려서(-mx/px) 카드가 가장자리로 비어져 나오지 않게 한다. */}
      <div className="sticky top-[var(--admin-header-h,4.5rem)] z-10 -mx-[var(--gutter)] mb-5 bg-canvas px-[var(--gutter)] pt-1">
      <div className="flex flex-wrap gap-2 border-b border-separator pb-5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.members.search')}
            aria-label={t('admin.members.search')}
            className="pl-10"
          />
        </div>
        {(data.canBulkSubgroup || data.role !== 'pastor') && (
          <Button variant="secondary" onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
            <ListChecks className="size-4" aria-hidden />
            {selectMode ? t('common.cancel') : t('admin.members.selection.action')}
          </Button>
        )}
        {!selectMode && (
          <Button variant="secondary" onClick={() => setMerging(true)} disabled={data.members.length < 2}>
            <MergeIcon className="size-4" aria-hidden />
            {t('admin.members.merge.action')}
          </Button>
        )}
      </div>
      {/* 선택 모드의 이동 줄도 같이 붙어 있어야 쓸모가 있다 — 아래에서 체크하고 바로 옮긴다. */}
      {selectMode && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3 shadow-[var(--shadow-sm)]">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
            <ListChecks className="size-4" aria-hidden />
            {t('admin.members.bulkMove.selected', { n: selected.size })}
          </span>
          {data.canBulkSubgroup && (
            <>
              <Select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-[8rem] flex-1">
                <option value="">{t('admin.members.bulkMove.placeholder')}</option>
                {dongsanOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
              <Button size="sm" disabled={selected.size === 0 || !target || bulkBusy} onClick={() => applyBulk(target)}>
                {t('admin.members.bulkMove.moveTo')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={selected.size === 0 || bulkBusy}
                onClick={() => applyBulk('')}
              >
                {t('admin.members.bulkMove.remove')}
              </Button>
            </>
          )}
          {data.role !== 'pastor' && (
            <Button size="sm" variant="dangerQuiet" disabled={selected.size === 0 || bulkBusy} onClick={() => setConfirmBulkDelete(true)}>
              <Trash2 className="size-4" aria-hidden />
              {t('admin.members.bulkDelete.action')}
            </Button>
          )}
        </div>
      )}
      </div>
      {!selectMode && (
        <div className="mb-4 flex items-center gap-2 section-kicker">
          <Users className="size-4 text-subtle" aria-hidden />
          {t('admin.nav.members')} · {members.length}
        </div>
      )}
      <IconKey items={['newMemberStar', 'eduWeek1', 'eduWeek2']} />
      {sections.map(({ group, list }) => {
        // 부서 색(관리자 › 설정)은 카드 **왼쪽 띠**로 들어간다. 예전에는 카드 전체를 옅게
        // 칠했는데, 명단은 한 화면에 수십 장이 깔리는 자리라 그 옅은 색이 화면의 바탕색이
        // 되어 버렸다 — 파스텔 판 위의 글자는 대비가 낮고, 부서가 둘이면 화면이 둘로
        // 갈린 것처럼 보인다. 띠 하나면 부서는 그대로 알아보면서 글자는 흰 바탕에 앉는다.
        const accent = group === '대학부' || group === '청년부' ? resolveGroupColor(cfg?.groupColors, group) : undefined
        return (
        <section key={group || 'none'} className="mb-8 fx-rise">
          <h3 className="mb-3 flex items-center gap-2 border-b border-separator pb-2.5 font-display text-lg font-bold tracking-tight text-text">
            {group || '—'}
            <span className="rounded-full bg-fill px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">{list.length}</span>
          </h3>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {list.map((m) => {
              const sel = selectMode && selected.has(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => (selectMode ? toggleSel(m.id) : setEditing(m))}
                  className={
                    'relative flex h-full min-h-20 flex-col overflow-hidden rounded-2xl border bg-surface p-3.5 pl-4 text-left shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
                    'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow)] active:translate-y-0 ' +
                    (sel ? 'border-primary ring-2 ring-primary/40' : 'border-border')
                  }
                >
                  {accent && !sel && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-[3px]"
                      style={{ background: accent }}
                    />
                  )}
                  <div className="leading-snug">
                    {selectMode && (
                      <span className={'mr-2 inline-grid h-4 w-4 place-items-center rounded-full align-middle text-[10px] font-bold ' + (sel ? 'bg-primary text-primary-fg' : 'border border-border text-transparent')}>
                        ✓
                      </span>
                    )}
                    <span className="break-words text-base font-semibold text-text">{m.name}</span>
                    {m.is_new_member && (
                      <>
                      {/* 이번 주일 / 지난주에 등록한 새가족은 새가족 탭과 같은 색으로 구분하고,
                          그보다 오래된 새가족은 기존 새가족 배지를 그대로 단다. */}
                      {newFamilyWeek(m.registration_date, today) === 'thisWeek' || newFamilyWeek(m.registration_date, today) === 'lastWeek' ? (
                        <NewFamilyWeekChip
                          week={newFamilyWeek(m.registration_date, today)}
                          className="ml-1.5 px-2 py-0.5 align-middle text-[10px]"
                        />
                      ) : (
                        <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-gold/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-gold">
                          {t('admin.iconKey.newMemberStar')}
                        </span>
                      )}
                      {m.new_member_edu_week1 && (
                        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-info/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-info">
                          {t('admin.iconKey.eduWeek1')}
                        </span>
                      )}
                      {m.new_member_edu_week2 && (
                        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-info/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-info">
                          {t('admin.iconKey.eduWeek2')}
                        </span>
                      )}
                      </>
                    )}
                  </div>
                  <div className="mt-auto pt-1.5 truncate text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ') || '—'}</div>
                  {m.member_role && <div className="mt-1 truncate text-[11px] font-medium text-subtle">{m.member_role}</div>}
                </button>
              )
            })}
          </div>
        </section>
        )
      })}
      {hiddenMembers.length > 0 && (
        <section className="mt-8 border-t border-separator pt-5">
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-text"
          >
            <EyeOff className="size-4" aria-hidden />
            {t('admin.members.hidden.title')}
            <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{hiddenMembers.length}</span>
            <ChevronDown className={'size-4 transition-transform duration-200 ' + (showHidden ? 'rotate-180' : '')} aria-hidden />
          </button>
          {showHidden && (
            <>
              <p className="mt-2 text-xs text-muted">{t('admin.members.hidden.desc')}</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {hiddenMembers.map((m) => {
                  const sel = selectMode && selected.has(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => (selectMode ? toggleSel(m.id) : setEditing(m))}
                      className={
                        'flex h-full min-h-20 flex-col rounded-2xl border p-3.5 text-left shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow,transform,opacity] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-primary/30 hover:opacity-100 hover:shadow-[var(--shadow)] active:translate-y-0 ' +
                        (sel ? 'border-primary bg-surface ring-2 ring-primary/40' : 'border-border bg-surface-2 opacity-80')
                      }
                    >
                      <div className="leading-snug">
                        {selectMode && (
                          <span className={'mr-2 inline-grid h-4 w-4 place-items-center rounded-full align-middle text-[10px] font-bold ' + (sel ? 'bg-primary text-primary-fg' : 'border border-border text-transparent')}>
                            ✓
                          </span>
                        )}
                        <span className="break-words text-base font-semibold text-text">{m.name}</span>
                      </div>
                      <div className="mt-auto pt-1.5 truncate text-xs text-muted">{m.group_name || '—'}</div>
                      <span className="mt-1.5 self-start whitespace-nowrap rounded-full bg-warning/12 px-2 py-0.5 text-[10px] font-semibold text-warning">
                        {noteOn(m, today) ?? ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </section>
      )}
      {staffMembers.length > 0 && (
        <>
          <div className="mb-3 mt-6 flex items-center gap-2 section-kicker">
            {t('admin.members.staffSection')}
            <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{staffMembers.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {staffMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setEditing(m)}
                className="flex h-full min-h-20 flex-col rounded-2xl border border-border bg-surface p-3.5 text-left shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow)] active:translate-y-0"
              >
                <div className="truncate text-base font-semibold text-text">{m.name}</div>
                <div className="mt-auto pt-1.5 truncate text-xs text-muted">{m.member_role || '—'}</div>
              </button>
            ))}
          </div>
        </>
      )}
      {editing && (
        <EditModal
          member={editing}
          allowDelete={data.role !== 'pastor'}
          onClose={() => setEditing(null)}
          onAttendance={() => {
            setAttendanceFor(editing)
            setEditing(null)
          }}
        />
      )}
      {attendanceFor && (
        <AttendanceModal
          member={attendanceFor}
          log={data.log}
          readOnly={data.role === 'pastor'}
          onClose={() => setAttendanceFor(null)}
        />
      )}
      {confirmBulkDelete && (
        <Dialog
          open
          onOpenChange={(open) => !open && !bulkBusy && setConfirmBulkDelete(false)}
          title={t('admin.members.bulkDelete.title', { n: selectedMembers.length })}
        >
          <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4">
            <p className="flex items-start gap-2 text-sm font-semibold text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t('admin.members.bulkDelete.warn')}</span>
            </p>
            <div className="mt-3 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {selectedMembers.map((m) => (
                <span key={m.id} className="rounded-full border border-danger/20 bg-surface px-2.5 py-1 text-xs font-semibold text-text">
                  {m.name}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmBulkDelete(false)} disabled={bulkBusy} className="flex-1">
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={applyBulkDelete} disabled={bulkBusy} className="flex-1">
              {bulkBusy ? t('common.loading') : t('admin.members.bulkDelete.confirm', { n: selectedMembers.length })}
            </Button>
          </div>
        </Dialog>
      )}
      {merging && <MergeModal members={data.members} onClose={() => setMerging(false)} />}
    </>
  )
}

function MergeModal({ members, onClose }: { members: Member[]; onClose: () => void }) {
  const t = usePartitionT()
  const qc = useQueryClient()
  const toast = useToast()
  const [s, setS] = useState<MergeState>({ fromId: '', toId: '' })
  const [saving, setSaving] = useState(false)

  const sorted = mergeTargets(members, '') // all members, by name — the source picker
  const targets = mergeTargets(members, s.fromId) // everyone except the chosen source

  async function submit() {
    if (!canMerge(s)) return
    setSaving(true)
    try {
      await mergeMembers(s.fromId, s.toId)
      refreshRoster(qc)
      toast({ title: t('admin.members.merge.done'), tone: 'ok' })
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.members.merge.title')}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">{t('admin.members.merge.help')}</p>
        <Field label={t('admin.members.merge.from')}>
          <Select value={s.fromId} onChange={(e) => setS({ fromId: e.target.value, toId: '' })}>
            <option value="">—</option>
            {sorted.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {[m.group_name, m.subgroup].filter(Boolean).length ? ` (${[m.group_name, m.subgroup].filter(Boolean).join(' · ')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.members.merge.to')}>
          <Select value={s.toId} onChange={(e) => setS((cur) => ({ ...cur, toId: e.target.value }))} disabled={!s.fromId}>
            <option value="">—</option>
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {[m.group_name, m.subgroup].filter(Boolean).length ? ` (${[m.group_name, m.subgroup].filter(Boolean).join(' · ')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {canMerge(s) && (
          <p className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('admin.members.merge.warn', { summary: mergeSummary(members, s) })}</span>
          </p>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={submit} disabled={!canMerge(s) || saving} className="flex-1">
          {saving ? t('common.loading') : t('admin.members.merge.confirm')}
        </Button>
      </div>
    </Dialog>
  )
}

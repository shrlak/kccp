import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDongsanNames,
  updateMember,
  deleteMember,
  addMemberAttendance,
  removeAttendance,
  type Member,
  type MemberEdit,
  type LogEntry,
} from '../../../lib/api'
import { summerDongsanList } from './dongsan'
import { Dialog } from '../../../components/ui/Dialog'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { Button } from '../../../components/ui/Button'
import { useToast } from '../../../components/ui/Toast'
import { Plus, Trash2, Calendar } from '../../../components/ui/Icon'
import { memberHistory, hasEntryOn } from './attendance'
import { easternNow } from '../../../lib/checkinWindow'
import { statusMarks, type StatusMark } from '../../../lib/status'
import { NewFamilyCardForm } from './NewFamilyCardForm'
import { AdultCardForm } from './AdultCardForm'
import { adultCardFromMember, birthRaw, isoDateOrNull, packFamily, type AdultCardValue } from './adultCard'
import { cardFormFromMember, joinAffiliation, type CardFormValue } from './newFamilyCard'
import { copyNewFamilyCards, saveNewFamilyCards } from './newFamilyCardImage'
import { refreshRoster } from '../../../lib/live'
import { useAppConfig, usePartition, usePartitionT } from '../../../lib/useAppConfig'
import { groupsOfPartition, type Partition } from '../../../lib/partition'

// 상태 표기 quick presets — canonical note values the 출석부 renders as grey spans.
// 방학 additionally hides the member from the kiosk and excludes their attendance from
// analytics while it's active (see kiosk.ts hiddenByStatus / analytics.ts excludeOnBreak).
const STATUS_PRESETS = ['이주', '한국 귀국', '졸업', '방학']

// 부서 선택 후보 — 로그인한 부의 것만. 대학·청년부에는 예전부터 쓰이던 EM/Adult Ministry
// 항목이 남아 있고, 장년부는 장년부 하나뿐이다.
const EXTRA_YOUTH_GROUPS = ['EM', 'Adult Ministry']
function groupOptions(partition: Partition): string[] {
  const own = groupsOfPartition(partition)
  return partition === 'adult' ? own : [...own, ...EXTRA_YOUTH_GROUPS]
}

// A labelled form field wrapper, shared by the member dialogs (and the merge dialog).
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

// Member detail/editor dialog: shows + edits all of a member's info (scoped + read-only
// enforced server-side). Shared by the Members tab and the 새가족 (new-family) tab.
export function EditModal({
  member,
  onClose,
  onAttendance,
  allowDelete = false,
}: {
  member: Member
  onClose: () => void
  onAttendance: () => void
  // When true (Members tab, non-pastor), shows an irreversible delete control. The
  // server still enforces scope + read-only regardless of this flag.
  allowDelete?: boolean
}) {
  const t = usePartitionT()
  const qc = useQueryClient()
  const toast = useToast()
  // Configured 동산 names feed the 동산 dropdown (combined list in summer mode).
  const { data: cfg } = useAppConfig()
  const partition = usePartition()
  const { data: dongsanNames } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  // The card carries everything printed on the 새가족 등록 카드; `f` keeps the
  // system-only fields (부서/동산/역할/메모/새가족 flag/상태 표기).
  const [card, setCard] = useState<CardFormValue>(() => cardFormFromMember(member))
  // 장년부는 종이가 다르다 — 자기 카드 모델을 따로 든다 (adultCard.ts). 부는 로그인으로
  // 정해지므로 한 다이얼로그가 두 카드를 동시에 그리는 일은 없다.
  const [adultCard, setAdultCard] = useState<AdultCardValue>(() => adultCardFromMember(member))
  const isAdult = partition === 'adult'
  const [f, setF] = useState<MemberEdit>({
    group: member.group_name,
    subgroup: member.subgroup,
    isNewMember: member.is_new_member,
    notes: member.notes,
    statusMarks: statusMarks(member),
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState<'copy' | 'download' | null>(null)

  function set<K extends keyof MemberEdit>(k: K, v: MemberEdit[K]) {
    setF((cur) => ({ ...cur, [k]: v }))
  }

  // 동산 dropdown options: the configured names for the selected 부서 (the combined 합동
  // list in summer mode). A stored 동산 that's no longer configured stays selectable so
  // opening + saving the dialog never silently drops it.
  const dongsanOptions = cfg?.summerMode
    ? summerDongsanList(dongsanNames ?? {})
    : [...(dongsanNames?.[f.group ?? ''] ?? [])]
  const currentDongsan = f.subgroup ?? ''
  if (currentDongsan && !dongsanOptions.includes(currentDongsan)) dongsanOptions.push(currentDongsan)
  const patchCard = (patch: Partial<CardFormValue>) => setCard((cur) => ({ ...cur, ...patch }))
  const patchAdultCard = (patch: Partial<AdultCardValue>) => setAdultCard((cur) => ({ ...cur, ...patch }))

  // "등록일 제거": clears the 등록일 AND the 새가족 flag, so saving drops the member
  // from the 새가족 list (the list keeps flagged members even without a date).
  function removeRegistration() {
    if (isAdult) patchAdultCard({ registrationDate: '' })
    else patchCard({ registrationDate: '' })
    set('isNewMember', false)
  }

  // 상태 표기 목록 — 멤버 한 명이 여러 개(방학 → 한국 귀국 …)를 가질 수 있다.
  const marks = f.statusMarks ?? []
  const setMarks = (next: StatusMark[]) => set('statusMarks', next)
  const patchMark = (idx: number, patch: Partial<StatusMark>) =>
    setMarks(marks.map((mark, i) => (i === idx ? { ...mark, ...patch } : mark)))
  const addMark = (note = '') => setMarks([...marks, { note, start: easternNow().date, end: null }])
  const removeMark = (idx: number) => setMarks(marks.filter((_, i) => i !== idx))

  // 프리셋 — 같은 문구의 표기가 이미 있으면 그걸 지우고(토글), 없으면 오늘부터 시작하는
  // 표기를 하나 더 얹는다.
  function toggleStatusPreset(note: string) {
    const existing = marks.findIndex((mark) => mark.note === note)
    if (existing >= 0) return removeMark(existing)
    addMark(note)
  }

  // Copy or download this member's 새가족 등록 카드 as a JPG (same renderer as the
  // 새가족 tab's batch export — one person, so the clipboard/download gets just their card).
  async function copyCard() {
    setExporting('copy')
    try {
      const { copied } = await copyNewFamilyCards([member])
      toast({ title: t(copied ? 'admin.mergedCopy.cardsDone' : 'admin.mergedCopy.failed'), tone: copied ? 'ok' : 'err' })
    } catch {
      toast({ title: t('admin.newfamily.export.cardsSaveFailed'), tone: 'err' })
    } finally {
      setExporting(null)
    }
  }

  async function downloadCard() {
    setExporting('download')
    try {
      await saveNewFamilyCards([member], easternNow().date)
      toast({ title: t('admin.members.card.done'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.newfamily.export.cardsSaveFailed'), tone: 'err' })
    } finally {
      setExporting(null)
    }
  }

  async function save() {
    setSaving(true)
    try {
      await updateMember(member.id, isAdult ? {
        ...f,
        name: adultCard.name,
        nameEn: adultCard.nameEn,
        gender: adultCard.gender,
        birthDate: isoDateOrNull(adultCard.birthDate),
        // 년만 적힌 카드도 남는다 (adultCard.ts birthRaw).
        birthDateRaw: birthRaw(adultCard.birthDate),
        phone: adultCard.phone,
        email: adultCard.email,
        phoneHome: adultCard.phoneHome,
        address: adultCard.address,
        city: adultCard.city,
        state: adultCard.state,
        zipCode: adultCard.zipCode,
        attendReason: adultCard.attendReason,
        schoolOrWork: adultCard.schoolOrWork,
        baptismStatus: adultCard.baptismStatus,
        registrationChoice: adultCard.registrationChoice,
        registrationDate: isoDateOrNull(adultCard.registrationDate),
        visitDate: isoDateOrNull(adultCard.visitDate),
        memberNo: adultCard.memberNo,
        // 종이의 빈 줄은 보내지 않는다.
        family: packFamily(adultCard.family),
      } : {
        ...f,
        name: card.name,
        gender: card.gender,
        phone: card.phone,
        kakaoId: card.kakaoId,
        birthDate: card.birthDate || null,
        baptismStatus: card.baptismStatus,
        // 소속 category stored as a prefix inside school_or_work (no DB column).
        schoolOrWork: joinAffiliation(card.affiliationCategory, card.affiliationDetail),
        faithDuration: card.faithDuration,
        registrationDate: card.registrationDate || null,
        pastoralVisitRequested: card.pastoralVisitRequested,
      })
      refreshRoster(qc)
      toast({ title: t('admin.members.saved'), tone: 'ok' })
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  async function del() {
    setDeleting(true)
    try {
      await deleteMember(member.id)
      refreshRoster(qc)
      toast({ title: t('admin.members.delete.done', { name: member.name }), tone: 'ok' })
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
      setDeleting(false)
    }
  }

  return (
    // wide: the 새가족 등록 카드 replica at the top needs the paper card's landscape width.
    // 장년부 카드는 더 길어서 한 뼘 더 (Dialog xwide) — 옆으로 밀지 않고 다 보이도록.
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.members.edit')} wide xwide={isAdult}>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
        {/* ── 새가족 등록 카드 — edit the member's info directly on the paper card ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="section-kicker">{t('admin.members.card.section')}</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void copyCard()}
              disabled={exporting !== null}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {exporting === 'copy' ? t('admin.newfamily.export.busy') : t('admin.members.card.copy')}
            </button>
            <button
              type="button"
              onClick={() => void downloadCard()}
              disabled={exporting !== null}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {exporting === 'download' ? t('admin.newfamily.export.busy') : t('admin.members.card.download')}
            </button>
          </div>
        </div>
        {isAdult ? (
          <AdultCardForm value={adultCard} onChange={patchAdultCard} />
        ) : (
          <NewFamilyCardForm value={card} onChange={patchCard} />
        )}
        {((isAdult ? adultCard.registrationDate : card.registrationDate) || f.isNewMember) && (
          <button
            type="button"
            onClick={removeRegistration}
            className="self-start text-xs font-semibold text-danger hover:underline"
          >
            {t('admin.members.card.removeReg')}
          </button>
        )}

        {/* ── 상태 표기 box — 이주/귀국 spans, right beneath the card ── */}
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
          <div className="section-kicker">{t('admin.members.statusSection')}</div>
          <p className="mt-1.5 text-sm text-warning">{t('admin.members.statusHelp')}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {STATUS_PRESETS.map((note) => {
              const on = marks.some((mark) => mark.note === note)
              return (
              <button
                key={note}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatusPreset(note)}
                className={
                  'min-h-9 rounded-full border px-4 text-sm transition-[background-color,border-color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.96] ' +
                  (on
                    ? 'border-warning bg-warning/15 font-semibold text-warning'
                    : 'border-border bg-surface text-text hover:bg-fill')
                }
              >
                {note}
              </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {marks.map((mark, idx) => (
              <div key={idx} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-end gap-2">
                  <Field label={t('admin.members.statusNote')} className="min-w-0 flex-1">
                    <Input value={mark.note} onChange={(e) => patchMark(idx, { note: e.target.value })} />
                  </Field>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-0.5 shrink-0 !min-h-11 !w-11 !px-0 text-danger hover:bg-danger/10"
                    onClick={() => removeMark(idx)}
                    aria-label={`${t('admin.members.statusRemove')} ${mark.note}`}
                  >
                    <Trash2 size={16} strokeWidth={2} aria-hidden />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field label={t('admin.members.statusStart')}>
                    <Input type="date" value={mark.start ?? ''} onChange={(e) => patchMark(idx, { start: e.target.value || null })} />
                  </Field>
                  <Field label={t('admin.members.statusEnd')}>
                    <Input type="date" value={mark.end ?? ''} onChange={(e) => patchMark(idx, { end: e.target.value || null })} />
                  </Field>
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => addMark()}>
              <Plus size={15} strokeWidth={2.25} aria-hidden />
              {t('admin.members.statusAdd')}
            </Button>
          </div>
        </div>

        {/* ── 기본 정보 — the system fields the paper card doesn't carry ── */}
        <div className="mt-1 border-t border-separator pt-4 section-kicker">{t('admin.members.sectionBasic')}</div>
        <Field label={t('admin.members.group')}>
          <Select value={f.group ?? ''} onChange={(e) => set('group', e.target.value)}>
            {groupOptions(partition).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.members.subgroup')}>
          <Select value={currentDongsan} onChange={(e) => set('subgroup', e.target.value)}>
            <option value="">—</option>
            {dongsanOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.members.notes')}>
          <textarea
            value={f.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text outline-none transition-[border-color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:border-primary/30 focus-visible:border-primary focus-visible:ring-[3.5px] focus-visible:ring-primary/18"
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-3 text-sm font-medium text-text">
          <input type="checkbox" checked={f.isNewMember ?? false} onChange={(e) => set('isNewMember', e.target.checked)} className="size-4 accent-[var(--primary)]" />
          {t('admin.members.isNewMember')}
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onAttendance} className="flex-1">
          {t('admin.members.attendance.action')}
        </Button>
        <Button onClick={save} disabled={saving} className="flex-1">
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
      {allowDelete &&
        (confirmDelete ? (
          <div className="mt-3 rounded-2xl border border-danger/30 bg-danger/5 p-4">
            <p className="mb-2 text-xs text-danger">{t('admin.members.delete.warn')}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={del} disabled={deleting} className="flex-1">
                {deleting ? t('common.loading') : t('admin.members.delete.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-3 w-full text-xs font-semibold text-danger hover:underline"
          >
            {t('admin.members.delete.action')}
          </button>
        ))}
    </Dialog>
  )
}

// A member's attendance history with add/remove (back-fill). Scoped + read-only enforced
// server-side. Shared by the Members tab and the 새가족 (new-family) tab.
export function AttendanceModal({
  member,
  log,
  readOnly,
  onClose,
}: {
  member: Member
  log: LogEntry[]
  readOnly: boolean
  onClose: () => void
}) {
  const t = usePartitionT()
  const qc = useQueryClient()
  const toast = useToast()
  const [date, setDate] = useState(easternNow().date)
  const [busy, setBusy] = useState(false)

  const history = memberHistory(log, member.id)

  async function add() {
    if (hasEntryOn(log, member.id, date)) {
      toast({ title: t('admin.members.attendance.already'), tone: 'warn' })
      return
    }
    setBusy(true)
    try {
      const res = await addMemberAttendance(member.id, date)
      if (res.status === 'already') toast({ title: t('admin.members.attendance.already'), tone: 'warn' })
      else toast({ title: t('admin.members.attendance.added'), tone: 'ok' })
      refreshRoster(qc)
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    setBusy(true)
    try {
      await removeAttendance(id)
      toast({ title: t('admin.members.attendance.removed'), tone: 'ok' })
      refreshRoster(qc)
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${t('admin.members.attendance.title')} · ${member.name}`}>
      {!readOnly && (
        <div className="mb-3 flex items-end gap-2">
          <label className="flex-1">
            <span className="field-label">{t('admin.members.attendance.date')}</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <Button onClick={add} disabled={busy}>
            <Plus className="size-4" aria-hidden />
            {t('admin.members.attendance.add')}
          </Button>
        </div>
      )}
      <div className="mb-2 section-kicker">
        {t('admin.members.attendance.total', { n: history.length })}
      </div>
      {history.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-border py-10 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-fill text-subtle"><Calendar className="size-5" aria-hidden /></div>
          <p className="mt-3 text-sm text-muted">{t('admin.members.attendance.empty')}</p>
        </div>
      ) : (
        <ul className="inset-list max-h-[45vh] overflow-y-auto">
          {history.map((e) => (
            <li key={e.id} className="inset-row min-h-12 justify-between py-2.5">
              <span className="text-sm text-text">
                {e.date}
                {e.time && <span className="ml-2 tabular-nums text-xs text-muted">{e.time}</span>}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => e.id !== undefined && remove(e.id)}
                  disabled={busy}
                  className="rounded-full px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {t('admin.members.attendance.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={onClose} className="mt-4 w-full">
        {t('common.close')}
      </Button>
    </Dialog>
  )
}

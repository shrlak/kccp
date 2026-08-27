import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from '../admin/useRoster'
import { easternNow } from '../../../lib/checkinWindow'
import { memberCheckin, removeAttendance, type Member } from '../../../lib/api'
import { resolveGroupColor, hexTint } from '../admin/groupColors'
import {
  kioskColumns,
  filterByName,
  presentNamesToday,
  attendanceCount,
  todayEntryFor,
  hiddenByStatus,
  KIOSK_COLS,
  KIOSK_COLS_DEPT,
  kioskDepts,
  type KioskDept,
} from './kiosk'
import { useAttendanceLive, refreshRosterSettled } from '../../../lib/live'
import { KioskGuestDialog } from './KioskGuestDialog'
import { KioskNewMemberDialog } from './KioskNewMemberDialog'
import { ThemeLangToggle } from '../../../components/ui/ThemeLangToggle'
import {
  Search, Check, ClipboardList, RotateCcw, AlertTriangle,
  Users, DoorOpen, UserPlus, Sparkles,
} from '../../../components/ui/Icon'
import { KccpMark } from '../checkin/KccpMark'
import { useAppConfig, usePartition } from '../../../lib/useAppConfig'

const TILE = 'border-border bg-surface text-text shadow-[var(--shadow-sm)] hover:border-primary/40 hover:bg-surface-alt'
const DONE_TILE = 'border-primary bg-primary text-white shadow-[0_6px_18px_color-mix(in_srgb,var(--primary)_30%,transparent)]'

// Feedback overlay timing. 출석 완료 paints on the tap itself — optimistically, before the
// network answers — and clears on a short fixed hold, so a line of people can tap straight
// through instead of each waiting out a round-trip. Failures hold far longer: they're rare
// and the operator actually has to read them.
const HOLD_MS = 600
const ERROR_HOLD_MS = 3500

// Module-level and memoized, which matters at kiosk scale: declared inside KioskView it
// would be a new component type on every render, so each overlay show/hide or 15s roster
// poll tore down and rebuilt all ~200 tile buttons. Now only the tiles whose own `done`
// actually changed re-render, and the tapped one repaints on the next frame.
const Tile = memo(function Tile({ m, done, onTap }: { m: Member; done: boolean; onTap: (m: Member) => void }) {
  return (
    <button
      type="button"
      onClick={() => onTap(m)}
      className={'flex min-h-16 items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-sm font-semibold transition-[background-color,border-color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.94] ' + (done ? DONE_TILE : TILE)}
    >
      {done && <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />}
      {m.name}
    </button>
  )
})

// 부서 필터 칩 — 키오스크 안에서만 쓰는 작은 세그먼트 버튼.
function DeptChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        'min-h-9 rounded-full px-4 py-1.5 text-sm font-semibold transition-[background-color,color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
        (active ? 'bg-surface text-primary shadow-[var(--shadow-sm)]' : 'text-muted hover:text-text')
      }
    >
      {children}
    </button>
  )
}

// Full-screen kiosk for touchscreen attendance (Phase 3). Runs on an already-verified
// admin device, so taps go through the hardened member-checkin endpoint. Auto-refreshes
// the roster every 30s; cleared on exit. `onExit` returns to the admin panel.
export function KioskView({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading } = useRoster(true)
  const { data: cfg } = useAppConfig()
  const partition = usePartition()
  const [search, setSearch] = useState('')
  // 부서만 골라 보기 — 여름학기(합동)가 아닐 때만 뜨는, 키오스크 안에서 켜는 선택지다.
  // 화면을 벗어나면 남지 않도록 상태로만 들고 있고, 기본값은 전체.
  const [deptOnly, setDeptOnly] = useState<KioskDept | ''>('')
  const [overlay, setOverlay] = useState<{ tone: OverlayTone; name: string; detail?: string } | null>(null)
  const [dialog, setDialog] = useState<'guest' | 'newMember' | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Optimistic tile state: memberId → present?, laid over the roster until the refetch
  // confirms it. The tile flips on the tap instead of a round-trip later, which is what
  // makes the short overlay hold safe — the screen can go away before the server answers
  // and the grid still shows the right thing. `pending` holds the same member ids in a
  // ref, so a second tap is caught even before the state re-render lands.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const pending = useRef(new Set<string>())

  // Live cross-device sync: check-ins/undos made on any other kiosk or in the admin
  // panel arrive as broadcast pings; useRoster's own poll is the missed-ping fallback.
  useAttendanceLive()

  useEffect(() => () => { if (dismissTimer.current) clearTimeout(dismissTimer.current) }, [])

  const today = easternNow().date
  const members = data?.members ?? []
  const log = data?.log ?? []
  const present = presentNamesToday(log, today)
  const isPresent = (m: Member) => optimistic[m.id] ?? present.has(m.name)
  // Header count follows the optimistic tiles: +1 for a member the log doesn't have yet,
  // −1 for one whose undo hasn't synced. Only in-flight taps contribute.
  const count = members.reduce((n, m) => {
    const o = optimistic[m.id]
    if (o === undefined || o === present.has(m.name)) return n
    return n + (o ? 1 : -1)
  }, attendanceCount(log, today))
  // 무기한 상태 표기(귀국·이주·졸업 등)나 방학인 사람은 타일로 뜨지 않는다.
  const summer = !!cfg?.summerMode
  // 이 부의 부서들. 장년부는 하나뿐이라 부서만 보기 칩이 뜨지 않는다 — 고를 게 없으므로.
  const depts = kioskDepts(partition)
  // 부서 하나만 보는 중인가 — 블록도 하나, 열도 그만큼 넉넉하게.
  const deptView = !!deptOnly && !summer
  // 블록이 하나뿐이면 그 블록이 화면 전체를 쓴다. 부서만 보기로 고른 경우도 그렇지만, **애초에
  // 부서가 하나뿐인 부**(장년부)도 그렇다 — 예전에는 뒤쪽만 보고 4열로 그려서, 고를 것도 없는
  // 장년부 키오스크가 절반 너비만 쓰고 있었다.
  const wide = deptView || depts.length === 1
  const scoped = deptView ? members.filter((m) => m.group_name === deptOnly) : members
  const visible = filterByName(scoped.filter((m) => !hiddenByStatus(m, today)), search)
  // 한 부서가 화면 전체를 쓰므로 4열이 아니라 8열로 쪼갠다. 나눈 개수와 아래 격자의 열 수는
  // 같아야 한다 — 그래야 한 줄을 왼쪽에서 오른쪽으로 읽는 순서가 가나다 순이 된다.
  const cols = kioskColumns(visible, wide ? KIOSK_COLS_DEPT : KIOSK_COLS, partition)
  // 부서를 골랐으면 그 부서 블록만 남긴다 — 반대쪽 부서가 빈 칸으로 자리를 차지하지 않도록.
  const deptBlocks = deptView ? cols.depts.filter((d) => d.key === deptOnly) : cols.depts
  const hasAnyResult = deptBlocks.some((d) => d.total > 0) || cols.others.length > 0

  // Show a result screen and arm its own dismissal. Replaces whatever is on screen, so
  // the next tap never waits for the previous person's overlay to time out.
  function show(tone: OverlayTone, name: string, detail?: string) {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    setOverlay({ tone, name, detail })
    dismissTimer.current = setTimeout(() => setOverlay(null), tone === 'error' ? ERROR_HOLD_MS : HOLD_MS)
  }

  // Drop a member's optimistic override — either the roster has caught up with it or the
  // mutation failed and the tile should fall back to what the log actually says.
  function settle(id: string) {
    pending.current.delete(id)
    setOptimistic((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // Tiles toggle: tapping an unchecked member checks them in; tapping their green
  // (already checked-in) tile undoes today's attendance entry.
  async function tap(m: Member) {
    // A tap whose sync hasn't landed yet is ignored: the tile is already showing the
    // optimistic result and there's no log row id to undo with, so a second tap could
    // only re-send the same check-in.
    if (pending.current.has(m.id)) return
    const entry = present.has(m.name) ? todayEntryFor(log, today, m) : undefined
    const undoing = entry?.id != null
    pending.current.add(m.id)
    setOptimistic((prev) => ({ ...prev, [m.id]: !undoing }))
    // Paint the result now, ahead of the request — the tap itself is the confirmation.
    show(undoing ? 'undone' : 'ok', m.name)
    try {
      if (entry?.id != null) {
        await removeAttendance(entry.id)
      } else {
        const res = await memberCheckin(m.id)
        // Someone else got them first (a stale roster, not a failure). Correct the screen
        // only while it's still this member's — a late amber pop-up would just be noise.
        if (res.status === 'already') {
          setOverlay((cur) => (cur?.tone === 'ok' && cur.name === m.name ? { ...cur, tone: 'already' } : cur))
        }
      }
      void refreshRosterSettled(qc).finally(() => settle(m.id))
    } catch (e) {
      // A real failure (auth/network): roll the tile back and say so, however long after
      // the tap it lands — the operator has to know this person is not checked in.
      settle(m.id)
      show('error', m.name, (e as Error)?.message)
    }
  }

  // A stable callback so <Tile> can be memoized: `tap` itself is a new function every
  // render (it closes over the log), which would defeat the memo on all of them.
  const tapRef = useRef(tap)
  useEffect(() => { tapRef.current = tap })
  const onTap = useCallback((m: Member) => { void tapRef.current(m) }, [])

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-canvas">
      {/* Header: title + live attendance count + exit */}
      <header className="material-bar flex items-center justify-between gap-3 border-b px-5 py-3 text-text pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-7">
        <div className="flex items-center gap-3">
          <KccpMark size={34} />
          <div>
            <div className="font-display text-lg font-bold tracking-tight">{t('kiosk.title')}</div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">KCCP Sunday Check-in</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="mr-1 hidden items-center gap-2 rounded-full bg-fill px-3.5 py-1.5 sm:flex">
            <Users className="size-4 text-primary" strokeWidth={2} aria-hidden />
            <span className="text-sm font-bold tabular-nums text-text">{count}</span>
            <span className="text-xs font-semibold text-muted">{t('kiosk.count', { n: count })}</span>
          </div>
          <ThemeLangToggle />
          {/* One-tap exit, no confirmation — the session stays signed in and lands on
              the admin panel (KioskShell navigates to /admin; the admin-launched
              overlay simply closes back to it). */}
          <button
            type="button"
            onClick={onExit}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-muted transition-[background-color,color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-surface-alt hover:text-text active:scale-[0.96]"
          >
            <DoorOpen className="size-4" strokeWidth={2} aria-hidden />
            {t('kiosk.exit')}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1500px] px-5 pt-5 sm:px-7">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-subtle" strokeWidth={2} aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('kiosk.searchPlaceholder')}
            aria-label={t('kiosk.searchPlaceholder')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-2xl border border-border bg-surface py-4 pl-12 pr-4 text-lg text-text shadow-[var(--shadow-sm)] outline-none transition-[border-color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] placeholder:text-subtle focus-visible:border-primary focus-visible:ring-[3.5px] focus-visible:ring-primary/18"
          />
        </div>
        {!summer && depts.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-subtle">{t('kiosk.deptFilter')}</span>
            <div className="segmented">
              <DeptChip active={deptOnly === ''} onClick={() => setDeptOnly('')}>{t('admin.filter.all')}</DeptChip>
              {depts.map((dept) => (
                <DeptChip key={dept} active={deptOnly === dept} onClick={() => setDeptOnly(dept)}>{dept}</DeptChip>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2 text-right text-xs font-semibold text-muted sm:hidden">{t('kiosk.count', { n: count })}</div>
      </div>

      <div className="mx-auto w-full max-w-[1500px] flex-1 overflow-y-auto px-5 py-5 sm:px-7">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="fx-skeleton h-16 rounded-2xl" aria-hidden />
            ))}
          </div>
        ) : !hasAnyResult ? (
          <div className="fx-rise flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 grid size-16 place-items-center rounded-full bg-fill text-subtle">
              {search
                ? <Search className="size-7" strokeWidth={1.75} aria-hidden />
                : <Users className="size-7" strokeWidth={1.75} aria-hidden />}
            </div>
            <p className="text-base font-semibold text-text">
              {search ? t('kiosk.noResults') : t('kiosk.noMembers')}
            </p>
          </div>
        ) : (
          <>
            <div className={'grid grid-cols-1 gap-4' + (deptBlocks.length > 1 ? ' sm:grid-cols-2' : '')}>
              {deptBlocks.map((dept) => {
                const color = resolveGroupColor(cfg?.groupColors, dept.key)
                return (
                  <div key={dept.key} className="rounded-[26px] border border-border/60 p-4" style={{ background: hexTint(color, 0.07) }}>
                    {/* Full-width department header, so every column below starts on the same
                        line — the round-robin split reads alphabetically across each row. */}
                    <div
                      className="mb-3 flex items-baseline gap-2 border-b-2 pb-2 text-xs font-bold uppercase tracking-wide"
                      style={{ color, borderColor: color }}
                    >
                      {dept.key} <span className="text-subtle">{dept.total}</span>
                    </div>
                    <div
                      className={
                        'grid grid-cols-2 items-start gap-x-3 gap-y-2 ' +
                        (wide
                          ? 'min-[480px]:grid-cols-4 min-[900px]:grid-cols-8'
                          : 'min-[480px]:grid-cols-4')
                      }
                    >
                      {dept.columns.map((part, i) => (
                        <div key={`${dept.key}-${i}`} className="flex flex-col gap-2">
                          {part.length ? (
                            part.map((m) => <Tile key={m.id} m={m} done={isPresent(m)} onTap={onTap} />)
                          ) : (
                            <div className="py-3 text-center text-xs text-subtle">—</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            {cols.others.length > 0 && (
              <>
                <div className="section-kicker mb-2.5 mt-6">
                  {t('kiosk.other')}
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-6">
                  {cols.others.map((m) => (
                    <Tile key={m.id} m={m} done={isPresent(m)} onTap={onTap} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Footer: guest + 새가족 registration */}
      <footer className="material-bar flex gap-3 border-t px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-7">
        <button
          type="button"
          onClick={() => setDialog('guest')}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-border bg-surface text-sm font-semibold text-text shadow-[var(--shadow-sm)] transition-[background-color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-surface-alt active:scale-[0.98]"
        >
          <UserPlus className="size-4" strokeWidth={2} aria-hidden />
          {t('kiosk.guest.action')}
        </button>
        <button
          type="button"
          onClick={() => setDialog('newMember')}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-primary bg-primary text-sm font-semibold text-primary-fg shadow-[var(--shadow-sm)] transition-[background-color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-primary-hover hover:shadow-[0_6px_20px_color-mix(in_srgb,var(--primary)_32%,transparent)] active:scale-[0.98]"
        >
          <Sparkles className="size-4" strokeWidth={2} aria-hidden />
          {t('kiosk.newMember.action')}
        </button>
      </footer>

      {overlay && <SuccessOverlay tone={overlay.tone} name={overlay.name} detail={overlay.detail} />}

      <KioskGuestDialog open={dialog === 'guest'} onClose={() => setDialog(null)} />
      <KioskNewMemberDialog open={dialog === 'newMember'} onClose={() => setDialog(null)} />
    </div>
  )
}

type OverlayTone = 'ok' | 'already' | 'undone' | 'error'

// Full-screen feedback overlay: green check for success, amber for already, blue for an
// undone check-in, red for a real failure (with the underlying reason so a broken kiosk
// is diagnosable on-screen). There is no pending state — the tap paints its result
// straight away and only a failure ever changes it.
function SuccessOverlay({ tone, name, detail }: { tone: OverlayTone; name: string; detail?: string }) {
  const { t } = useTranslation()
  const color =
    tone === 'already'
      ? 'var(--warning)'
      : tone === 'undone'
        ? 'var(--info)'
        : tone === 'error'
          ? 'var(--danger)'
          : 'var(--success)'
  const OverlayIcon =
    tone === 'already' ? ClipboardList : tone === 'undone' ? RotateCcw : tone === 'error' ? AlertTriangle : Check
  return (
    <div
      role="status"
      aria-live="polite"
      // Opaque rather than blurred: at 97% the blur is invisible anyway, and a
      // full-screen backdrop-filter is the one thing that can cost a kiosk tablet
      // whole frames on the way in.
      className="fixed inset-0 z-[1002] flex flex-col items-center justify-center bg-canvas/[0.97] px-6 text-center"
    >
      <div className="fx-pop-fast flex flex-col items-center">
        <div
          className="mb-6 grid size-24 place-items-center rounded-full border-2 shadow-[var(--shadow-lg)]"
          style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, borderColor: color, color }}
        >
          <OverlayIcon className="size-11" strokeWidth={2.25} aria-hidden />
        </div>
        <div className="font-display text-3xl font-bold tracking-tight" style={{ color }}>
          {tone === 'already'
            ? t('kiosk.already')
            : tone === 'undone'
              ? t('kiosk.undone')
              : tone === 'error'
                ? t('kiosk.fail')
                : t('kiosk.success')}
        </div>
        <div className="mt-2 text-lg font-semibold text-text">{name}</div>
        {tone === 'error' && detail && <div className="mt-3 max-w-xs text-xs text-muted">{detail}</div>}
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { configCalendar, getCardScanUsage, updateSettings } from '../../../lib/api'
import { useToast } from '../../../components/ui/Toast'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Tag } from '../../../components/ui/Tag'
import { Calendar, Link, Sparkles, ScanLine, Settings } from '../../../components/ui/Icon'
import { SheetSyncSection } from './SheetSyncSection'
import type { ReactNode } from 'react'
import { DEFAULT_GROUP_COLORS, isValidHex } from './groupColors'
import { easternNow } from '../../../lib/checkinWindow'
import {
  DEFAULT_SEMESTER_DATES,
  buildSchedule,
  calendarOf,
  isValidSchedule,
  type SemesterSchedule,
} from '../../../lib/semester'
import { useAppConfig, usePartition } from '../../../lib/useAppConfig'
import { groupsOfPartition, summerAppliesTo, usesSemesters } from '../../../lib/partition'

// Super-admin settings: semester dates and app-wide mode toggles.
// (동산 names + 동산지기/부동산지기 live in their own 동산 tab now.)
export function AdminSettings() {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: cfg } = useAppConfig()
  // 색을 편집할 부서 목록은 로그인한 부의 것. 저장할 때 서버도 같은 기준으로 걸러서,
  // 장년부에서 저장해도 대학부/청년부 색은 그대로 남는다.
  const partition = usePartition()
  const groups = groupsOfPartition(partition)
  const { data: scanUsage, isFetching: scanUsageRefreshing } = useQuery({
    queryKey: ['cardScanUsage'],
    queryFn: getCardScanUsage,
    staleTime: 0,
    // A read-out of today's allowance, not a live counter — the scan dialog polls at 2s
    // while someone is actually scanning. Doing that here too meant 30 requests a minute
    // to the same edge function that serves the roster, for a number that barely moves.
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  const [colorEdits, setColorEdits] = useState<Record<string, string> | undefined>(undefined)
  const [colorsSaving, setColorsSaving] = useState(false)
  const [semesterEdits, setSemesterEdits] = useState<SemesterSchedule | undefined>(undefined)
  const [semesterSaving, setSemesterSaving] = useState(false)

  const colors = colorEdits ?? cfg?.groupColors ?? DEFAULT_GROUP_COLORS
  const colorsDirty = colorEdits !== undefined
  const colorsValid = groups.every((g) => isValidHex(colors[g] ?? ''))
  const today = easternNow().date
  // The 2년치 window an admin edits: the saved schedule's current + upcoming terms, topped up
  // from the recurring template when the server hasn't stored a schedule yet. Finished terms
  // stay on the server (the archives need them) but leave this list — that is the rolling
  // window: as each term ends it drops off the front and a fresh one appears at the back.
  const savedTerms = useMemo(() => buildSchedule(today, calendarOf(configCalendar(cfg))), [cfg, today])
  const terms = semesterEdits ?? savedTerms
  const semesterDatesValid = isValidSchedule(terms)
  // The 여름 모드 status line describes what the server is actually doing, so it reads the
  // saved schedule — not the unsaved edits sitting in the form above it.
  const savedSemesterDates = cfg?.semesterDates ?? DEFAULT_SEMESTER_DATES
  const usageRemaining = scanUsage?.remaining ?? 0
  const remainingPercent = scanUsage
    ? scanUsage.limit > 0
      ? Math.min(100, Math.round((scanUsage.remaining / scanUsage.limit) * 100))
      : 0
    : 0

  function setColor(group: string, hex: string) {
    setColorEdits({ ...colors, [group]: hex })
  }

  async function saveColors() {
    if (!colorsValid) return
    setColorsSaving(true)
    try {
      await updateSettings({ groupColors: colors })
      await qc.invalidateQueries({ queryKey: ['config'] })
      setColorEdits(undefined)
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setColorsSaving(false)
    }
  }

  function setTermDate(index: number, field: 'start' | 'end', date: string) {
    setSemesterEdits(terms.map((term, i) => (i === index ? { ...term, [field]: date } : term)))
  }

  async function saveSemesterDates() {
    if (!semesterDatesValid) return
    setSemesterSaving(true)
    try {
      await updateSettings({ semesterSchedule: terms })
      await qc.invalidateQueries({ queryKey: ['config'] })
      setSemesterEdits(undefined)
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSemesterSaving(false)
    }
  }

  return (
    <div className="fx-rise flex w-full flex-col gap-9">
      {/* 학기 일정은 학사 일정을 따르는 부에만 있다. 장년부의 한 해는 상반기(1–6월)·하반기
          (7–12월)로 고정이라 편집할 값이 없다 — 편집기 자체를 내린다. */}
      {usesSemesters(partition) && (
      <section>
        <SectionHeader
          icon={<Calendar size={18} strokeWidth={2} aria-hidden />}
          tone="bg-primary/10 text-primary"
          title={t('admin.settings.semesterDates')}
          desc={t('admin.settings.semesterDatesDesc', { count: terms.length })}
        />
        <div className="mb-3 grid gap-3 lg:grid-cols-3">
          {terms.map((term, i) => {
            const running = today >= term.start && today <= term.end
            return (
            <fieldset key={`${term.year}-${term.season}`} className="rounded-2xl border border-border bg-surface-2 p-4 shadow-[var(--shadow-sm)]">
              {/* legend renders as an in-card header (float trick) instead of the
                  browser's border-interrupting legend style; fieldset keeps semantics. */}
              <legend className="float-left mb-3 flex w-full items-center gap-1.5 p-0 font-display text-sm font-bold tracking-tight text-text">
                {t(`admin.settings.semester.${term.season}`)}
                <span className="font-sans font-normal text-subtle">{term.year}</span>
                {running && <Tag tone="primary" className="ml-auto">{t('admin.settings.termRunning')}</Tag>}
              </legend>
              <div className="clear-both grid grid-cols-2 gap-2">
                <label>
                  <span className="field-label">{t('admin.settings.semesterStart')}</span>
                  <Input
                    type="date"
                    value={term.start}
                    onChange={(e) => setTermDate(i, 'start', e.target.value)}
                  />
                </label>
                <label>
                  <span className="field-label">{t('admin.settings.semesterEnd')}</span>
                  <Input
                    type="date"
                    value={term.end}
                    onChange={(e) => setTermDate(i, 'end', e.target.value)}
                  />
                </label>
              </div>
            </fieldset>
            )
          })}
        </div>
        <p className="mb-3 text-xs text-muted">{t('admin.settings.semesterRollNote')}</p>
        {!semesterDatesValid && (
          <p className="mb-3 text-xs font-semibold text-danger">{t('admin.settings.semesterDatesInvalid')}</p>
        )}
        <Button
          onClick={saveSemesterDates}
          disabled={semesterSaving || semesterEdits === undefined || !semesterDatesValid}
        >
          {semesterSaving ? t('common.loading') : t('admin.settings.save')}
        </Button>
      </section>
      )}

      {/* 여름 합동은 대학부·청년부를 한 덩어리로 묶는 장치라 장년부에는 없다 — 상태 줄도 뺀다. */}
      {summerAppliesTo(partition) && (
      <section>
        <SectionHeader
          icon={<Settings size={18} strokeWidth={2} aria-hidden />}
          tone="bg-fill text-muted"
          title={t('admin.settings.modes')}
        />
        <div className="inset-list">
          {/* 여름 모드 is no longer a switch: it is on for exactly as long as the 여름학기
              above runs, so it turns itself on when the term starts and off when it ends. */}
          <StatusRow
            label={t('admin.settings.summerMode')}
            desc={t('admin.settings.summerModeAutoDesc', {
              start: monthDayLabel(savedSemesterDates.summer.start),
              end: monthDayLabel(savedSemesterDates.summer.end),
            })}
            on={!!cfg?.summerMode}
            onLabel={t('admin.settings.autoOn')}
            offLabel={t('admin.settings.autoOff')}
          />
        </div>
      </section>
      )}

      <section>
        <SectionHeader
          icon={<Sparkles size={18} strokeWidth={2} aria-hidden />}
          tone="bg-gold/15 text-gold"
          title={t('admin.settings.groupColors')}
          desc={t('admin.settings.groupColorsDesc')}
        />
        <div className="mb-3 inset-list">
          {groups.map((g) => (
            <ColorField key={g} label={g} value={colors[g] ?? DEFAULT_GROUP_COLORS[g]} onChange={(hex) => setColor(g, hex)} />
          ))}
        </div>
        {!colorsValid && <p className="mb-3 text-xs font-semibold text-danger">{t('admin.settings.groupColorInvalid')}</p>}
        <Button onClick={saveColors} disabled={colorsSaving || !colorsDirty || !colorsValid}>
          {colorsSaving ? t('common.loading') : t('admin.settings.save')}
        </Button>
      </section>

      {/* 동산이 쓰는 구글 시트를 출석부에 붙이는 곳. 지금은 대학·청년부만 쓴다 —
          장년부의 셀 출석은 아직 종이로 오므로 붙일 시트가 없다. */}
      {usesSemesters(partition) && (
      <section>
        <SectionHeader
          icon={<Link size={18} strokeWidth={2} aria-hidden />}
          tone="bg-success/15 text-success"
          title={t('admin.sheetSync.title')}
          desc={t('admin.sheetSync.desc')}
        />
        <SheetSyncSection />
      </section>
      )}

      <section>
        <SectionHeader
          icon={<ScanLine size={18} strokeWidth={2} aria-hidden />}
          tone="bg-info/10 text-info"
          title={t('admin.settings.cardScanLimit')}
          desc={t('admin.settings.cardScanLimitDesc')}
        />
        <div className="surface-panel p-4" aria-live="polite">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-text">
              <span
                className={'h-2 w-2 rounded-full ' + (scanUsageRefreshing ? 'bg-warning' : 'bg-success')}
                aria-hidden
              />
              {t('admin.settings.cardScanLive')}
            </span>
            {scanUsage && (
              <span className="font-mono text-xs tabular-nums text-subtle">
                {t('admin.settings.cardScanUsageDetail', {
                  available: usageRemaining,
                })}
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-fill" role="progressbar" aria-valuemin={0} aria-valuemax={scanUsage?.limit ?? 0} aria-valuenow={usageRemaining}>
            <div
              className={'h-full rounded-full transition-[width] duration-300 ' + (remainingPercent <= 10 ? 'bg-danger' : 'bg-primary')}
              style={{ width: `${remainingPercent}%` }}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function SectionHeader({ icon, tone, title, desc }: { icon: ReactNode; tone: string; title: string; desc?: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <span className={'grid h-9 w-9 shrink-0 place-items-center rounded-xl ' + tone}>{icon}</span>
        <h2 className="font-display text-xl font-bold tracking-tight text-text">{title}</h2>
      </div>
      {desc && <p className="mt-2 text-sm text-muted">{desc}</p>}
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const valid = isValidHex(value)
  return (
    <div className="inset-row min-h-14 gap-3 py-2.5">
      <span className="w-16 shrink-0 text-sm font-semibold text-text">{label}</span>
      <input
        type="color"
        aria-label={label}
        // The native color input requires a well-formed #rrggbb; fall back while the
        // text field is mid-edit (e.g. "#E0A8") so this never throws.
        value={valid ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border border-border bg-surface p-1"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} hex`}
        placeholder="#E0A800"
        className={'max-w-[10rem] font-mono ' + (valid ? '' : 'border-danger focus-visible:border-danger')}
      />
    </div>
  )
}

// A mode the app decides for itself: shown with its current state instead of a switch.
function StatusRow({
  label,
  desc,
  on,
  onLabel,
  offLabel,
}: {
  label: string
  desc: string
  on: boolean
  onLabel: string
  offLabel: string
}) {
  return (
    <div className="inset-row min-h-14 justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-semibold text-text">{label}</div>
        <div className="text-xs text-muted">{desc}</div>
      </div>
      <Tag tone={on ? 'success' : 'muted'} className="shrink-0">
        {on ? onLabel : offLabel}
      </Tag>
    </div>
  )
}

// "06-07" → "06.07" — the compact form used in the 여름 모드 status line.
function monthDayLabel(monthDay: string): string {
  return monthDay.replace('-', '.')
}

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePartition } from '../../../lib/useAppConfig'
import type { Partition } from '../../../lib/partition'
import type { Member, LogEntry } from '../../../lib/api'
import type { CalendarLike } from '../../../lib/semester'
import type { Filter } from './filters'
import { applyFontSize } from './exports'
import type { Lang } from './exports'
import { semesterBounds, transitionBounds } from './newFamily'
import {
  archiveEntries,
  archiveFilename,
  archiveLabel,
  archiveWorkbook,
  isYearArchive,
  rangeLabel,
  type ArchiveEntry,
  type DongsanHistory,
} from './archive'
import { Button } from '../../../components/ui/Button'
import { Download, Archive } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { onIntent, prefetchExcel } from '../../../app/prefetch'

// 출석부 tab, bottom section: every finished 학기 / 전환 기간, then every finished 학년도 and
// calendar year, each downloadable as its own Excel workbook (see archive.ts for the pure
// side). The list is built from the attendance log itself, so a term appears here the day
// after it ends and never needs to be created by hand.
export function ArchiveSection({
  members,
  log,
  filter,
  today,
  lang,
  semesterDates,
  dongsanHistory,
}: {
  members: Member[]
  log: LogEntry[]
  filter: Filter
  today: string
  lang: Lang
  semesterDates?: CalendarLike
  // 학기 종료 시 얼려둔 동산 편성 — 그 학기 시트를 당시 동산으로 묶는 데 쓴다.
  dongsanHistory?: DongsanHistory | null
}) {
  const { t } = useTranslation()
  const partition = usePartition()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const entries = useMemo(() => archiveEntries(log, today, semesterDates, partition), [log, today, semesterDates, partition])
  const terms = entries.filter((e) => !isYearArchive(e))
  const years = entries.filter(isYearArchive)

  async function download(entry: ArchiveEntry) {
    setBusy(entry.id)
    try {
      // Same lazy SheetJS load as the 내보내기 menu — the fork that writes cell fills.
      const XLSX = await import('xlsx-js-style')
      const wb = XLSX.utils.book_new()
      const { sheets, log: full } = archiveWorkbook(entry, members, log, lang, dongsanHistory, partition)
      for (const sheet of sheets) {
        const ws = XLSX.utils.aoa_to_sheet(sheet.data.aoa)
        ws['!merges'] = sheet.data.merges
        for (const f of sheet.data.fills) {
          const addr = XLSX.utils.encode_cell({ r: f.r, c: f.c })
          const cell = ws[addr] ?? (ws[addr] = { t: 's', v: '' })
          cell.s = { fill: { patternType: 'solid', fgColor: { rgb: f.rgb } } }
        }
        // 색을 다 얹은 뒤 마지막에 글자 크기 (위의 `cell.s = {...}`가 통째로 갈아 끼운다).
        applyFontSize(ws)
        XLSX.utils.book_append_sheet(wb, ws, sheet.name)
      }
      const fullWs = XLSX.utils.aoa_to_sheet(full)
      applyFontSize(fullWs)
      XLSX.utils.book_append_sheet(wb, fullWs, 'Full Log')
      XLSX.writeFile(wb, archiveFilename(entry, filter.group))
    } catch {
      toast({ title: t('admin.sheet.export.excelFailed'), tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Archive className="size-4" aria-hidden />
        </span>
        <h3 className="font-display text-lg font-bold tracking-tight text-text">{t('admin.sheet.archive.title')}</h3>
      </div>
      <p className="mb-4 text-sm text-muted">{t('admin.sheet.archive.desc')}</p>

      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          {pendingHint(t, today, lang, semesterDates, partition)}
        </p>
      ) : (
        <div className="space-y-5">
          {terms.length > 0 && (
            <ArchiveList
              caption={t('admin.sheet.archive.terms')}
              entries={terms}
              lang={lang}
              busy={busy}
              onDownload={download}
            />
          )}
          {years.length > 0 && (
            <ArchiveList
              caption={t('admin.sheet.archive.years')}
              entries={years}
              lang={lang}
              busy={busy}
              onDownload={download}
            />
          )}
        </div>
      )}
    </section>
  )
}

function ArchiveList({
  caption,
  entries,
  lang,
  busy,
  onDownload,
}: {
  caption: string
  entries: ArchiveEntry[]
  lang: Lang
  busy: string | null
  onDownload: (e: ArchiveEntry) => void
}) {
  const { t } = useTranslation()
  const partition = usePartition()
  return (
    <div>
      <p className="section-kicker mb-2">{caption}</p>
      <ul className="inset-list">
        {entries.map((e) => (
          <li key={e.id} className="inset-row min-h-16 flex-wrap gap-y-2 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-text">{archiveLabel(e, lang, partition)}</span>
              <span className="block truncate text-xs text-muted">
                {rangeLabel(e.start, e.end)} · {t('admin.sheet.archive.stats', { weeks: e.sundays, records: e.records })}
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onDownload(e)}
              {...onIntent(prefetchExcel)}
              disabled={busy !== null}
              aria-label={`${archiveLabel(e, lang, partition)} ${t('admin.sheet.archive.download')}`}
            >
              <Download size={15} strokeWidth={2} aria-hidden />
              {busy === e.id ? t('common.loading') : t('admin.sheet.archive.download')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Nothing archived yet — say when the first archive will appear: the end of whatever period
// is running today (a 학기, or the gap between two of them).
function pendingHint(
  t: (key: string, opts?: Record<string, unknown>) => string,
  today: string,
  lang: Lang,
  semesterDates?: CalendarLike,
  partition: Partition = 'youth',
): string {
  const transition = transitionBounds(today, semesterDates, partition)
  const end = transition ? transition.end : semesterBounds(today, semesterDates, partition).end
  return t(transition ? 'admin.sheet.archive.pendingTransition' : 'admin.sheet.archive.pendingTerm', {
    date: lang === 'ko' ? end.replace(/-/g, '.') : end,
  })
}

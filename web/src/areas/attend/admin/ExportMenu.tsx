import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Member, LogEntry } from '../../../lib/api'
import { configCalendar } from '../../../lib/api'
import { easternNow } from '../../../lib/checkinWindow'
import type { Filter } from './filters'
import {
  applyFontSize,
  exportFilename,
  gridSheet,
  logRows,
  kakaoSummary,
  reportHtml,
  type Lang,
} from './exports'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Download, ChevronRight } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { prefetchExcel } from '../../../app/prefetch'
import { copyToClipboard } from '../../../lib/clipboard'
import { useAppConfig, usePartition } from '../../../lib/useAppConfig'

// Export control for the Sheet tab. Offers Excel (.xlsx), KakaoTalk clipboard summary,
// and a printable HTML report — all built client-side from the already-scoped roster.
// The pure data-shaping lives in exports.ts; only the DOM side-effects live here.
export function ExportMenu({ members, log, filter }: { members: Member[]; log: LogEntry[]; filter: Filter }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Semester dates (for the Excel + report headers) — read-only, cached by react-query.
  const { data: cfg } = useAppConfig()
  // 엑셀·PDF의 동산/셀 어휘는 로그인한 부를 따른다.
  const partition = usePartition()

  const lang: Lang = i18n.language === 'en' ? 'en' : 'ko'
  const today = easternNow().date

  async function doExcel() {
    setBusy(true)
    try {
      // Lazy-load SheetJS (the xlsx-js-style fork — it writes cell fills) so it stays out
      // of the main bundle.
      const XLSX = await import('xlsx-js-style')
      const wb = XLSX.utils.book_new()
      const { aoa, merges, fills } = gridSheet(members, log, lang, today, configCalendar(cfg), partition)
      const attendance = XLSX.utils.aoa_to_sheet(aoa)
      attendance['!merges'] = merges
      // Paint the per-동산 header colors onto the cells the grid marked.
      for (const f of fills) {
        const addr = XLSX.utils.encode_cell({ r: f.r, c: f.c })
        const cell = attendance[addr] ?? (attendance[addr] = { t: 's', v: '' })
        cell.s = { fill: { patternType: 'solid', fgColor: { rgb: f.rgb } } }
      }
      const full = XLSX.utils.aoa_to_sheet(logRows(members, log, lang, partition))
      // 글자 크기는 색·정렬을 다 얹은 뒤 마지막에 — 위의 `cell.s = {...}`가 통째로 갈아 끼우므로.
      applyFontSize(attendance)
      applyFontSize(full)
      XLSX.utils.book_append_sheet(wb, attendance, 'Attendance')
      XLSX.utils.book_append_sheet(wb, full, 'Full Log')
      XLSX.writeFile(wb, exportFilename(filter.group, today))
      setOpen(false)
    } catch {
      toast({ title: t('admin.sheet.export.excelFailed'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function doKakao() {
    const text = kakaoSummary(members, log, today, {
      group: filter.group,
      subgroup: filter.subgroup,
      lang,
    })
    const ok = await copyToClipboard(text)
    toast({ title: ok ? t('admin.sheet.export.copied') : t('admin.sheet.export.copyFailed'), tone: ok ? 'ok' : 'err' })
    if (ok) setOpen(false)
  }

  function doReport() {
    const html = reportHtml(members, log, {
      group: filter.group,
      subgroup: filter.subgroup,
      today,
      lang,
      semesterDates: configCalendar(cfg),
      partition,
    })
    const win = window.open('', '_blank')
    if (!win) {
      toast({ title: t('admin.sheet.export.popupBlocked'), tone: 'err' })
      return
    }
    win.document.open()
    win.document.write(html)
    win.document.close()
    setOpen(false)
  }

  return (
    <>
      {/* Opening the menu is the cue to fetch SheetJS: Excel is the first row in it, and a
          400 kB library downloading only after the tap is what made 내보내기 feel stuck. */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => { prefetchExcel(); setOpen(true) }}
        disabled={members.length === 0}
      >
        <Download size={15} strokeWidth={2} aria-hidden />
        {t('admin.sheet.export.action')}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)} title={t('admin.sheet.export.title')}>
          <div className="inset-list">
            <ExportRow title={t('admin.sheet.export.excel')} desc={t('admin.sheet.export.excelDesc')} icon="📊" onClick={doExcel} disabled={busy} />
            <ExportRow title={t('admin.sheet.export.kakao')} desc={t('admin.sheet.export.kakaoDesc')} icon="💬" onClick={doKakao} disabled={busy} />
            <ExportRow title={t('admin.sheet.export.report')} desc={t('admin.sheet.export.reportDesc')} icon="🖨️" onClick={doReport} disabled={busy} />
          </div>
        </Dialog>
      )}
    </>
  )
}

function ExportRow({
  title,
  desc,
  icon,
  onClick,
  disabled,
}: {
  title: string
  desc: string
  icon: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inset-row min-h-14 w-full py-2.5 text-left transition-[background-color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-fill active:scale-[0.99] disabled:opacity-50"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fill text-xl" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="block truncate text-xs text-muted">{desc}</span>
      </span>
      <ChevronRight size={17} strokeWidth={2.25} className="shrink-0 text-subtle" aria-hidden />
    </button>
  )
}

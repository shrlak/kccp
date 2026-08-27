import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addSheetSource,
  getSheetSync,
  removeSheetSource,
  rotateSheetSyncToken,
  runSheetSync,
  type SheetSyncOutcome,
} from '../../../lib/api'
import { refreshRoster } from '../../../lib/live'
import { useToast } from '../../../components/ui/Toast'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { Tag } from '../../../components/ui/Tag'
import { groupsOfPartition, termKeyLabel } from '../../../lib/partition'
import { usePartition } from '../../../lib/useAppConfig'

// 동산이 출석을 적는 구글 시트를 출석부에 붙이는 곳.
//
// 여기서 하는 일은 **어느 시트를 볼지 정하는 것**뿐이다. 시트를 읽고 해석하는 규칙은
// 서버에 있고(sheetSync.ts), 시트에 붙이는 Apps Script는 "바뀌었다"고 알리기만 한다.
// 그래서 학기마다 새 시트가 나도 여기에 링크를 하나 더 붙이면 끝이고, 읽는 규칙이 바뀌어도
// 시트를 손댈 일이 없다.
export function SheetSyncSection() {
  const { t, i18n } = useTranslation()
  const lang = (i18n.resolvedLanguage || i18n.language || 'ko').startsWith('en') ? 'en' : 'ko'
  const toast = useToast()
  const qc = useQueryClient()
  const partition = usePartition()
  const groups = groupsOfPartition(partition)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  // 시트에는 부서가 적혀 있지 않다 — 동산 이름뿐이다. 여름 합동 시트는 한 장에 두 부서가
  // 섞여 있고, 봄·가을에는 부서마다 시트가 따로다. 그 차이를 아는 것은 사람뿐이라 여기서 받는다.
  const [group, setGroup] = useState('')

  const { data, isLoading } = useQuery({ queryKey: ['sheetSync'], queryFn: getSheetSync })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sheetSync'] })

  const add = useMutation({
    mutationFn: () => addSheetSource(url.trim(), title.trim(), group),
    onSuccess: () => {
      setUrl(''); setTitle(''); setGroup('')
      invalidate()
      toast({ title: t('admin.sheetSync.added'), tone: 'ok' })
    },
    onError: (e: Error) => toast({ title: e.message || t('common.error'), tone: 'err' }),
  })

  const remove = useMutation({
    mutationFn: ({ id, gid }: { id: string; gid: string }) => removeSheetSource(id, gid),
    onSuccess: () => invalidate(),
    onError: () => toast({ title: t('common.error'), tone: 'err' }),
  })

  const rotate = useMutation({
    mutationFn: rotateSheetSyncToken,
    onSuccess: () => { invalidate(); toast({ title: t('admin.sheetSync.tokenRotated'), tone: 'ok' }) },
    onError: () => toast({ title: t('common.error'), tone: 'err' }),
  })

  const run = useMutation({
    mutationFn: () => runSheetSync(),
    onSuccess: (res) => {
      invalidate()
      // 방금 출석이 들어왔을 수 있다 — 출석부·오늘·통계가 같이 따라오도록 명단을 다시 부른다.
      refreshRoster(qc)
      const added = res.lastRun.outcomes.reduce((n, o) => n + o.added, 0)
      const removed = res.lastRun.outcomes.reduce((n, o) => n + o.removed, 0)
      toast({ title: t('admin.sheetSync.ranSummary', { added, removed }), tone: 'ok' })
    },
    onError: (e: Error) => toast({ title: e.message || t('common.error'), tone: 'err' }),
  })

  const sources = data?.sources ?? []

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: t('admin.sheetSync.copied'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 붙어 있는 시트들 */}
      <div className="inset-list">
        {isLoading && <div className="inset-row min-h-14 text-sm text-muted">{t('common.loading')}</div>}
        {!isLoading && !sources.length && (
          <div className="inset-row min-h-14 text-sm text-muted">{t('admin.sheetSync.none')}</div>
        )}
        {sources.map((s) => (
          <div key={`${s.id}|${s.gid}`} className="inset-row min-h-14 justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text">{s.title || s.id}</div>
              <div className="truncate font-mono text-xs text-muted">{s.id}{s.gid ? ` · gid ${s.gid}` : ''}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* 어느 학기의 시트인가. 이번 학기의 시트만 그 부서를 '담당'하고, 담당하는 동안은
                  그 부서의 동산 리더 링크가 나지 않는다 (둘로 적으면 시트가 덮어쓴다). */}
              {!!s.term && <Tag tone="muted">{termKeyLabel(s.term, partition, lang)}</Tag>}
              <Tag tone={s.group ? 'primary' : 'muted'}>{s.group || t('admin.sheetSync.groupCombined')}</Tag>
              <Button
                variant="ghost"
                onClick={() => remove.mutate({ id: s.id, gid: s.gid })}
                disabled={remove.isPending}
              >
                {t('admin.sheetSync.remove')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* 시트 붙이기 */}
      <div className="surface-panel flex flex-col gap-3 p-4">
        <label>
          <span className="field-label">{t('admin.sheetSync.linkLabel')}</span>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="font-mono text-xs"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="field-label">{t('admin.sheetSync.titleLabel')}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('admin.sheetSync.titlePlaceholder')} />
          </label>
          <label>
            <span className="field-label">{t('admin.sheetSync.groupLabel')}</span>
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">{t('admin.sheetSync.groupCombined')}</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </label>
        </div>
        <p className="text-xs text-muted">{t('admin.sheetSync.groupHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => add.mutate()} disabled={add.isPending || !url.trim()}>
            {add.isPending ? t('common.loading') : t('admin.sheetSync.add')}
          </Button>
          <Button variant="secondary" onClick={() => run.mutate()} disabled={run.isPending || !sources.length}>
            {run.isPending ? t('admin.sheetSync.running') : t('admin.sheetSync.runNow')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('admin.sheetSync.shareHint')}</p>
      </div>

      {/* 연동 키 — Apps Script에 붙여넣을 것 */}
      {data?.token && (
        <div className="surface-panel flex flex-col gap-2 p-4">
          <span className="field-label">{t('admin.sheetSync.tokenLabel')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-fill px-3 py-2 font-mono text-xs text-text">{data.token}</code>
            <Button variant="secondary" onClick={() => copy(data.token)}>{t('admin.sheetSync.copy')}</Button>
            <Button variant="ghost" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
              {t('admin.sheetSync.rotate')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('admin.sheetSync.tokenHint')}</p>
          {data.pingUrl && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-fill px-3 py-2 font-mono text-[11px] text-muted">{data.pingUrl}</code>
              <Button variant="ghost" onClick={() => copy(data.pingUrl!)}>{t('admin.sheetSync.copy')}</Button>
            </div>
          )}
        </div>
      )}

      {/* 지난번에 무슨 일이 있었나 */}
      {data?.lastRun && (
        <div className="surface-panel flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-text">{t('admin.sheetSync.lastRun')}</span>
            <span className="text-xs text-muted">
              {new Date(data.lastRun.at).toLocaleString('ko-KR', { timeZone: 'America/New_York' })}
              {' · '}
              {t(`admin.sheetSync.by${data.lastRun.by === 'sheet' ? 'Sheet' : data.lastRun.by === 'auto' ? 'Auto' : 'Admin'}`)}
            </span>
          </div>
          {data.lastRun.outcomes.map((o) => <OutcomeCard key={o.sourceId} outcome={o} />)}
        </div>
      )}
    </div>
  )
}

// 한 시트를 읽고 난 결과. 잘 된 숫자보다 **잘 안 된 것**을 크게 보여준다 — 못 찾은 이름과
// 총계가 어긋난 줄은 사람이 시트를 고쳐야 풀리는 것이고, 조용히 넘어가면 출석부가 틀린 채로
// 남는다.
function OutcomeCard({ outcome }: { outcome: SheetSyncOutcome }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-text">{outcome.title}</span>
        {outcome.error
          ? <Tag tone="danger">{t('admin.sheetSync.failed')}</Tag>
          : <Tag tone="success">{t('admin.sheetSync.ok')}</Tag>}
      </div>
      {outcome.error && <p className="mb-2 text-xs font-semibold text-danger">{outcome.error}</p>}
      {!outcome.error && (
        <p className="text-xs text-muted">
          {t('admin.sheetSync.counts', {
            added: outcome.added,
            removed: outcome.removed,
            marked: outcome.marked,
          })}
        </p>
      )}
      {!!outcome.created.length && (
        <Detail label={t('admin.sheetSync.created', { count: outcome.created.length })} items={outcome.created} tone="text-info" />
      )}
      {!!outcome.unmatched.length && (
        <Detail label={t('admin.sheetSync.unmatched', { count: outcome.unmatched.length })} items={outcome.unmatched} tone="text-warning" />
      )}
      {!!outcome.warnings.length && (
        <Detail label={t('admin.sheetSync.warnings', { count: outcome.warnings.length })} items={outcome.warnings} tone="text-danger" />
      )}
    </div>
  )
}

function Detail({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  return (
    <details className="mt-2">
      <summary className={'cursor-pointer text-xs font-semibold ' + tone}>{label}</summary>
      <ul className="mt-1 flex flex-col gap-1 pl-3">
        {items.map((item, i) => <li key={i} className="text-xs text-muted">{item}</li>)}
      </ul>
    </details>
  )
}

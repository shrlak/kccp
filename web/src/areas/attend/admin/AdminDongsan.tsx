import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDongsanNames,
  updateDongsanNames,
  type DongsanNames,
} from '../../../lib/api'
import { useToast } from '../../../components/ui/Toast'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Sprout, Trash2, Plus, AlertTriangle, Save } from '../../../components/ui/Icon'
import { renameAt, addDongsan, removeAt, cleanNames, summerDongsanList } from './dongsan'
import { DongsanLeadersEditor } from './DongsanLeaders'
import { DongsanLinksSection } from './DongsanLinks'
import { useAppConfig, usePartition, usePartitionT } from '../../../lib/useAppConfig'
import { groupsOfPartition, summerAppliesTo, type Partition } from '../../../lib/partition'

// 동산 admin tab (super-admin only): edit 동산 names + 동산지기/부동산지기. In summer mode the
// names editor collapses to ONE combined set of 동산 (no 대학부/청년부 split) which is written
// to both KM departments, matching how summer mode merges them everywhere else.
export function AdminDongsan() {
  const t = usePartitionT()
  const qc = useQueryClient()
  const { data: cfg } = useAppConfig()
  const { data: loaded } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  const partition = usePartition()
  const summer = !!cfg?.summerMode && summerAppliesTo(partition)

  if (!loaded) return <p className="text-sm text-muted">{t('common.loading')}</p>

  return (
    <div className="w-full">
      {/* Side by side on wide screens so neither list has to scroll the whole page to
          reach the other. 동산이름 only holds a name input per row, so it gets the narrow
          column; 동산지기/부동산지기 takes the rest so its cards can sit in one row
          (see DongsanLeadersEditor). */}
      <div className="grid grid-cols-1 gap-8 divide-y divide-border lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:divide-y-0 lg:divide-x">
        <div>
          <DongsanNamesEditor
            loaded={loaded}
            summer={summer}
            partition={partition}
            title={t('admin.settings.dongsanNames')}
            desc={t('admin.settings.dongsanNamesDesc')}
            onSave={async (next) => {
              await updateDongsanNames(next)
              await qc.invalidateQueries({ queryKey: ['dongsanNames'] })
            }}
          />
        </div>
        <div className="pt-8 lg:pl-8 lg:pt-0">
          <DongsanLeadersEditor />
        </div>
      </div>

      {/* 동산지기에게 건네는 출석 링크. 편성(위)이 정해진 뒤에 나오는 것이므로 그 아래 둔다.
          학기를 따라 저절로 나고 지므로 여름학기 여부도 여기서 넘기지 않는다 — 어느 자리에
          링크가 있는지는 서버가 정하고(시트가 담당하는 부서에는 내지 않는다) 그 결과가
          내려온다. */}
      <div className="mt-8 border-t border-border pt-8">
        <DongsanLinksSection partition={partition} />
      </div>
    </div>
  )
}

// A 동산-names list editor (add/rename/remove per 부서, or one combined list in summer
// mode), under its own title/desc heading.
export function DongsanNamesEditor({
  loaded,
  summer,
  partition,
  title,
  desc,
  onSave,
}: {
  loaded: DongsanNames
  summer: boolean
  // 어느 부의 편집기인가 — 저장돼 있는 이름이 하나도 없어도 이 부의 부서 줄은 깔아 둔다.
  partition: Partition
  title: string
  desc: string
  onSave: (next: DongsanNames) => Promise<void>
}) {
  const t = usePartitionT()
  const toast = useToast()
  const [edits, setEdits] = useState<DongsanNames | undefined>(undefined) // per-group (semester)
  const [combined, setCombined] = useState<string[] | undefined>(undefined) // single list (summer)
  const [saving, setSaving] = useState(false)

  const names = edits ?? loaded
  // 학기가 끝나면 서버가 동산 편성을 비우므로(term rollover) 이 맵이 통째로 비어서 온다.
  // 그때도 부서별 "동산 추가" 자리를 만들어 둬야 새 학기 동산을 넣을 수 있다 — 이 부의 부서를
  // 항상 먼저 깔고, 그 밖의 부서가 저장돼 있으면 뒤에 붙인다.
  const ownGroups = groupsOfPartition(partition)
  const groups = [...ownGroups, ...Object.keys(names).filter((g) => !ownGroups.includes(g))]
  const empty = groups.every((g) => (names[g] ?? []).length === 0)
  const combinedList = combined ?? summerDongsanList(loaded)
  const dirty = summer ? combined !== undefined : edits !== undefined

  async function save() {
    setSaving(true)
    try {
      let next: DongsanNames
      if (summer) {
        const clean = combinedList.map((n) => n.trim()).filter((n) => n.length > 0)
        next = { ...loaded }
        for (const g of ownGroups) next[g] = clean
      } else {
        next = cleanNames(names)
      }
      await onSave(next)
      setEdits(undefined)
      setCombined(undefined)
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
          <Sprout size={18} strokeWidth={2} aria-hidden />
        </span>
        <h2 className="font-display text-xl font-bold tracking-tight text-text">{title}</h2>
      </div>
      <p className="mb-4 mt-2 text-sm text-muted">{desc}</p>

      {empty && (
        <p className="mb-4 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted">
          {t('admin.settings.dongsanEmptyAfterTerm')}
        </p>
      )}

      {summer && (
        <p className="mb-4 flex w-fit items-center gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          <AlertTriangle size={14} strokeWidth={2} aria-hidden />
          {t('admin.settings.summerCombined')}
        </p>
      )}

      {summer ? (
        <div className="flex flex-col gap-2">
          {combinedList.map((name, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={name}
                placeholder={t('admin.settings.dongsanPlaceholder')}
                aria-label={`${t('admin.settings.dongsanPlaceholder')} ${idx + 1}`}
                className="min-w-0 flex-1"
                onChange={(e) =>
                  setCombined(combinedList.map((n, i) => (i === idx ? e.target.value : n)))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 !min-h-11 !w-11 !px-0 text-danger hover:bg-danger/10"
                onClick={() => setCombined(combinedList.filter((_, i) => i !== idx))}
                aria-label={`${t('admin.settings.removeDongsan')} ${name}`}
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setCombined([...combinedList, ''])}>
            <Plus size={15} strokeWidth={2.25} aria-hidden />
            {t('admin.settings.addDongsan')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group}>
              <span className="section-kicker mb-2 block">{group}</span>
              <div className="flex flex-col gap-2">
                {(names[group] ?? []).map((name, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={name}
                      placeholder={t('admin.settings.dongsanPlaceholder')}
                      aria-label={`${group} ${idx + 1}`}
                      className="min-w-0 flex-1"
                      onChange={(e) => setEdits(renameAt(names, group, idx, e.target.value))}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 !min-h-11 !w-11 !px-0 text-danger hover:bg-danger/10"
                      onClick={() => setEdits(removeAt(names, group, idx))}
                      aria-label={`${t('admin.settings.removeDongsan')} ${name}`}
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden />
                    </Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="self-start" onClick={() => setEdits(addDongsan(names, group))}>
                  <Plus size={15} strokeWidth={2.25} aria-hidden />
                  {t('admin.settings.addDongsan')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button className="mt-6" onClick={save} disabled={saving || !dirty}>
        {!saving && <Save size={15} strokeWidth={2} aria-hidden />}
        {saving ? t('common.loading') : t('admin.settings.save')}
      </Button>
    </div>
  )
}

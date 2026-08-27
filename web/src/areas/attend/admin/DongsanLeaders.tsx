import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDongsanNames,
  getDongsanLeaders,
  setDongsanLeader,
  type DongsanLeaderEntry,
} from '../../../lib/api'
import { useRoster } from './useRoster'
import { useToast } from '../../../components/ui/Toast'
import { Button } from '../../../components/ui/Button'
import { Medal, Shield, AlertTriangle, Save, Search, X } from '../../../components/ui/Icon'
import { leaderEntry, summerDongsanList, membersInDongsan, leaderOptions, pickerHits, withLeader, setSubLeaderAt } from './dongsan'
import { useAppConfig, usePartition, usePartitionT } from '../../../lib/useAppConfig'
import { groupsOfPartition, subLeaderSlots, summerAppliesTo } from '../../../lib/partition'

const SUMMER_KEY = '합동'

// Settings-tab editor: assign the 동산지기 + 부동산지기 for each 동산 (super-admin only).
// In summer mode the 동산 list collapses to a single combined ("합동") set spanning both
// KM departments, matching the legacy renderDongsanLeadersEditor() behaviour.
export function DongsanLeadersEditor() {
  const t = usePartitionT()
  const { data: cfg } = useAppConfig()
  const { data: names } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  const { data: leaders } = useQuery({ queryKey: ['dongsanLeaders'], queryFn: getDongsanLeaders })
  const { data: roster } = useRoster(true)
  // Local edits keyed by `${group}__${subgroup}`, overlaid on the loaded map.
  const [edits, setEdits] = useState<Record<string, DongsanLeaderEntry>>({})

  const partition = usePartition()
  const ownGroups = useMemo(() => groupsOfPartition(partition), [partition])
  const summer = !!cfg?.summerMode && summerAppliesTo(partition)

  // 부서마다 자기 줄을 갖는다 — 대학부 동산과 청년부 동산이 한 줄에 섞이지 않도록
  // 섹션으로 나눠 렌더한다. 여름 모드에서는 합동 한 덩어리가 유일한 섹션이다.
  const sections = useMemo(() => {
    if (!names || !roster) return []
    if (summer) {
      return [{
        group: SUMMER_KEY,
        blocks: summerDongsanList(names).map((subgroup) => ({
          group: SUMMER_KEY,
          subgroup,
          members: membersInDongsan(roster.members, null, subgroup),
        })),
      }]
    }
    return ownGroups.concat(Object.keys(names).filter((g) => !ownGroups.includes(g)))
      .map((group) => ({
        group,
        blocks: (names[group] ?? []).map((subgroup) => ({
          group,
          subgroup,
          members: membersInDongsan(roster.members, group, subgroup),
        })),
      }))
      .filter((section) => section.blocks.length > 0)
  }, [names, roster, summer, ownGroups])

  // 검색은 이 셀 밖까지 닿아야 한다 — 명단과 편성표가 어긋난 셀이 실제로 있다 (셀 명단은
  // 마나도인데 편성표에는 고렌 셀장). 그래서 부 전체 이름을 함께 넘긴다.
  const allNames = useMemo(
    () => Array.from(new Set((roster?.members ?? []).map((m) => m.name))).sort((a, b) => a.localeCompare(b)),
    [roster],
  )

  if (!names || !leaders || !roster) return <p className="text-sm text-muted">{t('common.loading')}</p>

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
          <Medal size={18} strokeWidth={2} aria-hidden />
        </span>
        <h2 className="font-display text-xl font-bold tracking-tight text-text">{t('admin.settings.dongsanLeaders')}</h2>
      </div>
      <p className="mb-4 mt-2 text-sm text-muted">{t('admin.settings.dongsanLeadersDesc')}</p>

      {summer && (
        <p className="mb-4 flex w-fit items-center gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          <AlertTriangle size={14} strokeWidth={2} aria-hidden />
          {t('admin.settings.summerCombined')}
        </p>
      )}

      {sections.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted">
          {t('admin.settings.dongsanEmptyAfterTerm')}
        </p>
      )}

      {/* One row per 부서: each section's cards auto-fit across their own grid, so 대학부
          and 청년부 동산 never share a row. 여름 모드는 합동 한 섹션뿐이다. */}
      <div className="flex flex-col gap-7">
        {sections.map((section) => (
          <div key={section.group}>
            {section.group !== SUMMER_KEY && <span className="section-kicker mb-2 block">{section.group}</span>}
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
              {section.blocks.map(({ group, subgroup, members }) => {
                const key = `${group}__${subgroup}`
                const entry = edits[key] ?? leaderEntry(leaders, group, subgroup)
                return (
                  <LeaderBlock
                    key={key}
                    header={group === SUMMER_KEY ? subgroup : subgroup}
                    members={members}
                    allNames={allNames}
                    entry={entry}
                    dirty={key in edits}
                    onLeader={(name) => setEdits((e) => ({ ...e, [key]: withLeader(entry, name) }))}
                    onSub={(idx, name) => setEdits((e) => ({ ...e, [key]: setSubLeaderAt(entry, idx, name) }))}
                    onSaved={() =>
                      setEdits((e) => {
                        const next = { ...e }
                        delete next[key]
                        return next
                      })
                    }
                    group={group}
                    subgroup={subgroup}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeaderBlock({
  header,
  members,
  allNames,
  entry,
  dirty,
  group,
  subgroup,
  onLeader,
  onSub,
  onSaved,
}: {
  header: string
  members: string[]
  allNames: string[]
  entry: DongsanLeaderEntry
  dirty: boolean
  group: string
  subgroup: string
  onLeader: (name: string) => void
  onSub: (idx: number, name: string) => void
  onSaved: () => void
}) {
  const t = usePartitionT()
  const toast = useToast()
  const qc = useQueryClient()
  const partition = usePartition()
  const [saving, setSaving] = useState(false)
  // 부지기 칸 수는 부마다 다르다 — 대학·청년부 동산은 부동산지기 둘, 장년부 셀은 부셀장 하나.
  // 예전 데이터가 더 많이 들고 있으면 그만큼 칸을 열어 준다 (지우지 않고 보여 준 뒤 고치도록).
  const slots = Math.max(subLeaderSlots(partition), entry.subLeaders.length)
  // 그 동산의 사람들 + 이미 지기로 적혀 있는 바깥 사람 (leaderOptions 주석 참고).
  const options = useMemo(() => leaderOptions(members, entry), [members, entry])

  async function save() {
    setSaving(true)
    try {
      await setDongsanLeader(group, subgroup, entry.leader, entry.subLeaders)
      await qc.invalidateQueries({ queryKey: ['dongsanLeaders'] })
      onSaved()
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface-2 p-3.5 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-bold tracking-tight text-text">
        <Medal size={15} strokeWidth={2} className="shrink-0 text-gold" aria-hidden />
        <span className="truncate">{header}</span>
      </div>

      {options.length === 0 ? (
        <p className="text-xs text-muted">{t('admin.settings.noDongsanMembers')}</p>
      ) : (
        <>
          <label className="mb-3 block">
            <span className="field-label flex items-center gap-1">
              <Medal size={12} strokeWidth={2} className="text-gold" aria-hidden />
              {t('admin.settings.leader')}
            </span>
            <NamePicker
              value={entry.leader}
              onChange={onLeader}
              inCell={options}
              allNames={allNames}
              placeholder={t('admin.settings.noLeader')}
            />
          </label>

          <span className="field-label flex items-center gap-1">
            <Shield size={12} strokeWidth={2} className="text-muted" aria-hidden />
            {t('admin.settings.subLeaders')}
          </span>
          <div className="mb-3 flex flex-col gap-2">
            {Array.from({ length: slots }, (_, i) => (
              <NamePicker
                key={i}
                value={entry.subLeaders[i] ?? ''}
                onChange={(name) => onSub(i, name)}
                inCell={options}
                allNames={allNames}
                placeholder={t('admin.settings.noLeader')}
                label={`${t('admin.settings.subLeaders')} ${i + 1}`}
              />
            ))}
          </div>

          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {!saving && <Save size={14} strokeWidth={2} aria-hidden />}
            {saving ? t('common.loading') : t('admin.settings.save')}
          </Button>
        </>
      )}
    </div>
  )
}

// 이름 고르기 — 목록이 길어지면 눈으로 훑는 것보다 치는 편이 빠르다. 장년부는 한 셀이
// 스무 명 가까이 되고 부 전체로는 삼백 명에 가깝다.
//
// 두 묶음으로 나눠 보여 준다: **이 셀 사람들**이 먼저고, 검색어를 치면 그 아래로 부의
// 나머지가 따라온다. 셀장은 대개 그 셀 사람이지만 언제나 그런 것은 아니라서 (명단과
// 편성표가 어긋난 셀이 실제로 있다), 기본은 좁게 두되 길은 열어 둔다.
function NamePicker({
  value,
  onChange,
  inCell,
  allNames,
  placeholder,
  label,
}: {
  value: string
  onChange: (name: string) => void
  inCell: string[]
  allNames: string[]
  placeholder: string
  label?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const q = query.trim()
  const { cell: cellHits, outside: outsideHits } = pickerHits(q, inCell, allNames)

  function pick(name: string) {
    onChange(name)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} strokeWidth={2} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          value={open ? query : value}
          placeholder={value || placeholder}
          aria-label={label}
          onFocus={() => { setQuery(''); setOpen(true) }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-11 w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-8 text-sm text-text outline-none transition-[border-color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:border-primary/30 focus-visible:border-primary focus-visible:ring-[3.5px] focus-visible:ring-primary/18"
        />
        {value && !open && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={placeholder}
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-subtle hover:bg-fill hover:text-text"
          >
            <X size={13} strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-lg)]">
          <li>
            <Option label={placeholder} muted onPick={() => pick('')} />
          </li>
          {cellHits.map((n) => (
            <li key={n}>
              <Option label={n} active={n === value} onPick={() => pick(n)} />
            </li>
          ))}
          {outsideHits.length > 0 && (
            <li className="px-2.5 pb-1 pt-2 text-[11px] font-semibold text-subtle">다른 셀</li>
          )}
          {outsideHits.map((n) => (
            <li key={n}>
              <Option label={n} active={n === value} onPick={() => pick(n)} />
            </li>
          ))}
          {cellHits.length === 0 && outsideHits.length === 0 && (
            <li className="px-2.5 py-2 text-xs text-muted">{q ? '찾는 이름이 없습니다' : '—'}</li>
          )}
        </ul>
      )}
    </div>
  )
}

function Option({
  label,
  active = false,
  muted = false,
  onPick,
}: {
  label: string
  active?: boolean
  muted?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      // onBlur가 먼저 닫아 버리면 클릭이 사라진다 — 마우스를 누르는 순간 고른다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={
        'block w-full truncate rounded-lg px-2.5 py-2 text-left text-sm transition-colors ' +
        (active ? 'bg-primary/10 font-semibold text-primary' : muted ? 'text-muted hover:bg-fill' : 'text-text hover:bg-fill')
      }
    >
      {label}
    </button>
  )
}

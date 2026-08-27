import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDongsanBoard, markDongsan, type DongsanBoard, type DongsanBoardMember } from '../../../lib/api'
import { hasHidingMark } from '../../../lib/status'
import { KccpMark } from '../checkin/KccpMark'
import { ThemeLangToggle } from '../../../components/ui/ThemeLangToggle'
import { useToast } from '../../../components/ui/Toast'

// ── /dongsan/:token — 부서 담당자가 그 부서의 동산모임 출석을 적는 화면 ───────────
// 로그인이 없다. 링크가 신원이고, 그 링크는 부서 하나를 가리킨다 — 이 화면으로 볼 수 있는
// 것은 그 부서 사람들의 이름과 그들의 **동산모임** 출석뿐이다. 예배 출석도, 연락처도, 다른
// 부서도 여기서는 보이지 않는다 (서버 /api/dongsan/board가 그만큼만 내려준다).
//
// **표로 적는다**: 세로가 사람, 가로가 주일이고 칸마다 O/X를 고른다. 주일을 하나씩 골라 가며
// 적으면 지난주를 마저 채우는 데 화면을 여러 번 오가야 하고, 무엇보다 "우리 동산이 요즘 어떤가"가
// 한눈에 안 보인다. 관리자 출석부와 같은 모양이라 옮겨 적을 때도 눈이 덜 미끄러진다.
//
// 왜 O/X 둘뿐인가: 표에서 출석은 "줄이 있다/없다"이고, 없는 줄은 "안 왔다"와 "아직 안 적었다"를
// 구별하지 않는다. 시트 연동에서는 그 구별이 중요했지만(빈칸을 결석으로 읽으면 안 되니까),
// 여기서는 적는 사람이 곧 그 부서의 담당자라 X가 곧 "안 왔다"이다. 다만 아직 손대지 않은 주일도
// X로 보이므로, 각 열의 **합계**를 함께 두어 0인 열이 눈에 띄게 했다.
export function DongsanBoardScreen() {
  const { token = '' } = useParams()
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const key = ['dongsanBoard', token]
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => getDongsanBoard(token),
    enabled: !!token,
    retry: false,
  })

  const ctx = data?.partition === 'adult' ? 'adult' : undefined

  // 귀국·이주처럼 명단에서 빠진 사람은 리더 화면에도 뜨지 않는다 — 앱 전체가 쓰는 그 규칙을
  // 그대로 쓴다 (lib/status.ts가 그 규칙의 단 하나뿐인 독자다).
  const members = useMemo(
    () => (data?.members ?? []).filter((m) => !hasHidingMark(statusOf(m))),
    [data?.members],
  )
  const marks = useMemo(() => new Set(data?.marks ?? []), [data?.marks])

  // 링크 하나가 부서 하나를 담으므로 화면은 동산별로 묶어 그린다 — 이름만 30줄 늘어놓으면
  // 적는 사람이 자기 줄을 못 찾는다. 동산이 아직 없는 사람은 '동산 미지정' 블록에 모인다
  // (편성 전에도 이 링크로 적을 수 있어야 한다). 서버가 이미 동산 → 이름 순으로 정렬해 보낸다.
  const blocks = useMemo(() => {
    const out: { subgroup: string; members: typeof members }[] = []
    for (const m of members) {
      const last = out[out.length - 1]
      if (last && last.subgroup === m.subgroup) last.members.push(m)
      else out.push({ subgroup: m.subgroup, members: [m] })
    }
    return out
  }, [members])

  const mark = useMutation({
    mutationFn: ({ memberId, date, present }: { memberId: string; date: string; present: boolean }) =>
      markDongsan(token, memberId, date, present),
    // 고른 값이 화면에 바로 남는다 — 왕복을 기다리면 드롭다운이 되돌아갔다가 다시 바뀐다.
    onMutate: async ({ memberId, date, present }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<DongsanBoard>(key)
      if (prev) {
        const cell = `${memberId}|${date}`
        qc.setQueryData<DongsanBoard>(key, {
          ...prev,
          marks: present ? [...prev.marks.filter((c) => c !== cell), cell] : prev.marks.filter((c) => c !== cell),
        })
      }
      return { prev }
    },
    onError: (_e, _v, context) => {
      if (context?.prev) qc.setQueryData(key, context.prev)
      toast({ title: t('dongsan.saveFailed'), tone: 'err' })
    },
  })

  const dates = data?.dates ?? []

  return (
    <main className="relative flex min-h-dvh flex-col bg-canvas">
      <header className="material-bar sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)]">
        <div className="safe-x mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <KccpMark size={28} className="shrink-0" />
            <div className="min-w-0">
              {/* 이 링크가 어느 부서의 것인지가 제목이다 ('대학부 전체'). 열자마자 자기 것이
                  맞는지 알아야 남의 부서에 적지 않는다. */}
              <h1 className="truncate font-display text-base font-bold tracking-tight text-text">
                {!data
                  ? t('dongsan.title', { context: ctx })
                  : t('dongsan.wholeGroup', { group: data.group })}
              </h1>
              {data && (
                <p className="truncate text-[11px] text-muted">{t('dongsan.title', { context: ctx })}</p>
              )}
            </div>
          </div>
          <ThemeLangToggle />
        </div>
      </header>

      <div className="safe-x mx-auto w-full max-w-4xl grow px-4 py-5">
        {isLoading && <p className="text-sm text-muted">{t('common.loading')}</p>}

        {/* 폐기된 링크·오타 난 주소는 여기로 온다. 무엇이 잘못됐는지만 말하고 끝낸다 —
            이 화면에는 로그인도, 다시 시도할 다른 길도 없다. */}
        {!isLoading && (error || !data) && (
          <div className="surface-panel p-5 text-center">
            <p className="text-sm font-semibold text-text">{t('dongsan.gone')}</p>
            <p className="mt-1 text-xs text-muted">{t('dongsan.goneHint', { context: ctx })}</p>
          </div>
        )}

        {data && (
          <>
            {!members.length ? (
              <div className="inset-list">
                <div className="inset-row min-h-14 text-sm text-muted">{t('dongsan.noMembers', { context: ctx })}</div>
              </div>
            ) : (
              blocks.map((block) => (
                <DongsanTable
                  key={block.subgroup}
                  title={block.subgroup || t('dongsan.noSubgroup', { context: ctx })}
                  members={block.members}
                  dates={dates}
                  marks={marks}
                  onPick={(memberId, date, present) => mark.mutate({ memberId, date, present })}
                />
              ))
            )}

            <p className="mt-5 text-xs text-muted">{t('dongsan.hint', { context: ctx })}</p>
            <p className="mt-1 text-xs text-muted">{t('dongsan.blankNote')}</p>
          </>
        )}
      </div>
    </main>
  )
}

// 한 동산의 표. 세로가 사람, 가로가 주일. 관리자 출석부(AdminSheet GridView)와 같은 방식으로
// 이름 열을 왼쪽에 고정하고 나머지를 가로로 굴린다 — 폰에서는 8주가 한 화면에 들어가지 않는다.
function DongsanTable({
  title,
  members,
  dates,
  marks,
  onPick,
}: {
  title: string
  members: DongsanBoardMember[]
  dates: string[]
  marks: Set<string>
  onPick: (memberId: string, date: string, present: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <section className="mt-4 first:mt-0">
      <span className="section-kicker mb-1.5 block">{title}</span>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th
                scope="col"
                className="sticky left-0 z-[1] min-w-[7.5rem] bg-surface-2 px-3 py-2 text-left text-xs font-semibold
                           text-muted shadow-[1px_0_0_var(--color-border)]"
              >
                {t('dongsan.name')}
              </th>
              {dates.map((d) => (
                <th key={d} scope="col" className="min-w-[4.5rem] px-1.5 py-2 text-center text-xs font-semibold text-muted">
                  {shortSunday(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <th
                  scope="row"
                  className="sticky left-0 z-[1] bg-surface px-3 py-1.5 text-left text-sm font-semibold text-text
                             shadow-[1px_0_0_var(--color-border)]"
                >
                  <span className="block max-w-[7rem] truncate">{m.name}</span>
                </th>
                {dates.map((d) => {
                  const present = marks.has(`${m.id}|${d}`)
                  return (
                    <td key={d} className="px-1 py-1 text-center">
                      {/* 칸마다 드롭다운. 네이티브 select라 폰에서 손가락으로 고르기 쉽고,
                          O/X 둘뿐이라 고르는 동안 헷갈릴 것이 없다. */}
                      <select
                        aria-label={`${m.name} ${d}`}
                        value={present ? 'O' : 'X'}
                        onChange={(e) => onPick(m.id, d, e.target.value === 'O')}
                        className={
                          'min-h-9 w-full cursor-pointer appearance-none rounded-lg border border-border bg-surface ' +
                          'text-center text-sm font-bold outline-none transition-colors duration-150 ' +
                          'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/18 ' +
                          (present ? 'text-success' : 'text-subtle')
                        }
                      >
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          {/* 합계 — 아직 손대지 않은 주일은 0으로 드러난다 (그 열은 전부 X로 보이므로). */}
          <tfoot>
            <tr className="border-t border-border bg-surface-2">
              <th
                scope="row"
                className="sticky left-0 z-[1] bg-surface-2 px-3 py-2 text-left text-xs font-semibold text-muted
                           shadow-[1px_0_0_var(--color-border)]"
              >
                {t('dongsan.total')}
              </th>
              {dates.map((d) => {
                const n = members.filter((m) => marks.has(`${m.id}|${d}`)).length
                return (
                  <td key={d} className={'px-1.5 py-2 text-center text-xs font-bold tabular-nums ' + (n ? 'text-text' : 'text-subtle')}>
                    {n}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

// 서버는 표에 있는 그대로 — 비어 있으면 null — 을 실어 보내고, status.ts는 Member의 모양
// (비어 있으면 없는 칸)을 읽는다. 그 한 칸 차이를 여기서 맞춘다. 표기를 읽는 규칙 자체는
// 여전히 status.ts 하나뿐이고, 여기서 하는 일은 모양을 맞춰 넘기는 것뿐이다.
function statusOf(m: DongsanBoardMember) {
  return {
    status_note: m.status_note ?? undefined,
    status_start: m.status_start ?? null,
    status_end: m.status_end ?? null,
    status_marks: m.status_marks ?? undefined,
  }
}

// 2026-08-09 → "8/9". 열이 여덟 개라 머리글은 짧아야 하고, 그 안에서 주일끼리 구별만 되면
// 된다. toLocaleDateString을 쓰지 않는 이유는 ko-KR이 "8. 9."로 점을 찍어 좁은 칸에서 지저분해
// 지기 때문이고, 어차피 월/일 두 숫자라 언어에 따라 달라질 것이 없다. 문자열에서 바로 자르므로
// 자정 UTC로 읽혀 하루 밀리는 일도 없다.
function shortSunday(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

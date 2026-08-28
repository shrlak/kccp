import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  createDongsanLink,
  getDongsanLinks,
  revokeDongsanLink,
  type DongsanLink,
} from '../../../lib/api'
import { useToast } from '../../../components/ui/Toast'
import { Button } from '../../../components/ui/Button'
import { Tag } from '../../../components/ui/Tag'
import { Link } from '../../../components/ui/Icon'
import { usePartitionT } from '../../../lib/useAppConfig'
import { groupsOfPartition, termKeyLabel, type Partition } from '../../../lib/partition'

// 동산 탭의 "동산 리더 링크" — 부서마다 링크가 하나 있고, 복사해서 그 부서 담당자에게 건넨다.
//
// 링크가 곧 범위다: 대학부 링크로는 대학부만 보이고 적힌다. 하나가 새도 새는 것은 그 부서
// 하나뿐이고, 거둘 때도 그 하나만 거둔다. (공용 비밀번호 하나로 리더 전체를 들여보내던 방식을
// 이 프로젝트가 왜 버렸는지는 CLAUDE.md에 있다 — 범위를 짚지 못하는 열쇠가 문제였다.)
//
// **링크는 학기를 따라 저절로 나고 진다** (서버 dongsanLink.ts reconcileTermLinks). 학기가
// 시작하면 그 학기의 링크가 나 있고, 학기가 끝나면 걷힌다 — 이 화면에서 사람이 할 일은 이번
// 학기 주소를 복사해 건네는 것과, 새어 나갔을 때 새 주소로 바꾸는 것뿐이다. 그래서 자리마다
// 어느 학기의 링크인지가 적히고, 주소 자체에도 학기·연도·부서가 들어간다
// (…/dongsan/2026-fall-college-9f3c…).
//
// 어느 자리에 링크가 있고 어디에 없는지는 **서버가 내려준다**: 시트가 담당하는 부서(그 부서의
// 동산 출석은 구글 시트가 갖고 온다), 학기 사이라 아직 낼 학기가 없는 경우. 규칙을 화면에 옮겨
// 적으면 서버와 어긋나므로 받은 것을 그린다.
export function DongsanLinksSection({ partition }: { partition: Partition }) {
  const t = usePartitionT()
  const { i18n } = useTranslation()
  const lang = (i18n.resolvedLanguage || i18n.language || 'ko').startsWith('en') ? 'en' : 'ko'
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['dongsanLinks'], queryFn: getDongsanLinks })
  const links = data?.links ?? []
  const term = data?.term ?? ''
  const sheetGroups = data?.sheetGroups ?? []
  // 학기를 따라 자동으로 나고 지는 부인가 (대학·청년부). 장년부에는 학기가 없어 사람이 낸다.
  const auto = data?.auto ?? false

  const invalidate = () => qc.invalidateQueries({ queryKey: ['dongsanLinks'] })

  const create = useMutation({
    mutationFn: ({ group }: { group: string }) => createDongsanLink(group),
    onSuccess: () => invalidate(),
    onError: () => toast({ title: t('common.error'), tone: 'err' }),
  })

  // 학기 중인 부서 링크를 거두면 서버가 같은 자리에 새 주소를 낸다 — 그래서 문구가 둘이다.
  const revoke = useMutation({
    mutationFn: ({ token }: { token: string; reissued: boolean }) => revokeDongsanLink(token),
    onSuccess: (_res, { reissued }) => {
      invalidate()
      toast({
        title: t(reissued ? 'admin.settings.dongsanLinkReissued' : 'admin.settings.dongsanLinkRevoked'),
        tone: 'ok',
      })
    },
    onError: () => toast({ title: t('common.error'), tone: 'err' }),
  })

  // **링크는 부서 하나짜리뿐이다** — 대학부 전체 · 청년부 전체. 그 부서의 동산을 다 담고,
  // 화면은 동산별로 묶어 그린다. 동산마다 링크를 따로 내는 방식은 두지 않는다: 적는 사람이
  // 부서 담당자 한 명이면 링크도 하나여야 관리가 되고, 동산이 새로 서거나 이름이 바뀔 때마다
  // 링크를 다시 내고 다시 나눠 주는 일이 없다. 동산이 아직 없는 사람도 이 링크에는 '동산
  // 미지정'으로 남으므로 편성 전에도 쓸 수 있다.
  const rows = groupsOfPartition(partition).map((group) => ({
    group,
    // 시트가 담당하는 부서에는 링크가 없다. 같은 동산을 시트와 링크로 함께 적으면 다음
    // 동기화에서 시트 값이 이 화면으로 적은 것을 덮어쓰기 때문이다.
    sheet: sheetGroups.includes(group),
    link: links.find((l) => l.group === group && !l.subgroup && (!auto || l.term === term)),
  }))

  async function copy(link: DongsanLink) {
    try {
      await navigator.clipboard.writeText(linkUrl(link.token))
      toast({ title: t('admin.settings.dongsanLinkCopied'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-info/12 text-info">
          <Link size={18} strokeWidth={2} aria-hidden />
        </span>
        <h2 className="font-display text-xl font-bold tracking-tight text-text">
          {t('admin.settings.dongsanLinks')}
        </h2>
      </div>
      <p className="mb-4 mt-2 text-sm text-muted">
        {t(auto ? 'admin.settings.dongsanLinksAutoDesc' : 'admin.settings.dongsanLinksDesc')}
      </p>

      <div className="inset-list">
        {isLoading && <div className="inset-row min-h-14 text-sm text-muted">{t('common.loading')}</div>}
        {rows.map(({ group, sheet, link }) => (
          <div key={group} className="inset-row min-h-14 items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-text">
                {t('admin.settings.dongsanLinkWholeGroup', { group })}
              </span>
              <Tag tone="primary">{group}</Tag>
              {/* 어느 학기의 링크인지 — 주소에도 적혀 있지만 자리에서 먼저 보여야 한다. */}
              {!!link?.term && <Tag tone="muted">{termKeyLabel(link.term, partition, lang)}</Tag>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {sheet ? (
                <span className="text-xs text-muted">{t('admin.settings.dongsanLinkSheet')}</span>
              ) : link ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => copy(link)}>
                    {t('admin.settings.dongsanLinkCopy')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger/10"
                    onClick={() => revoke.mutate({ token: link.token, reissued: auto })}
                    disabled={revoke.isPending}
                  >
                    {t(auto ? 'admin.settings.dongsanLinkReissue' : 'admin.settings.dongsanLinkRevoke')}
                  </Button>
                </>
              ) : auto ? (
                // 학기 사이 — 적을 학기가 없으니 열어 둘 링크도 없다. 다음 학기가 시작하면
                // 이 자리에 새 링크가 저절로 난다.
                <span className="text-xs text-muted">{t('admin.settings.dongsanLinkBetweenTerms')}</span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => create.mutate({ group })}
                  disabled={create.isPending}
                >
                  {t('admin.settings.dongsanLinkCreate')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 위 자리에 그려지지 않는 링크 — 동산별로 내던 시절의 것이나, 지난 학기의 것이 아직
          걷히기 전인 경우. 목록에서 사라지면 거둘 방법도 사라지므로 여기 남겨 둔다. */}
      {links
        .filter((l) => !rows.some((r) => r.link?.token === l.token))
        .map((l) => (
          <div key={l.token} className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3 py-2">
            <span className="truncate text-xs text-muted">
              {l.subgroup || t('admin.settings.dongsanLinkWholeGroup', { group: l.group })}
              {l.subgroup && l.group ? ` · ${l.group}` : ''}
              {l.term ? ` · ${termKeyLabel(l.term, partition, lang)}` : ''}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => copy(l)}>{t('admin.settings.dongsanLinkCopy')}</Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger/10"
                onClick={() => revoke.mutate({ token: l.token, reissued: false })}
              >
                {t('admin.settings.dongsanLinkRevoke')}
              </Button>
            </div>
          </div>
        ))}

      {/* 안내는 화면에 실제로 있는 것을 설명할 때만 띄운다 — 시트가 담당하는 학기처럼 복사할
          링크가 하나도 없을 때는 '새 주소로 바꾸기'를 설명해 봐야 가리키는 것이 없다. */}
      {(auto && rows.some((r) => r.link) ? (
        <p className="mt-3 text-xs text-muted">{t('admin.settings.dongsanLinkAutoHint')}</p>
      ) : links.length ? (
        <p className="mt-3 text-xs text-muted">{t('admin.settings.dongsanLinkHint')}</p>
      ) : null)}
    </div>
  )
}

// 링크는 이 앱이 사는 주소 그대로다 (GitHub Pages의 /kccp/ 하위 경로 포함).
// 이 파일 안에서만 쓴다 — 컴포넌트 파일이 값까지 내보내면 (react-refresh) 핫 리로드가 깨진다.
function linkUrl(token: string) {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}dongsan/${token}`
}

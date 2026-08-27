import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Member } from '../../../lib/api'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Copy, Phone, Mail, AlertTriangle } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { copyToClipboard } from '../../../lib/clipboard'
import { contactCards, kakaoIdList, type ContactCard } from './contactQr'
import { newFamilyWeek } from './newFamily'
import { loadQrEncoder, modulesToPath, type QrModules } from './qrEncode'

// ── 새가족 카톡 추가 — QR 판 ────────────────────────────────────────────────────
// 고른 새가족을 한 화면에 QR로 늘어놓는다. 새가족팀이 자기 폰 카메라로 하나씩 찍으면
// 연락처에 차례로 저장되고, 카카오톡이 전화번호로 그 사람들을 친구 목록에 올려 준다.
// QR이 담고 있는 것이 카톡 링크가 아니라 연락처인 이유는 contactQr.ts 머리말에 있다.
//
// 번호가 없어 찍을 수 없는 사람은 감추지 않고 아래에 따로 모은다 — 안 보이면 "이 사람은
// 왜 없지"가 되고, 결국 명단을 다시 뒤지게 된다.

// 누구를 찍을 것인가. 체크박스 목록 대신 두 갈래만 두는 이유는, 이 일이 언제나 "이번에
// 새로 온 사람들을 카톡에 넣는" 일이기 때문이다 — 여섯 칸을 체크하는 것보다 빠르다.
type Cohort = 'recent' | 'all'

export function KakaoQrDialog({ members, today, onClose }: { members: Member[]; today: string; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [cohort, setCohort] = useState<Cohort>('recent')
  const recent = members.filter((m) => {
    const w = newFamilyWeek(m.registration_date, today)
    return w === 'thisWeek' || w === 'lastWeek'
  })
  // 이번 주·지난주에 등록한 사람이 아무도 없으면 (주중이거나 조용한 학기) 빈 화면을 내미는
  // 대신 이번 학기 전체를 보여준다 — 고를 것이 없는 갈래를 기본으로 둘 이유가 없다.
  const shown = cohort === 'recent' && recent.length > 0 ? recent : members
  const cards = contactCards(shown)
  const scannable = cards.filter((c) => c.scannable)
  const unscannable = cards.filter((c) => !c.scannable)
  const idText = kakaoIdList(shown)

  async function copyIds() {
    const ok = await copyToClipboard(idText)
    toast({ title: t(ok ? 'admin.kakaoQr.idsCopied' : 'admin.kakaoQr.copyFailed'), tone: ok ? 'ok' : 'err' })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.kakaoQr.title')} wide>
      <p className="mb-3 text-sm text-muted">{t('admin.kakaoQr.how')}</p>

      {recent.length > 0 && members.length > recent.length && (
        <div className="mb-4 flex gap-1.5">
          <CohortChip active={cohort === 'recent'} onClick={() => setCohort('recent')} label={t('admin.kakaoQr.cohortRecent', { n: recent.length })} />
          <CohortChip active={cohort === 'all'} onClick={() => setCohort('all')} label={t('admin.kakaoQr.cohortAll', { n: members.length })} />
        </div>
      )}

      {scannable.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {scannable.map((c) => (
            <QrTile key={c.member.id} card={c} />
          ))}
        </ul>
      )}

      {unscannable.length > 0 && (
        <div className="mt-5 rounded-2xl border border-warning/30 bg-warning/[0.06] p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-warning">
            <AlertTriangle className="size-3.5" aria-hidden />
            {t('admin.kakaoQr.noPhoneTitle', { n: unscannable.length })}
          </div>
          {/* 이 사람들은 QR로 붙지 않는다 — 남은 단서인 카톡 아이디를 그대로 보여준다. */}
          <ul className="flex flex-col gap-1">
            {unscannable.map((c) => (
              <li key={c.member.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-text">{c.name}</span>
                {c.kakao.kind === 'none' ? (
                  <span className="text-xs text-subtle">{t('admin.kakaoQr.nothingToGoOn')}</span>
                ) : (
                  <CopyableId card={c} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copyIds()} disabled={!idText} className="flex-1">
          <Copy className="size-4" aria-hidden />
          {t('admin.kakaoQr.copyIds')}
        </Button>
      </div>
      <p className="mt-3 text-xs text-subtle">{t('admin.kakaoQr.footnote')}</p>
    </Dialog>
  )
}

function CohortChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full px-3 py-1 text-xs font-semibold transition-colors ' +
        (active ? 'bg-primary/10 text-primary' : 'bg-fill text-muted hover:text-text')
      }
    >
      {label}
    </button>
  )
}

// 아이디 한 개 — 탭하면 복사된다 (카톡 검색창에 붙여넣는 것이 유일한 다음 동작이므로).
function CopyableId({ card }: { card: ContactCard }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { kind, raw } = card.kakao
  const Icon = kind === 'phone' ? Phone : kind === 'email' ? Mail : Copy
  return (
    <button
      type="button"
      onClick={() => void copyToClipboard(raw).then((ok) =>
        toast({ title: t(ok ? 'admin.kakaoQr.idCopied' : 'admin.kakaoQr.copyFailed'), tone: ok ? 'ok' : 'err' }),
      )}
      // 카톡 칸에 이메일이 적혀 오는 일이 잦은데 폰 폭에서는 칸을 넘는다 — 넘치는 대신 줄인다.
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-fill px-2 py-0.5 font-mono text-xs text-muted transition-colors hover:bg-fill-hover hover:text-text"
      title={raw}
    >
      <Icon className="size-3 shrink-0 text-subtle" aria-hidden />
      <span className="truncate">{raw}</span>
    </button>
  )
}

function QrTile({ card }: { card: ContactCard }) {
  const { t } = useTranslation()
  return (
    <li className="flex flex-col items-center rounded-2xl border border-border bg-surface p-3">
      <Qr payload={card.payload} label={t('admin.kakaoQr.codeFor', { name: card.name })} />
      <div className="mt-2 w-full truncate text-center text-sm font-semibold text-text">{card.name}</div>
      {/* 아이디 칸에 아이디가 아닌 것이 적혀 있으면 그렇다고 말한다 — 아이디로 검색해도
          나오지 않을 값이라, 조용히 아이디처럼 보여주면 헛수고를 시킨다. */}
      {card.kakao.kind !== 'none' && <CopyableId card={card} />}
    </li>
  )
}

// QR은 언제나 흰 바탕에 검은 칸이다 — 어두운 테마를 따라 색을 뒤집으면 못 읽는 리더가 많다.
function Qr({ payload, label }: { payload: string; label: string }) {
  const [modules, setModules] = useState<QrModules | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadQrEncoder()
      .then((encode) => alive && setModules(encode(payload)))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [payload])

  if (failed) return <div className="grid aspect-square w-full place-items-center rounded-xl bg-fill text-xs text-subtle">—</div>
  if (!modules) return <div className="fx-skeleton aspect-square w-full rounded-xl" />

  const n = modules.length
  // 여백(quiet zone) 4칸은 QR 규격이 요구하는 값이다 — 없으면 리더가 코드의 끝을 못 찾는다.
  const q = 4
  return (
    <svg
      viewBox={`${-q} ${-q} ${n + q * 2} ${n + q * 2}`}
      className="aspect-square w-full rounded-xl bg-white"
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={modulesToPath(modules)} fill="#000" />
    </svg>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Switch } from '../../../components/ui/Switch'
import { Tag } from '../../../components/ui/Tag'
import { ScanLine, Camera, ImagePlus, CheckCircle2, Share2 } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import {
  extractCard,
  kioskNewMember,
  getCardScanUsage,
  extractCardViaShare,
  shareNewMember,
  getShareCardScanUsage,
  type NewMemberFields,
} from '../../../lib/api'
import { easternNow } from '../../../lib/checkinWindow'
import { NewFamilyCardForm } from './NewFamilyCardForm'
import { AdultCardForm } from './AdultCardForm'
import { blankAdultCard, type AdultCardValue } from './adultCard'
import { adultPayload } from './adultRegistration'
import { groupsOfPartition, type Partition } from '../../../lib/partition'
import { useAdminAuth } from '../../../stores/useAdminAuth'
import { blankCardForm, groupForAffiliation, joinAffiliation, type CardFormValue } from './newFamilyCard'
import { UNNAMED_CARD_NAME, cardMemberName } from './cardRegistration'
import { usePartition } from '../../../lib/useAppConfig'
import { normalizeScannedCards, type ScannedCard } from './cardExtraction'
import { fileToCardImage } from './cardPhoto'
import { refreshRoster, broadcastAttendanceChange } from '../../../lib/live'

// 카드 사진으로 등록: photograph/upload the paper 새가족 등록 카드; the edge function
// has a vision model read the handwriting/checkboxes, and the result pre-fills the
// editable card replica for review — nothing is saved until the admin checks it and
// taps 등록. Registration goes through the same endpoint as the kiosk 새가족 등록, with
// an optional "오늘 출석 체크" (unchecked → skipCheckin, e.g. entering a stack of cards
// later in the week).
// **빈 칸은 등록을 막지 않는다** (두 부 모두): 종이는 사람이 손으로 채우는 것이라 이름이 안
// 읽히거나 소속 네모가 안 찍힌 카드가 늘 있고, 그때 등록을 거절하면 그 사람은 어디에도 남지
// 않는다 — 빈 칸은 나중에 멤버 탭에서 채운다. 우리가 대신 채운 칸(이름 자리표·기본 부서)은
// 등록 버튼 위에 적어 준다. 규칙은 cardRegistration.ts.
// Two dimensions of batching, both walked one card at a time (extract → review →
// 등록/건너뛰기 → next): several photos can be picked at once, and a single photo can
// hold several cards (a stack laid out on the table) — every card in it is recognized
// and reviewed. A photo that fails to extract is toasted with its position and the
// batch moves on.
// `initialFiles` skips the picker entirely: the /share screen passes the photos the OS
// handed over through the phone's share sheet, so a shared card goes straight to 인식.
// `publicMode` is the share link's other half: share.html carries no login, so it talks
// to the unauthenticated /api/share/* endpoints and can't touch the admin-only roster
// query afterwards.
type Phase = 'pick' | 'extracting' | 'review'

export function CardScanDialog({
  open,
  onClose,
  initialFiles,
  publicMode = false,
  forcePartition,
}: {
  open: boolean
  onClose: () => void
  initialFiles?: File[]
  publicMode?: boolean
  // 장년부 링크: 로그인이 없으므로 화면이 어느 부의 것인지 직접 들고 온다.
  forcePartition?: Partition
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  // 어느 부에 등록할지 — 카드에서 읽은 소속으로 부서를 정하는 건 대학·청년부 쪽 규칙이고,
  // 장년부에서는 언제나 장년부다. 공개 카드 링크(publicMode)는 로그인이 없으니 대학·청년부.
  const signedInPartition = usePartition()
  const partition = forcePartition ?? signedInPartition
  // 장년부에서 들어온 사진은 장년부 카드만 읽는다 (서버도 같은 판단을 한다).
  const onlyAdult = partition === 'adult' ? ('adult' as const) : undefined
  // Refetch on open, every two seconds while the dialog is visible, and after each API
  // request below. This is the same server-side counter that enforces the daily limit.
  // Separate cache keys so a signed-in admin who also opens the share link doesn't have
  // one view's counter overwritten by the other's.
  const usageKey = publicMode ? ['cardScanUsage', 'share'] : ['cardScanUsage']
  const { data: usage } = useQuery({
    queryKey: usageKey,
    queryFn: publicMode ? getShareCardScanUsage : getCardScanUsage,
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: open ? 2_000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  const fileRef = useRef<HTMLInputElement>(null)
  // Photos handed over by the share sheet arrive already picked, so the dialog opens
  // *in* the batch rather than at the picker — seeded here instead of assigned from an
  // effect, which would render the pick step for a frame and then replace it.
  const [phase, setPhase] = useState<Phase>(() => (initialFiles?.length ? 'extracting' : 'pick'))
  const [queue, setQueue] = useState<File[]>(() => initialFiles ?? [])
  const [index, setIndex] = useState(0)
  // Every card recognized in photo `index`, and which of them is being reviewed.
  // 사진 한 장에 두 종이가 섞여 있을 수 있다 — 각 카드가 자기 종류를 들고 다닌다.
  const [cards, setCards] = useState<ScannedCard[]>(() => [{ kind: 'youth', youth: blankCardForm(easternNow().date) }])
  const [cardIndex, setCardIndex] = useState(0)
  const [model, setModel] = useState('')
  const [checkinToday, setCheckinToday] = useState(true)
  const [busy, setBusy] = useState(false)

  const scanned: ScannedCard = cards[cardIndex] ?? { kind: 'youth', youth: blankCardForm(easternNow().date) }
  const isAdultCard = scanned.kind === 'adult'
  const card = scanned.kind === 'youth' ? scanned.youth : blankCardForm(easternNow().date)
  const adultCard = scanned.kind === 'adult' ? scanned.adult : blankAdultCard(easternNow().date)
  const patchCard = (patch: Partial<CardFormValue>) =>
    setCards((cur) => cur.map((c, i) => (i === cardIndex && c.kind === 'youth' ? { kind: 'youth', youth: { ...c.youth, ...patch } } : c)))
  const patchAdultCard = (patch: Partial<AdultCardValue>) =>
    setCards((cur) => cur.map((c, i) => (i === cardIndex && c.kind === 'adult' ? { kind: 'adult', adult: { ...c.adult, ...patch } } : c)))

  // "사진 2 / 5" position tag — only meaningful for a multi-photo batch.
  const photoTag = (list: File[], i: number) =>
    list.length > 1 ? t('admin.newfamily.scan.photoProgress', { n: i + 1, total: list.length }) : ''

  // Back to a fresh pick — also clears the input's value so re-picking the same
  // file (after a failure or 다시 선택) re-fires onChange.
  function reset() {
    setPhase('pick')
    setQueue([])
    setIndex(0)
    setCards([{ kind: 'youth', youth: blankCardForm(easternNow().date) }])
    setCardIndex(0)
    setModel('')
    setCheckinToday(true)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function close() {
    reset()
    onClose()
  }

  function pickFiles(files: FileList | null) {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setQueue(list)
    void processFile(list, 0)
  }

  // Kick off the extraction those seeded photos are already showing a spinner for. The
  // ref makes it fire exactly once per mount: extraction costs a metered vision-model
  // call, and StrictMode runs effects twice in development.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!open || autoStarted.current) return
    if (!initialFiles || initialFiles.length === 0) return
    autoStarted.current = true
    void processFile(initialFiles, 0)
    // processFile is recreated every render but is stable in behavior; the ref above is
    // what actually guards against a second run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles])

  // Extract photo i of the batch — which may contain more than one card. A photo that
  // can't be read (undecodable file, quota, illegible) is toasted with its position and
  // the batch moves on, so one bad photo doesn't sink the whole stack.
  async function processFile(list: File[], i: number) {
    setIndex(i)
    setPhase('extracting')
    setCardIndex(0)
    const tag = photoTag(list, i)
    const prefix = tag ? `${tag} — ` : ''
    let image: { base64: string; mediaType: string }
    try {
      image = await fileToCardImage(list[i])
    } catch {
      // Undecodable file (e.g. HEIC without browser support) — distinct message so
      // the fix ("use a JPG/screenshot") is obvious.
      toast({ title: prefix + t('admin.newfamily.scan.badImage'), tone: 'err' })
      nextPhoto(list, i)
      return
    }
    try {
      const res = await (publicMode ? extractCardViaShare : extractCard)(image.base64, image.mediaType)
      // Older deployed function versions answer with a single `card`; both shapes
      // normalize to a list, so one photo of several cards yields several forms.
      const found = normalizeScannedCards(res.cards ?? res.card, easternNow().date, onlyAdult)
      setCards(found)
      setCardIndex(0)
      setModel(res.model || '')
      setPhase('review')
      if (found.length > 1) toast({ title: t('admin.newfamily.scan.foundCards', { n: found.length }), tone: 'ok' })
      // The server returns the post-call allowance so this dialog updates immediately.
      qc.setQueryData(usageKey, res.usage)
    } catch (e) {
      // Surface the server's reason (missing secret, quota, unreadable card) —
      // these are actionable, unlike a generic failure.
      toast({ title: prefix + ((e as Error)?.message || t('admin.newfamily.scan.failed')), tone: 'err' })
      nextPhoto(list, i)
    } finally {
      // Failed provider calls also consume a try. Refetch after every attempted request
      // so other open admin tabs and this batch converge on the audited count quickly.
      void qc.invalidateQueries({ queryKey: usageKey })
    }
  }

  // Move past photo i: extract the next photo, or fall back to the picker after the
  // last one (for a single photo that is exactly 다시 선택).
  function nextPhoto(list: File[], i: number) {
    if (i + 1 < list.length) void processFile(list, i + 1)
    else reset()
  }

  // Is there another card to review after this one — in this photo or a later one?
  const hasMore = cardIndex + 1 < cards.length || index + 1 < queue.length

  // Move past the current card without registering it: the next card read out of this
  // photo first, then the next photo.
  function advance() {
    if (cardIndex + 1 < cards.length) setCardIndex(cardIndex + 1)
    else nextPhoto(queue, index)
  }

  // 인식한 카드는 빈 칸이 있어도 등록된다 (cardRegistration.ts) — 종이의 빈 칸 때문에
  // 사람이 명단에 없는 것보다, 우리가 채운 칸을 적어 두고 등록하는 편이 낫다. 무엇을
  // 대신 채웠는지는 등록 버튼 위에 그대로 보여준다.
  const autoName = !(isAdultCard ? adultCard.name : card.name).trim()
  // 소속이 곧 부서인데(대학생 → 대학부, 나머지 → 청년부) 아무 네모도 안 찍힌 카드가 있다.
  // 그때 넣을 부서: **적는 사람이 한 부서에 묶여 있으면 그 부서**다 (리더). 서버는 자기
  // 부서 밖으로의 등록을 막으므로(inScopeGroup), 여기서 늘 청년부로 떨어뜨리면 대학부
  // 리더가 소속 없는 카드를 등록할 때 403이 나고 — 빈 칸 때문에 등록이 막히는 일이 그대로
  // 남는다. super_admin·공유 링크는 부서가 비어 있으므로 예전 규칙(청년부)으로 간다.
  const scopedGroup = useAdminAuth((s) => s.identity?.group ?? '')
  const fallbackGroup = groupsOfPartition(partition).includes(scopedGroup)
    ? scopedGroup
    : groupForAffiliation('', partition)
  // 장년부 카드에는 소속을 묻는 칸이 없다 — 고를 부서가 하나뿐이므로.
  const guessedGroup = !isAdultCard && !card.affiliationCategory.trim() ? fallbackGroup : ''

  async function submit() {
    setBusy(true)
    try {
      // 이름 칸이 비어 있어도 멈추지 않는다 — 자리표를 만들어 등록한다.
      const name = cardMemberName(isAdultCard ? adultCard.name : card.name)
      const payload: NewMemberFields = isAdultCard ? {
        ...adultPayload(adultCard),
        name,
        skipCheckin: !checkinToday,
        // 로그인 없이 도는 링크는 서버가 신원에서 부를 알아낼 수 없으므로 직접 말해 준다.
        ...(publicMode ? { partition: 'adult' as const } : {}),
      } : {
        name,
        // Same mapping as the kiosk 새가족 등록: 부서 from 소속, 동산 assigned later.
        // 소속이 비었으면 위에서 정한 기본 부서 — 등록을 멈추지 않는다.
        group: card.affiliationCategory.trim()
          ? groupForAffiliation(card.affiliationCategory, partition)
          : fallbackGroup,
        subgroup: '',
        gender: card.gender,
        phone: card.phone.trim(),
        kakaoId: card.kakaoId.trim(),
        birthDate: card.birthDate || null,
        baptismStatus: card.baptismStatus,
        schoolOrWork: joinAffiliation(card.affiliationCategory, card.affiliationDetail),
        faithDuration: card.faithDuration.trim(),
        registrationDate: card.registrationDate || null,
        pastoralVisitRequested: card.pastoralVisitRequested,
        skipCheckin: !checkinToday,
      }
      await (publicMode ? shareNewMember : kioskNewMember)(payload)
      // The share link has no roster to refetch (that query is admin-only), but the ping
      // still goes out so any admin panel or kiosk that is open picks the new 새가족 up
      // immediately — same as a registration made from inside the panel.
      if (publicMode) broadcastAttendanceChange()
      else refreshRoster(qc)
      toast({ title: t('admin.newfamily.scan.done', { name: payload.name }), tone: 'ok' })
      if (hasMore) {
        // More cards in the stack — keep the dialog (and the 오늘 출석 체크 choice)
        // and roll straight into the next card, extracting the next photo if this
        // one is used up.
        setBusy(false)
        advance()
      } else {
        close()
      }
    } catch (e) {
      toast({ title: (e as Error)?.message || t('common.error'), tone: 'err' })
      setBusy(false)
    }
  }

  // Two independent positions: which photo of the batch, and which card of that photo.
  // Each tag is shown only when it says something (a 1-of-1 count is noise).
  const photoProgress = photoTag(queue, index)
  const cardProgress =
    cards.length > 1 ? t('admin.newfamily.scan.progress', { n: cardIndex + 1, total: cards.length }) : ''

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('admin.newfamily.scan.title')} wide xwide={isAdultCard}>
      {usage && (
        <div className="mb-4">
          <Tag tone="muted" className="tabular-nums">
            <ScanLine size={13} strokeWidth={2} aria-hidden />
            <span>
              {t('admin.settings.cardScanUsageDetail', {
                available: usage.remaining,
              })}
            </span>
          </Tag>
        </div>
      )}
      {phase === 'pick' && (
        <div className="fx-fade flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-surface-2 px-5 py-9 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
            <Camera size={26} strokeWidth={1.75} aria-hidden />
          </span>
          <p className="max-w-sm text-sm text-muted">{t('admin.newfamily.scan.hint')}</p>
          {/* accept="image/*" without `capture` so mobile offers both camera and photo
              library; desktop gets the regular file picker. `multiple` lets a whole
              stack of cards be selected in one go. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            aria-label={t('admin.newfamily.scan.pick')}
            onChange={(e) => pickFiles(e.target.files)}
            className="max-w-full text-xs text-muted file:mr-3 file:inline-flex file:min-h-11 file:cursor-pointer file:items-center file:rounded-full file:border-0 file:bg-primary file:px-5 file:text-sm file:font-semibold file:text-primary-fg file:shadow-[var(--shadow-sm)] hover:file:bg-primary-hover"
          />
          {/* The share-sheet route (manifest share_target → /share) is invisible unless
              someone is told about it, and this is where they're already thinking about
              card photos. */}
          <p className="flex max-w-sm items-start gap-2 rounded-xl bg-fill px-3 py-2 text-left text-[11px] leading-5 text-subtle">
            <Share2 size={13} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
            {t('admin.newfamily.scan.shareHint')}
          </p>
        </div>
      )}

      {phase === 'extracting' && (
        <div className="fx-fade flex flex-col items-center gap-4 py-12 text-center">
          {photoProgress && <Tag tone="primary" className="tabular-nums">{photoProgress}</Tag>}
          <span className="fx-pulse grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
            <ScanLine size={26} strokeWidth={1.75} aria-hidden />
          </span>
          <p className="text-sm text-muted">{t('admin.newfamily.scan.extracting')}</p>
        </div>
      )}

      {phase === 'review' && (
        <>
          <div className="mb-3 flex items-start gap-2.5">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-success/12 text-success">
              <ImagePlus size={16} strokeWidth={2} aria-hidden />
            </span>
            <p className="text-sm text-muted">
              {photoProgress && <Tag tone="primary" className="mr-2 align-middle tabular-nums">{photoProgress}</Tag>}
              {cardProgress && <Tag tone="primary" className="mr-2 align-middle tabular-nums">{cardProgress}</Tag>}
              {model && <Tag tone="muted" className="mr-2 align-middle">{model}</Tag>}
              {t('admin.newfamily.scan.reviewHint')}
            </p>
          </div>
          {/* On a phone the dialog is itself a scrolling sheet, so a second scroll area
              inside it just makes the card replica a cramped window; let it run full
              height there and cap it only on the centered desktop modal. */}
          <div className="flex flex-col gap-4 sm:max-h-[60vh] sm:overflow-y-auto sm:pr-1">
            {isAdultCard ? (
              <AdultCardForm value={adultCard} onChange={patchAdultCard} />
            ) : (
              <NewFamilyCardForm value={card} onChange={patchCard} />
            )}
          </div>
          {/* 빈 칸 때문에 등록이 막히지는 않지만, 우리가 대신 채운 값은 등록을 누르기 전에
              읽을 수 있어야 한다 — 조용히 지어낸 이름·부서는 나중에 아무도 못 찾는다. */}
          {(autoName || guessedGroup) && (
            <ul className="mt-4 flex flex-col gap-1 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-5 text-warning">
              {autoName && <li>{t('admin.newfamily.scan.autoName', { name: UNNAMED_CARD_NAME })}</li>}
              {guessedGroup && <li>{t('admin.newfamily.scan.autoGroup', { group: guessedGroup })}</li>}
            </ul>
          )}
          <div className="mt-4 inset-list">
            <label className="inset-row min-h-12 cursor-pointer justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-text">
                <CheckCircle2 size={17} strokeWidth={2} className="text-success" aria-hidden />
                {t('admin.newfamily.scan.checkinToday')}
              </span>
              <Switch
                checked={checkinToday}
                onChange={setCheckinToday}
                disabled={busy}
                label={t('admin.newfamily.scan.checkinToday')}
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" onClick={advance} disabled={busy}>
              {queue.length > 1 || cards.length > 1
                ? t('admin.newfamily.scan.skip')
                : t('admin.newfamily.scan.retake')}
            </Button>
            <Button onClick={() => void submit()} disabled={busy} className="flex-1">
              {busy ? t('common.loading') : t('admin.newfamily.scan.submit')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Sparkles } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { kioskNewMember, type NewMemberFields } from '../../../lib/api'
import { easternNow } from '../../../lib/checkinWindow'
import { NewFamilyCardForm } from '../admin/NewFamilyCardForm'
import { AdultCardForm } from '../admin/AdultCardForm'
import { blankAdultCard, type AdultCardValue } from '../admin/adultCard'
import { adultPayload } from '../admin/adultRegistration'
import { blankCardForm, groupForAffiliation, joinAffiliation, type CardFormValue } from '../admin/newFamilyCard'
import { usePartition } from '../../../lib/useAppConfig'
import { refreshRoster } from '../../../lib/live'

// 새가족 (new-family) registration from the kiosk: a blank paper 새가족 등록 카드 to
// fill in directly — type into the card's cells, tap its checkboxes. 등록일 is stamped
// to the day the person is added (the server stamps the same date authoritatively).
// There are no 부서/동산 controls: 부서 is derived from the card's 소속 category
// (대학생 → 대학부, else → 청년부) and 동산 is assigned later in the Members tab.
// Creates the member/device and checks them in for today.
export function KioskNewMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const partition = usePartition()
  // Fresh blank card per open, 등록일 = today (Eastern) — computed per open so the
  // kiosk doesn't stamp a stale date if it stays up across midnight.
  const [card, setCard] = useState<CardFormValue>(() => blankCardForm(easternNow().date))
  // 장년부는 종이가 다르다 — 키오스크에서도 그 부의 카드를 그대로 내민다.
  const isAdult = partition === 'adult'
  const [adultCard, setAdultCard] = useState<AdultCardValue>(() => blankAdultCard(easternNow().date))
  const [busy, setBusy] = useState(false)

  const patchCard = (patch: Partial<CardFormValue>) => setCard((cur) => ({ ...cur, ...patch }))
  const patchAdultCard = (patch: Partial<AdultCardValue>) => setAdultCard((cur) => ({ ...cur, ...patch }))

  function close() {
    setCard(blankCardForm(easternNow().date))
    setAdultCard(blankAdultCard(easternNow().date))
    setBusy(false)
    onClose()
  }

  async function submit() {
    const name = (isAdult ? adultCard.name : card.name).trim()
    if (!name) {
      toast({ title: t('kiosk.newMember.nameRequired'), tone: 'warn' })
      return
    }
    // 소속 decides the 부서 now, so an unticked card can't be filed anywhere.
    // 장년부에는 고를 부서가 하나뿐이라 그 물음 자체가 없다.
    if (!isAdult && !card.affiliationCategory) {
      toast({ title: t('kiosk.newMember.affiliationRequired'), tone: 'warn' })
      return
    }
    setBusy(true)
    try {
      const payload: NewMemberFields = isAdult ? adultPayload(adultCard) : {
        name: card.name.trim(),
        // 부서 from the 소속 checkbox: 대학생 → 대학부, 대학원생/직장인/Other → 청년부.
        group: groupForAffiliation(card.affiliationCategory, partition),
        // 동산 is assigned by an admin in the Members tab, never at the kiosk.
        subgroup: '',
        gender: card.gender,
        phone: card.phone.trim(),
        kakaoId: card.kakaoId.trim(),
        birthDate: card.birthDate || null,
        baptismStatus: card.baptismStatus,
        // 소속 stored as "category · detail" inside school_or_work (no DB column for
        // the category — the 등록 카드 export splits it back out).
        schoolOrWork: joinAffiliation(card.affiliationCategory, card.affiliationDetail),
        faithDuration: card.faithDuration.trim(),
        // 등록일 = the day they were added (shown stamped on the card; the kiosk
        // endpoint stamps the same date server-side regardless).
        registrationDate: card.registrationDate || null,
        pastoralVisitRequested: card.pastoralVisitRequested,
      }
      await kioskNewMember(payload)
      refreshRoster(qc)
      toast({ title: t('kiosk.newMember.done', { name: payload.name }), tone: 'ok' })
      close()
    } catch (e) {
      // Surface the real reason (auth/network/server message) instead of a generic error,
      // so a failing kiosk is diagnosable rather than silently "not working".
      toast({ title: (e as Error)?.message || t('common.error'), tone: 'err' })
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={t('kiosk.newMember.title')} wide xwide={isAdult}>
      {/* max-h is a safety valve for short/small screens; on the kiosk tablet the whole
          card fits without scrolling. */}
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        {isAdult ? (
          <AdultCardForm value={adultCard} onChange={patchAdultCard} />
        ) : (
          <NewFamilyCardForm value={card} onChange={patchCard} regDateFixed />
        )}
      </div>
      <Button onClick={() => void submit()} disabled={busy} className="mt-5 w-full">
        <Sparkles className="size-4" strokeWidth={2} aria-hidden />
        {busy ? t('common.loading') : t('kiosk.newMember.submit')}
      </Button>
    </Dialog>
  )
}

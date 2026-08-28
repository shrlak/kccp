// 설교 — 목사님 PPTX를 그대로 삽입한다.
//
// "그대로"가 요점이다. 다시 그리지 않고 병합만 하므로 목사님이 만든 애니메이션·글꼴·배경이
// 살아 있다. 여기서 슬라이드를 재구성하기 시작하면 매주 "제 파일과 다른데요"가 된다.
import { useState } from 'react'
import { inspectDeckBytes } from '../lib/pptx/deckInspect'
import type { Wizard } from '../useWizard'
import { Card, FilePicker, Notice } from '../ui'
import { Button } from '../ui'

export function SermonStep({ wizard }: { wizard: Wizard }) {
  const { state, patch } = wizard
  const [slides, setSlides] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function take(file: File) {
    setError(null)
    try {
      const data = await file.arrayBuffer()
      // 병합 전에 열어 본다. 여기서 걸리면 사람이 파일을 다시 받아 올 수 있고, 안 걸리면
      // 조립이 끝난 뒤 완성본에서 터진다.
      const { slideCount } = await inspectDeckBytes(data)
      patch({ sermonDeck: { name: file.name, data } })
      setSlides(slideCount)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card title="설교 슬라이드" hint="목사님이 보내 주신 .pptx 를 그대로 넣습니다. 다시 그리지 않습니다.">
      <div className="flex flex-wrap items-center gap-3">
        <FilePicker
          label={state.sermonDeck ? '다른 파일로 바꾸기' : 'PPTX 고르기'}
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onFiles={([file]) => void take(file)}
        />
        {state.sermonDeck && (
          <Button variant="danger" onClick={() => { patch({ sermonDeck: undefined }); setSlides(null) }}>
            빼기
          </Button>
        )}
      </div>

      {state.sermonDeck && (
        <p className="mt-3 text-[15px]">
          {state.sermonDeck.name}
          {slides !== null && <span className="ml-2 font-mono text-xs text-subtle">{slides}장</span>}
        </p>
      )}
      {!state.sermonDeck && <Notice>설교 슬라이드가 없으면 이 구간은 통째로 빠집니다.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  )
}

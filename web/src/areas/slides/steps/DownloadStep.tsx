// 다운로드 — 최종 조립.
//
// 여기가 이관의 검증 지점이다. 이번 주 콘티로 만든 파일을 지금 ppt 앱이 만든 것과 열어서
// 비교한다. 두 곳에서 같은 주를 만들어 보는 그 기간이 이 이관의 안전장치이고, 그래서
// 07(정리)은 미디어팀이 두 주 연속 KCCP만으로 만든 다음에야 온다.
import { useState } from 'react'
import { browserSlideAssets, buildDeck, hasAnyContent, type BuiltDeck } from '../lib/buildDeck'
import { uploadDeck } from '../lib/setlists'
import type { Wizard } from '../useWizard'
import { Button, Card, Field, Notice, TextInput } from '../ui'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export function DownloadStep({ wizard }: { wizard: Wizard }) {
  const { state, suggestedFileName } = wizard
  const [fileName, setFileName] = useState(suggestedFileName)
  const [built, setBuilt] = useState<BuiltDeck | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const ready = hasAnyContent(state)

  async function build() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      setBuilt(await buildDeck(state, browserSlideAssets(import.meta.env.BASE_URL || '/')))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBuilt(null)
    } finally {
      setBusy(false)
    }
  }

  function download(deck: BuiltDeck) {
    const name = fileName.endsWith('.pptx') ? fileName : `${fileName}.pptx`
    const blob = new Blob([deck.merged.buffer as ArrayBuffer], { type: PPTX_MIME })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function saveToWeek(deck: BuiltDeck) {
    if (!state.setlistId) return
    setBusy(true)
    setError(null)
    try {
      const name = fileName.endsWith('.pptx') ? fileName : `${fileName}.pptx`
      await uploadDeck(state.setlistId, new File([deck.merged.buffer as ArrayBuffer], name, { type: PPTX_MIME }))
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="파일 이름">
        <Field label="이름" hint="콘티 날짜에서 따왔습니다. 바꿔도 됩니다.">
          <TextInput value={fileName} onChange={(e) => setFileName(e.target.value)} />
        </Field>
      </Card>

      <Card title="조립">
        {!ready && (
          <Notice>
            찬양·성경 말씀·설교·광고·추가 자료 중 최소 하나는 있어야 합니다. 지금 만들면 뼈대만 있는
            덱이 나옵니다.
          </Notice>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy || !ready} onClick={() => void build()}>
            {busy ? '만드는 중…' : built ? '다시 만들기' : '슬라이드 만들기'}
          </Button>
          {built && <Button onClick={() => download(built)}>내려받기</Button>}
          {built && state.setlistId && (
            <Button onClick={() => void saveToWeek(built)} disabled={busy}>
              {saved ? '그 주에 저장됨' : '그 주에 저장'}
            </Button>
          )}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </Card>

      {built && (
        <Card title={`구성 — ${built.overview.length}장`} hint="병합된 순서 그대로입니다. 추정이 아니라 센 값입니다.">
          <ol className="flex flex-col gap-1">
            {built.overview.map((item, i) => (
              <li key={item.id} className="flex items-baseline gap-2 text-[13px]">
                <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-subtle">{i + 1}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.subtitle && <span className="max-w-[45%] truncate text-xs text-subtle">{item.subtitle}</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}

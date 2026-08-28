// 추가 자료 — PDF · PPTX · 이미지, 그리고 순서.
//
// 예배가 끝난 뒤에 붙는 자료들이라 **순서가 곧 내용**이다. 올린 차례대로 나가고, 여기서
// 바꾼 순서가 그대로 슬라이드 순서가 된다.
import { useState } from 'react'
import { inspectAdditionalUpload } from '../lib/additionalFiles/convert'
import { SUPPORTED_ADDITIONAL_ACCEPT } from '../lib/additionalFiles/types'
import type { Wizard } from '../useWizard'
import { Button, Card, FilePicker, Notice } from '../ui'

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', pptx: 'PPTX', png: '이미지', jpeg: '이미지' }

export function ExtraStep({ wizard }: { wizard: Wizard }) {
  const { state, files } = wizard
  const [error, setError] = useState<string | null>(null)

  async function take(picked: File[]) {
    setError(null)
    for (const file of picked) {
      try {
        // 여기서 장 수까지 센다 — 조립 전에 "몇 장이 붙는가"를 사람이 알 수 있어야 한다.
        files.add(await inspectAdditionalUpload(file))
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return (
    <Card title="추가 자료" hint="예배 마지막 뒤에 올린 순서대로 붙습니다.">
      <FilePicker label="파일 고르기" accept={SUPPORTED_ADDITIONAL_ACCEPT} multiple onFiles={(f) => void take(f)} />

      {state.additionalFiles.length === 0 ? (
        <Notice>추가 자료가 없으면 이 구간은 통째로 빠집니다.</Notice>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {state.additionalFiles.map((file, i) => (
            <li key={file.id} className="flex items-center gap-2 rounded-md bg-surface-alt p-2.5">
              <span className="w-6 shrink-0 text-center font-mono text-xs text-subtle">{i + 1}</span>
              <span className="flex-1 truncate text-[15px]">{file.name}</span>
              <span className="shrink-0 font-mono text-xs text-subtle">
                {KIND_LABEL[file.kind] ?? file.kind} · {file.slideCount}장
              </span>
              <Button
                aria-label="위로"
                disabled={i === 0}
                onClick={() => files.move(file.id, -1)}
                className="px-2 py-1"
              >
                ↑
              </Button>
              <Button
                aria-label="아래로"
                disabled={i === state.additionalFiles.length - 1}
                onClick={() => files.move(file.id, 1)}
                className="px-2 py-1"
              >
                ↓
              </Button>
              <Button variant="danger" onClick={() => files.remove(file.id)} className="px-2 py-1">
                빼기
              </Button>
            </li>
          ))}
        </ol>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  )
}

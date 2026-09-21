// 찬양팀 인도자 전용 화면.
//
// ── 무엇을 묻지 않는가 ───────────────────────────────────────────────────────────────
// 이 화면의 값은 **물음이 거의 없다**는 데 있다. 팀은 자격이 안다(`team_leaders`), 부(部)는
// 팀이 정하고, 예배는 팀이 서는 예배이며, 날짜는 다음 주일이고, 곡·본문·설교 제목은 콘티
// 표지에 적혀 있다. 남는 물음은 하나뿐이다 — 이끄는 예배가 둘인 팀(헵시바)에게 「어느
// 예배인가」. 그것마저 서버가 답할 수 있으면 답해 둔다 (`defaultService`).
//
// 미디어팀의 마법사가 여섯 단계인 이유는 **고칠 수 있어야** 하기 때문이다 (설교 PPT,
// 광고, 번역본). 인도자에게는 그 물음이 하나도 해당하지 않는다. 그래서 여기는 한 화면이다.
//
// ── 만들어진 덱은 어디로 가는가 ──────────────────────────────────────────────────────
// 두 곳이다. 인도자가 **내려받고**, 같은 파일이 그 주의 콘티 옆 Storage 에 **저장된다** —
// 미디어팀이 마법사의 「고르기」에서 그것을 연다. 저장이 실패해도 내려받기는 남는다:
// 카톡으로 보내는 길이 아직 살아 있어야 한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { setAiArea } from '../slides/lib/ai/proxy'
import { loadConti } from '../slides/lib/utils/contiPdf'
import { Button, Card, Field, Notice, Select } from '../slides/ui'
import { AreaHeader } from '../AreaHeader'
import { autoBuildDeck, type AutoBuildResult, type AutoStatus } from './lib/autoBuild'
import {
  getLeaderContext,
  getMySetlists,
  uploadConti,
  uploadDeck,
  type LeaderContext,
  type PraiseSetlist,
} from './lib/conti'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export function PraiseLeaderShell() {
  const [ctx, setCtx] = useState<LeaderContext | null>(null)
  const [setlists, setSetlists] = useState<PraiseSetlist[]>([])
  const [serviceId, setServiceId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [status, setStatus] = useState<AutoStatus | null>(null)
  const [result, setResult] = useState<AutoBuildResult | null>(null)
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // **이 화면의 AI 요청은 /api/praise/ 로 나간다.** 인도자의 자격에는 'slides' 영역이
  // 없어서, 접두사를 바꾸지 않으면 가사 읽기가 통째로 401을 받는다.
  useEffect(() => {
    setAiArea('praise')
    return () => setAiArea('slides')
  }, [])

  // 팀을 고르면 **그 팀이 서는 예배**를 다시 받아 온다. 고르기만 하고 예배 목록이 비어
  // 있으면 이 화면은 팀을 물어 놓고 아무것도 못 하는 화면이 된다. 팀이 자격에 적힌
  // 인도자에게는 teamId 가 빈 문자열이라 이 효과가 처음 한 번만 돈다.
  useEffect(() => {
    let alive = true
    void Promise.all([getLeaderContext(teamId || undefined), getMySetlists()])
      .then(([context, mine]) => {
        if (!alive) return
        setCtx(context)
        setSetlists(mine.setlists)
        // 이끄는 예배가 하나뿐이면 묻지 않는다. 둘이면 서버가 고르지 못하므로 비워 두고
        // 화면이 묻는다 — 임의로 고르면 1부 콘티가 2부에 앉고, 그 잘못은 올린 사람
        // 눈에 보이지 않는다.
        setServiceId(context.defaultServiceId ?? (context.services.length === 1 ? context.services[0].id : ''))
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [teamId])

  const run = useCallback(
    async (file: File) => {
      if (!ctx) return
      setError(null)
      setSaveError(null)
      setSavedAs(null)
      setResult(null)
      setStatus({ phase: 'read', progress: 0.02, message: '콘티를 올리는 중…' })

      let doc: Awaited<ReturnType<typeof loadConti>> | null = null
      try {
        // 올리는 것이 먼저다. 조립이 도중에 실패하더라도 **콘티는 이미 저장되어 있어야**
        // 미디어팀이 그 주에 손으로 이어받을 수 있다 — 자동이 실패하면 예전 방식으로
        // 돌아가는 길이 열려 있어야 한다.
        const bytes = await file.arrayBuffer()
        const upload = await uploadConti({ serviceId, ...(teamId ? { teamId } : {}) }, file)
        setSetlists((await getMySetlists()).setlists)

        doc = await loadConti(bytes)
        const built = await autoBuildDeck(doc, { onStatus: setStatus })
        setResult(built)

        // 그 주의 콘티 옆에 둔다. 실패해도 내려받기는 남으므로 여기서 던지지 않는다.
        const name = upload.deckFileName
        try {
          await uploadDeck(upload.setlistId, new File([built.deck.merged.buffer as ArrayBuffer], name, { type: PPTX_MIME }))
          setSavedAs(name)
        } catch (e) {
          setSaveError(e instanceof Error ? e.message : String(e))
        }
        setSetlists((await getMySetlists()).setlists)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStatus(null)
      } finally {
        doc?.destroy()
      }
    },
    [ctx, serviceId, teamId],
  )

  const service = ctx?.services.find((s) => s.id === serviceId)
  const ready = !!ctx && !!serviceId && (!!ctx.team || !!teamId) && !status
  const teamName = ctx?.team?.name ?? ctx?.teams.find((t) => t.id === teamId)?.name ?? ''

  return (
    <main className="safe-x min-h-dvh bg-canvas pb-24">
      <AreaHeader title="콘티 올리기" meta={teamName || undefined} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-5">

        {error && <Notice kind="error">{error}</Notice>}

        {ctx && !ctx.team && ctx.teams.length === 0 && (
          <Card title="팀">
            <Notice>
              이 계정에는 찬양팀이 없습니다. 관리자에게 팀 배정을 요청해 주세요.
            </Notice>
          </Card>
        )}

        {/* 팀이 없는 자격 — 소유자와 영역 비밀번호(kccp1980·kccpmedia·kccppraise)다.
            그때만 고르는 자리가 뜬다: 자격에 없는 팀을 화면이 지어내지 않고, 자격에
            있는 팀은 묻지 않는다. */}
        {ctx && !ctx.team && ctx.teams.length > 0 && (
          <Card title="팀" hint="이 계정에는 팀이 없어 고르셔야 합니다.">
            <Field label="찬양팀">
              <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">고르기…</option>
                {ctx.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>
        )}

        {ctx && ctx.services.length > 0 && (
          <Card
            title="이번 주"
            hint={`${ctx.serviceDate} 주일 예배입니다. 날짜는 서버가 정합니다.`}
          >
            {ctx.services.length === 1 ? (
              <p className="text-[15px]">
                {ctx.services[0].name}
                <span className="ml-2 font-mono text-xs text-subtle">{ctx.services[0].startsAt.slice(0, 5)}</span>
              </p>
            ) : (
              // 이끄는 예배가 둘인 팀(헵시바)에게만 뜨는 물음이다. 임의로 고르면 1부
              // 콘티가 2부에 앉는 주가 생기고, 그 잘못은 올린 사람 눈에 보이지 않는다.
              <Field label="예배" hint="콘티가 어느 예배의 것인지 골라 주세요.">
                <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                  <option value="">고르기…</option>
                  {ctx.services.map((sv) => (
                    <option key={sv.id} value={sv.id}>
                      {sv.name} · {sv.startsAt.slice(0, 5)}
                      {sv.leadsPpt ? ' (슬라이드)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {service && !service.leadsPpt && (
              <Notice>
                이 예배의 슬라이드는 다른 팀이 이끕니다. 콘티는 올라가지만 예배 슬라이드는
                그 팀의 콘티로 만들어집니다.
              </Notice>
            )}
          </Card>
        )}

        <Card
          title="콘티"
          hint="PDF 한 장을 올리면 곡·가사·본문·설교 제목을 읽어 예배 슬라이드까지 만듭니다."
        >
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void run(file)
            }}
          />
          <Button variant="primary" disabled={!ready} onClick={() => fileInput.current?.click()}>
            {status ? '만드는 중…' : '콘티 PDF 고르기'}
          </Button>
          {!ready && !status && ctx && ctx.services.length > 0 && (
            <Notice>위에서 예배를 먼저 골라 주세요.</Notice>
          )}

          {status && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="h-1 w-full overflow-hidden rounded-full bg-fill">
                <div
                  className="h-full bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.round(status.progress * 100)}%` }}
                />
              </div>
              <span className="font-mono text-xs text-subtle">{status.message}</span>
              <p className="text-xs leading-relaxed text-subtle">
                교회 계정의 AI 무료 한도를 씁니다. 읽어 낸 가사는{' '}
                <strong className="font-medium">초안</strong>이라, 주일 전에 한 번 훑어 주세요.
              </p>
            </div>
          )}
        </Card>

        {result && <Outcome result={result} savedAs={savedAs} saveError={saveError} />}

        {setlists.length > 0 && <History setlists={setlists} />}
      </div>
    </main>
  )
}

function Outcome({
  result,
  savedAs,
  saveError,
}: {
  result: AutoBuildResult
  savedAs: string | null
  saveError: string | null
}) {
  function download() {
    const name = savedAs ?? 'slides.pptx'
    const blob = new Blob([result.deck.merged.buffer as ArrayBuffer], { type: PPTX_MIME })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <Card title={`완성 — ${result.deck.overview.length}장`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={download}>
          내려받기
        </Button>
        {savedAs && <span className="text-[13px] text-muted">미디어팀에 {savedAs} 로 전달됐습니다.</span>}
      </div>

      {saveError && (
        <Notice kind="error">
          슬라이드는 만들어졌지만 저장에 실패했습니다 ({saveError}). 내려받아 전달해 주세요.
        </Notice>
      )}

      <dl className="mt-3 flex flex-col gap-1 text-[13px]">
        {result.sermonTitle && (
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-subtle">설교</dt>
            <dd className="flex-1">{result.sermonTitle}</dd>
          </div>
        )}
        {result.scripture && (
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-subtle">본문</dt>
            <dd className="flex-1">{result.scripture}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-subtle">곡</dt>
          <dd className="flex-1">
            {result.songs.map((s) => s.title || '제목 없음').join(' · ') || '없음'}
          </dd>
        </div>
      </dl>

      {result.recognitionError && (
        <Notice kind="error">
          가사를 읽지 못했습니다 ({result.recognitionError}). 슬라이드는 만들어졌지만 가사 칸이
          비어 있습니다 — 미디어팀에 알려 주세요.
        </Notice>
      )}

      {result.needsReview.length > 0 && (
        <Notice kind="error">
          확인이 필요한 곡: {result.needsReview.join(' · ')} — 가사가 비었거나 모델이 자신
          없어 한 곡입니다.
        </Notice>
      )}
    </Card>
  )
}

/** 지난 콘티들. **지워지지 않는다** — 지난 주 콘티를 다시 찾는 일은 실제로 생긴다. */
function History({ setlists }: { setlists: PraiseSetlist[] }) {
  return (
    <Card title="올린 콘티">
      <ul className="flex flex-col gap-2">
        {setlists.slice(0, 8).map((s) => (
          <li key={s.id} className="flex items-baseline gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
            <span className="font-mono text-xs tabular-nums text-subtle">{s.serviceDate}</span>
            <span className="flex-1 truncate text-[15px]">{s.serviceName}</span>
            <span className="text-xs text-subtle">{s.hasDeck ? '슬라이드 있음' : '콘티만'}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

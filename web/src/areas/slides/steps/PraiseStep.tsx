// 찬양 — 곡·파트·가사.
//
// 첫 단계가 「업로드」인 것은 임시다. services/setlists 표가 채워지면 여기가 「고르기」로
// 바뀐다 — 찬양팀이 올린 콘티를 미디어팀이 고르기만 하면 되고, 카톡으로 받은 PDF를 다시
// 올릴 일이 없어지는 것이 이 합치기의 원래 목적이었다. 두 길을 다 둔다: 목록에서 고르거나,
// 아직 안 올라왔으면 그 자리에서 올린다.
import { useEffect, useState } from 'react'
import { loadConti } from '../lib/utils/contiPdf'
import { contiUrl, getServices, getSetlists, uploadConti, type Service, type Setlist } from '../lib/setlists'
import type { Song } from '../lib/utils/types'
import { emptySong, type Wizard } from '../useWizard'
import { Button, Card, Field, FilePicker, Notice, TextArea, TextInput } from '../ui'

/** 콘티에서 읽은 것을 그 주의 내용으로 옮긴다. 가사는 아직 비어 있다 — 제목과 키만. */
function songsFromConti(titles: { title: string; key?: string }[]): Song[] {
  return titles.map((entry) => ({ ...emptySong(entry.title), key: entry.key }))
}

export function PraiseStep({ wizard }: { wizard: Wizard }) {
  const { state, patch, songs } = wizard
  const [services, setServices] = useState<Service[]>([])
  const [setlists, setSetlists] = useState<Setlist[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([getServices(), getSetlists()])
      .then(([s, l]) => {
        if (!alive) return
        setServices(s.services)
        setSetlists(l.setlists)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  async function readConti(bytes: ArrayBuffer, setlistId?: string) {
    setBusy('콘티를 읽는 중…')
    setError(null)
    try {
      const doc = await loadConti(bytes)
      const info = doc.parsed.info
      patch({
        setlistId,
        contiDate: info.date,
        songs: songsFromConti(info.songs),
        bible: {
          ...state.bible,
          // 콘티가 본문과 설교 제목을 들고 있으면 성경 단계를 미리 채운다. 사람이 다시
          // 옮겨 적는 자리가 곧 오타가 나는 자리다.
          verseInput: info.scripture ?? state.bible.verseInput,
          sermonTitle: info.sermonTitle ?? state.bible.sermonTitle,
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function pickSetlist(setlist: Setlist) {
    setBusy('콘티를 여는 중…')
    setError(null)
    try {
      // 서명 URL은 짧게 산다 — 열 때마다 새로 받는다.
      const { url } = await contiUrl(setlist.id)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`콘티를 내려받지 못했습니다 (HTTP ${res.status})`)
      await readConti(await res.arrayBuffer(), setlist.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  async function upload(file: File, target: { teamId: string; serviceId: string; serviceDate: string }) {
    setBusy('콘티를 올리는 중…')
    setError(null)
    try {
      const { setlistId } = await uploadConti(target, file)
      await readConti(await file.arrayBuffer(), setlistId)
      setSetlists((await getSetlists()).setlists)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const live = setlists.filter((s) => s.hasConti && !s.archivedAt)
  const leadTeam = services.flatMap((s) => s.teams.filter((t) => t.leadsPpt).map((t) => ({ service: s, team: t })))

  return (
    <div className="flex flex-col gap-4">
      <Card title="콘티" hint="찬양팀이 올린 콘티를 고르면 곡 제목·본문·설교 제목이 채워집니다.">
        {live.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {live.map((s) => (
              <li key={s.id} className="flex items-center gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                <span className="flex-1 text-[15px]">
                  {s.serviceName}
                  <span className="ml-2 font-mono text-xs text-subtle">{s.serviceDate}</span>
                </span>
                <Button onClick={() => void pickSetlist(s)} disabled={!!busy}>
                  {state.setlistId === s.id ? '다시 열기' : '고르기'}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Notice>아직 올라온 콘티가 없습니다. 아래에서 직접 올릴 수 있습니다.</Notice>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {leadTeam.map(({ service, team }) => (
            <FilePicker
              key={service.id}
              label={`${service.name} 콘티 올리기`}
              accept="application/pdf"
              onFiles={([file]) =>
                void upload(file, {
                  teamId: team.id,
                  serviceId: service.id,
                  serviceDate: new Date().toISOString().slice(0, 10),
                })
              }
            />
          ))}
        </div>
        {busy && <Notice>{busy}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
      </Card>

      <Card title={`곡 ${state.songs.length}`} hint="파트 이름과 순서가 슬라이드 순서가 됩니다.">
        <div className="flex flex-col gap-4">
          {state.songs.map((song) => (
            <SongEditor key={song.id} song={song} wizard={wizard} />
          ))}
          <Button onClick={() => songs.add()}>곡 추가</Button>
        </div>
      </Card>
    </div>
  )
}

function SongEditor({ song, wizard }: { song: Song; wizard: Wizard }) {
  const { songs } = wizard
  return (
    <div className="rounded-md bg-surface-alt p-3">
      <div className="flex items-center gap-2">
        <TextInput
          value={song.title}
          placeholder="곡 제목"
          onChange={(e) => songs.update(song.id, { title: e.target.value })}
        />
        <Button variant="danger" onClick={() => songs.remove(song.id)}>
          삭제
        </Button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {song.sections.map((section, i) => (
          <div key={i} className="flex gap-2">
            <TextInput
              value={section.label}
              aria-label="파트 이름"
              className="w-20 shrink-0 text-center font-mono"
              onChange={(e) => {
                const label = e.target.value.trim().toUpperCase()
                const next = song.sections.map((s, j) => (j === i ? { ...s, label } : s))
                songs.update(song.id, {
                  sections: next,
                  order: song.order.map((l) => (l === section.label ? label : l)),
                })
              }}
            />
            <TextArea
              value={section.lines.join('\n')}
              aria-label={`${section.label} 가사`}
              placeholder="한 줄이 한 줄로 나갑니다"
              onChange={(e) =>
                songs.setSections(
                  song.id,
                  song.sections.map((s, j) => (j === i ? { ...s, lines: e.target.value.split('\n') } : s)),
                )
              }
            />
            <Button
              variant="danger"
              className="self-start"
              onClick={() => songs.setSections(song.id, song.sections.filter((_, j) => j !== i))}
            >
              −
            </Button>
          </div>
        ))}
        <Button
          onClick={() =>
            songs.update(song.id, {
              sections: [...song.sections, { label: `V${song.sections.length + 1}`, lines: [''] }],
            })
          }
        >
          파트 추가
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="순서" hint="파트 이름을 공백으로 구분합니다. I 는 간주(제목 슬라이드).">
          <TextInput
            value={song.order.join(' ')}
            onChange={(e) => songs.update(song.id, { order: e.target.value.split(/\s+/).filter(Boolean) })}
          />
        </Field>
        <Field label="한 장당 줄 수" hint="템플릿 기본값은 4입니다.">
          <TextInput
            type="number"
            min={1}
            max={8}
            value={song.linesPerSlide}
            onChange={(e) => songs.update(song.id, { linesPerSlide: Number(e.target.value) || 4 })}
          />
        </Field>
      </div>
    </div>
  )
}

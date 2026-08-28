// 콘티와 완성된 덱이 오가는 길 — 브라우저 쪽.
//
// **바이트는 엣지 함수를 지나가지 않는다.** 함수는 서명된 URL만 내주고, 파일은 브라우저와
// Supabase Storage 사이에서 곧장 오간다. ppt에서 파일을 1 MiB 조각으로 쪼개 Durable
// Object에 왕복시키던 코드가 통째로 없어진 자리가 여기다.
//
// 사라진 것이 하나 더 있다: "이 브라우저의 사본"이라는 개념. ppt에는 로그인이 없어
// localStorage/IndexedDB에 두고 서버와 병합했다. 계정이 생기면 사본은 하나다.
import { api } from '../../../lib/api'

export type Partition = 'youth' | 'adult'
export type TeamKind = 'praise' | 'choir'

export interface ServiceTeam {
  id: string
  name: string
  kind: TeamKind
  /** 2부에는 팀이 둘 온다. 그중 슬라이드가 되는 쪽 — 예배당 하나뿐이다. */
  leadsPpt: boolean
}

export interface Service {
  id: string
  name: string
  startsAt: string
  partition: Partition
  teams: ServiceTeam[]
}

export interface Setlist {
  id: string
  teamId: string
  serviceId: string
  serviceDate: string
  serviceName: string
  partition: Partition
  hasConti: boolean
  hasDeck: boolean
  /** 목록에서 내려간 시각. **지워진 것이 아니다.** */
  archivedAt: string | null
}

interface UploadTicket {
  bucket: string
  path: string
  uploadUrl: string
  token: string
  expiresIn: number
}

interface ContiTicket extends UploadTicket { setlistId: string }

export const getServices = () => api<{ services: Service[] }>('GET', '/api/slides/services')

/** 기본은 보관되지 않은 것만 — 매주 지우던 규칙을 대신하는 자리다. */
export function getSetlists(opts: { date?: string; includeArchived?: boolean } = {}) {
  const q = new URLSearchParams()
  if (opts.date) q.set('date', opts.date)
  if (opts.includeArchived) q.set('archived', '1')
  const qs = q.toString()
  return api<{ setlists: Setlist[] }>('GET', `/api/slides/setlists${qs ? `?${qs}` : ''}`)
}

/**
 * 콘티를 올린다. 두 걸음이다 — 자리를 잡고(서명 URL을 받고), 그 URL로 바이트를 보낸다.
 *
 * 같은 팀·예배·날짜면 서버가 **그 줄을 다시 쓴다.** 새 줄을 만들면 UNIQUE가 막고, 막힌
 * 자리에서 사람은 날짜를 고쳐 넣는다 — 그러면 그 주의 콘티가 다른 날짜에 가서 앉는다.
 */
export async function uploadConti(
  target: { teamId: string; serviceId: string; serviceDate: string },
  file: File,
): Promise<{ setlistId: string; path: string }> {
  const ticket = await api<ContiTicket>('POST', '/api/slides/setlists', { ...target, fileName: file.name })
  await putSigned(ticket, file)
  return { setlistId: ticket.setlistId, path: ticket.path }
}

/** 완성된 예배 슬라이드를 그 주의 콘티 옆에 둔다. */
export async function uploadDeck(setlistId: string, file: File): Promise<{ path: string }> {
  const ticket = await api<UploadTicket>('POST', `/api/slides/setlists/${setlistId}/deck`, { fileName: file.name })
  await putSigned(ticket, file)
  return { path: ticket.path }
}

/**
 * 열어 보는 링크. 짧게 산다(기본 5분) — 자격 없이도 열리는 링크라, 받아 두고 주중에
 * 돌려 쓰라고 주는 것이 아니다. 필요할 때마다 다시 받는다.
 */
export const contiUrl = (setlistId: string) =>
  api<{ url: string; expiresIn: number }>('GET', `/api/slides/setlists/${setlistId}/conti`)

export const deckUrl = (setlistId: string) =>
  api<{ url: string; expiresIn: number }>('GET', `/api/slides/setlists/${setlistId}/deck`)

/** 보관 — 목록에서 내려가고 파일은 남는다. `restore: true` 면 되돌린다. */
export const archiveSetlist = (setlistId: string, restore = false) =>
  api<{ id: string; archived: boolean }>('POST', `/api/slides/setlists/${setlistId}/archive`, { restore })

/**
 * 서명된 URL로 바이트를 보낸다.
 *
 * Storage가 돌려주는 실패는 XML이라 api()의 JSON 처리를 지나갈 수 없다 — 그래서 여기만
 * 날 fetch다. 실패를 삼키지 않는 것이 중요하다: 자리는 잡혔는데 파일이 없는 콘티가
 * 남으면, 목록에는 보이고 열면 없는 줄이 된다.
 */
async function putSigned(ticket: UploadTicket, file: File): Promise<void> {
  const res = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) throw new Error(`업로드에 실패했습니다 (HTTP ${res.status})`)
}

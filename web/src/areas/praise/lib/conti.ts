// 찬양팀 인도자의 영역 — 서버와 오가는 길.
//
// `areas/slides/lib/setlists.ts` 와 같은 일을 하지만 **범위가 다르다.** 저쪽은 부(部)의
// 예배를 전부 보고, 여기는 자기 팀 하나만 본다. 그래서 경로도 다르고(`/api/praise/`),
// 그 접두사가 곧 영역 판정이다 — 두 화면이 같은 경로를 쓰면 인도자에게 남의 팀 콘티를
// 여는 길이 생긴다.
//
// **바이트는 엣지 함수를 지나가지 않는다.** 함수는 서명된 URL만 내주고 파일은 브라우저와
// Storage 사이에서 곧장 오간다 (`slides.ts`의 그 규칙 그대로).
import { api } from '../../../lib/api'
import type { LeaderTeam } from '../../../lib/api'

export interface LeaderService {
  id: string
  name: string
  startsAt: string
  partition: 'youth' | 'adult'
  /** 이 예배의 슬라이드를 이 팀이 이끄는가. 2부에는 콘티가 둘 오고 하나만 참이다. */
  leadsPpt: boolean
}

export interface PraiseSetlist {
  id: string
  teamId: string
  serviceId: string
  serviceDate: string
  serviceName: string
  hasConti: boolean
  hasDeck: boolean
  archivedAt: string | null
  uploadedByEmail: string | null
  uploadedByName: string | null
}

export interface LeaderContext {
  /** 이 자격이 이끄는 팀. null 이면 소유자다 — 그때만 화면이 팀을 묻는다. */
  team: LeaderTeam | null
  /** 팀이 없는 자격에게만 채워진다 (소유자). */
  teams: LeaderTeam[]
  services: LeaderService[]
  /** 이끄는 예배가 하나뿐이면 그 id. 둘이면 null이고, 화면이 묻는다. */
  defaultServiceId: string | null
  /**
   * 콘티가 향하는 주일. **서버가 정한다** — 화면의 시계는 폰의 시계이고, 그 시계는
   * 여행에서 막 돌아온 사람의 것일 수 있다.
   */
  serviceDate: string
  leader: { email: string; name: string }
}

export const getLeaderContext = () => api<LeaderContext>('GET', '/api/praise/me')

export const getMySetlists = () => api<{ setlists: PraiseSetlist[] }>('GET', '/api/praise/setlists')

interface Ticket {
  bucket: string
  path: string
  uploadUrl: string
  token: string
  expiresIn: number
}

interface ContiTicket extends Ticket {
  setlistId: string
  serviceDate: string
  /** 완성된 덱이 받을 이름 — ppt의 규칙 그대로 `MMDD.pptx`. 서버가 짓는다. */
  deckFileName: string
}

export interface ContiUpload {
  setlistId: string
  serviceDate: string
  deckFileName: string
}

/**
 * 콘티를 올린다. 두 걸음이다 — 자리를 잡고(서명 URL을 받고), 그 URL로 바이트를 보낸다.
 *
 * **팀은 보내지 않는다.** 서버가 자격에서 읽는다 (`role.team`). 보낼 수 있으면 그것이 곧
 * 남의 팀 콘티를 덮어쓰는 길이고, 그러면 「올린 인도자에 맞춰서」가 뜻을 잃는다.
 * 소유자만은 팀이 없어서 고른 값을 보낸다.
 */
export async function uploadConti(
  target: { serviceId: string; serviceDate?: string; teamId?: string },
  file: File,
): Promise<ContiUpload> {
  const ticket = await api<ContiTicket>('POST', '/api/praise/conti', { ...target, fileName: file.name })
  await putSigned(ticket, file)
  return { setlistId: ticket.setlistId, serviceDate: ticket.serviceDate, deckFileName: ticket.deckFileName }
}

/** 자동으로 만들어진 덱을 그 주의 콘티 옆에 둔다. 미디어팀이 여기서 받는다. */
export async function uploadDeck(setlistId: string, file: File): Promise<{ path: string }> {
  const ticket = await api<Ticket>('POST', `/api/praise/setlists/${setlistId}/deck`, { fileName: file.name })
  await putSigned(ticket, file)
  return { path: ticket.path }
}

/** 열어 보는 링크. 짧게 산다(5분) — 자격 없이도 열리는 링크다. */
export const contiUrl = (setlistId: string) =>
  api<{ url: string; expiresIn: number }>('GET', `/api/praise/setlists/${setlistId}/conti`)

export const deckUrl = (setlistId: string) =>
  api<{ url: string; expiresIn: number }>('GET', `/api/praise/setlists/${setlistId}/deck`)

/**
 * 서명된 URL로 바이트를 보낸다.
 *
 * Storage가 돌려주는 실패는 XML이라 api()의 JSON 처리를 지나갈 수 없다 — 그래서 여기만
 * 날 fetch다. 실패를 삼키지 않는 것이 중요하다: 자리는 잡혔는데 파일이 없는 콘티가
 * 남으면, 목록에는 보이고 열면 없는 줄이 된다.
 */
async function putSigned(ticket: Ticket, file: File): Promise<void> {
  const res = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) throw new Error(`업로드에 실패했습니다 (HTTP ${res.status})`)
}

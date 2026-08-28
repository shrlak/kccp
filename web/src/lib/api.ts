import { getDeviceId } from './device'
import { ADMIN_PARTITION_KEY, readStoredPartition, type Partition } from './partition'
import { DEFAULT_SEMESTER_DATES, type SemesterDates, type SemesterSchedule, type TermCalendar } from './semester'

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api'
// 슬라이드 인식의 AI 프록시. 별개의 엣지 함수인 이유는 상류 모델을 기다리는 요청이
// /api/roster(앱의 뜨거운 길, 15초마다 모두가 부른다)와 같은 아이솔레이트를 붙들지 않게
// 하려는 것이다. 자격은 같은 것을 실어 보낸다 — 서버 쪽도 같은 auth.ts를 부른다.
export const AI_BASE =
  (import.meta.env.VITE_AI_BASE as string | undefined) ??
  API_BASE.replace(/\/attendance-api$/, '/ai-proxy')
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

let adminPassword: string | null = null
let adminToken: string | null = null
// 새로고침한 탭의 **첫 요청**부터 고른 부로 나가야, 저쪽 부의 패널이 한 번 그려졌다가 바뀌는
// 일이 없다. 그래서 스토어가 걸어 주기를 기다리지 않고 여기서 바로 읽는다.
let adminPartition: Partition | null = readStoredPartition()

export function setAdminPassword(pw: string | null) { adminPassword = pw }
// Set by the auth store after a successful Google sign-in; sent as Authorization: Bearer.
export function setAdminToken(token: string | null) { adminToken = token }
// 두 부를 다 맡는 구글 계정이 고른 부 (identity.canChoosePartition). 고르기 전에는 null이고,
// 그때는 서버가 지금까지처럼 그 사람의 members 행이 있는 부를 준다. 요청이라 신뢰되지 않는다 —
// 서버가 그 이메일이 고를 수 있는 사람인지 확인한 뒤에만 따른다 (auth.ts resolveAdmin).
export function setAdminPartition(partition: Partition | null) {
  adminPartition = partition
  try {
    if (partition) sessionStorage.setItem(ADMIN_PARTITION_KEY, partition)
    else sessionStorage.removeItem(ADMIN_PARTITION_KEY)
  } catch { /* non-fatal */ }
}

export async function api<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  // Nearly everything answers well under 12s; slow endpoints (e.g. Gemini card
  // extraction) pass their own budget.
  timeoutMs = 12_000,
): Promise<T> {
  return apiAt(API_BASE, method, path, body, extraHeaders, timeoutMs)
}

// 같은 자격을 다른 엣지 함수로. api()가 이것의 얇은 껍데기다 — 자격을 싣는 규칙(구글
// 토큰 우선, 없으면 비밀번호, 부는 토큰일 때만)이 두 벌이 되면 한쪽이 뒤처지고, 뒤처진
// 쪽은 대개 **덜 실어 보내는** 쪽이라 알 수 없는 401로 나타난다.
export async function apiAt<T = unknown>(
  base: string,
  method: Method,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  timeoutMs = 12_000,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const headers: Record<string, string> = { 'X-Device-Id': getDeviceId() }
  if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`
  else if (adminPassword) headers['X-Admin-Password'] = adminPassword
  if (adminToken && adminPartition) headers['X-Partition'] = adminPartition
  if (extraHeaders) Object.assign(headers, extraHeaders)
  if (body) headers['Content-Type'] = 'application/json'
  try {
    const resp = await fetch(base + path, {
      method,
      headers,
      signal: ctrl.signal,
      body: body ? JSON.stringify(body) : undefined,
    })
    clearTimeout(timer)
    // The edge function returns JSON for both success and error responses, and uses
    // 200 for business statuses (e.g. "already", "time-restricted"). Only a non-2xx
    // status is a real failure — surface it so TanStack Query marks the query errored.
    const data = await resp.json().catch(() => null)
    if (!resp.ok) {
      const msg =
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${resp.status}`
      throw new Error(msg)
    }
    if (data === null) throw new Error(`HTTP ${resp.status} — non-JSON response`)
    return data as T
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

// Phase-0 response shapes (from the attendance-api edge function)
export interface AppConfig {
  summerMode: boolean
  // 부서 accent colors (hex, e.g. "#E0A800") — drives the 오늘 tab's name icons, the kiosk's
  // per-부서 tile backgrounds, and the 멤버 tab's per-부서 card backgrounds. Keyed by group
  // name; falls back to DEFAULT_GROUP_COLORS (./areas/attend/admin/groupColors) for any group
  // not present.
  groupColors: Record<string, string>
  // The recurring MM-DD template — the pattern every year falls back to. Optional until the
  // semester-dates migration is applied and a super-admin saves a schedule; consumers retain
  // the legacy boundaries when this is null/absent.
  semesterDates?: SemesterDates | null
  // 2년치 학기 일정: the concrete terms an admin edits, retained past terms included. Wins
  // over the template for any year/season it lists (see lib/semester.ts termRange). The
  // server rolls it forward as terms end.
  semesterSchedule?: SemesterSchedule | null
}

// /api/config is unauthenticated (the landing page reads it too), so instead of resolving
// an admin there — one more round trip on a query every tab makes — it returns BOTH 부's
// settings and the client picks. Nothing here is personal data: term dates and hex colors.
// Read it through useAppConfig(), never directly, so the pick happens in exactly one place.
export interface AppConfigResponse extends AppConfig {
  adult?: AppConfig
}

export const getConfig = () => api<AppConfigResponse>('GET', '/api/config')

// The 부's own settings out of that response. 장년부 keeps its own term schedule, 동산 색
// and (always-off) 여름 모드 — see supabase/migrations/20260806_adult_ministry_partition.sql.
export function configFor(cfg: AppConfigResponse | undefined, partition: Partition): AppConfig | undefined {
  if (!cfg) return undefined
  if (partition !== 'adult') return cfg
  // An older cached response (or an edge function not yet redeployed) has no adult block;
  // fall back to an empty one rather than showing 대학·청년부's schedule under 장년부.
  return cfg.adult ?? { summerMode: false, groupColors: {}, semesterDates: null, semesterSchedule: [] }
}

// The term calendar to hand to any date helper: the saved schedule over the recurring
// template. One call site instead of remembering to pass both. Undefined when the church has
// saved neither — callers still treat that as "no configured schedule" (the pre-settings
// legacy boundaries), exactly as they did when this was a bare semesterDates.
export function configCalendar(cfg?: AppConfig | null): TermCalendar | undefined {
  if (!cfg?.semesterDates && !cfg?.semesterSchedule?.length) return undefined
  return { dates: cfg?.semesterDates ?? DEFAULT_SEMESTER_DATES, schedule: cfg?.semesterSchedule ?? [] }
}

// ── Admin (hardened: Google JWT, or a shared team password from any device) ───
// Three break-glass passwords route a password-only login on an unroled device to a role:
// the super password → 'super_admin' (full panel), the leader password → 'leader' (리더
// dashboard), the welcoming password → 'welcoming' (새가족팀 dashboard). All get full-roster
// visibility; the server synthesizes them (see auth.ts verifyAdmin). 'staff' is the legacy
// combined break-glass role, kept for back-compat.
export type AdminRole =
  | 'super_admin' | 'leader' | 'pastor' | 'welcoming' | 'staff'
  // 합치면서 생긴 둘. 서버의 auth.ts와 짝을 맞춰 둔다 — 어긋나면 화면이 서버가
  // 실제로 내려주는 역할을 모르는 채로 분기한다.
  | 'media'   // 부서 미디어팀 역할 계정 — 슬라이드 영역만
  | 'owner'   // 소유자 — 부와 영역의 경계를 넘는다

// 합쳐진 앱의 영역. 'attend'는 지금까지의 관리자 패널이고, 'slides'는 ppt에서 들어온
// 예배 슬라이드다. 어느 것을 가졌는지는 자격이 정한다 — 비밀번호는 언제나 출석뿐이고,
// 슬라이드는 구글 계정으로만 열린다.
export type Area = 'attend' | 'slides' | 'praise'

// 영역이 없는 응답(옛 엣지 함수)은 출석 하나로 읽는다. 새 화면이 옛 서버 앞에서
// 빈 손이 되지 않도록.
export function areasOf(identity: AdminIdentity | null | undefined): Area[] {
  const list = identity?.areas
  return list && list.length ? list : ['attend']
}

export interface AdminIdentity {
  role: AdminRole
  group: string
  subgroup: string
  ministry: string
  // 대학·청년부('youth') 또는 장년부('adult'). Decided by the server from the password (or
  // the signed-in member's grant) and never sent by the client. Everything the panel shows
  // is already filtered to it server-side; the web reads it to pick the right 부서 lists,
  // the right settings block, and to drop the 새가족 교육 tab in 장년부.
  // Absent on a response from an edge function older than the 장년부 rollout → 'youth'.
  partition?: Partition
  // 이 자격이 들어갈 수 있는 영역. 서버가 정하고(auth.ts), 화면은 어디로 보낼지 고르는
  // 데에만 쓴다 — 지키는 것은 여기가 아니라 서버다(resolveAdmin이 라우트마다 검사한다).
  // Absent ⇒ 영역이 생기기 전의 엣지 함수 → 'attend' 하나로 읽는다.
  areas?: Area[]
  // True only for the designated login-log viewer (김호연), signed in attributably —
  // linked device or Google email, never a bare shared password. Server-decided
  // (auth.ts canViewLoginLog); gates the login-history section in the Admins tab.
  canViewLoginLog?: boolean
  // 이 로그인은 두 부를 다 볼 수 있다 — 로그인 뒤 어느 부의 패널로 들어갈지 고르고, 패널
  // 안에서 언제든 건너갈 수 있다. 구글 로그인에만 붙는다 (auth.ts CROSS_PARTITION_EMAILS).
  canChoosePartition?: boolean
}

// Precise sign-in coordinates from the browser's Geolocation API, attached to the login
// record so the login-history viewer sees a street-level location. null unless the admin
// allowed the permission prompt.
export interface LoginCoords { lat: number; lon: number; accuracy: number | null }

// Ask the browser for the device's current position, best-effort: resolves the coordinates
// if the admin allows the prompt, or null on denial / no support / timeout — the caller then
// signs in without GPS and the server falls back to the city-level IP estimate.
//
// CRITICAL: this must never block sign-in. getCurrentPosition can hang indefinitely — its
// `timeout` option only bounds position *acquisition*, not the wait for the permission
// prompt, so a user who dismisses (rather than answers) the prompt, or a browser that
// silently withholds the callbacks, leaves it pending forever. Since verify() awaits this,
// an unbounded hang would freeze the login on "verifying". So we wrap it in our own
// wall-clock guard that always resolves (null) after GUARD_MS regardless of the API.
const GEO_GUARD_MS = 9000
// How long a *sign-in* is willing to wait for a fix before going ahead without one. A
// position the browser already holds comes back immediately (see maximumAge below), but a
// cold high-accuracy fix indoors can take many seconds — and making someone watch the
// verifying screen for that long, to enrich a log entry only one person ever reads, is the
// wrong trade. Past this the request goes without coords and the server falls back to the
// city-level IP estimate, which the viewer already labels 대략.
export const GEO_LOGIN_WAIT_MS = 2000
export function getLoginPosition(waitMs: number = GEO_GUARD_MS): Promise<LoginCoords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    let settled = false
    const done = (v: LoginCoords | null) => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      resolve(v)
    }
    const guard = setTimeout(() => done(null), waitMs)
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => done({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null }),
        () => done(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 300_000 },
      )
    } catch {
      done(null)
    }
  })
}

function geoHeaders(coords?: LoginCoords | null): Record<string, string> {
  if (!coords) return {}
  const h: Record<string, string> = { 'X-Geo-Lat': String(coords.lat), 'X-Geo-Lon': String(coords.lon) }
  if (coords.accuracy != null) h['X-Geo-Acc'] = String(coords.accuracy)
  return h
}

// Verify a shared team password (break-glass): works from any device. A device linked to a
// roled member keeps that scope; any other device is granted the role the password maps to
// — 'super_admin', 'leader', or 'welcoming', full roster (see auth.ts verifyAdmin). When
// coords are supplied (admin allowed the location prompt) they ride along for the log.
export const adminVerify = (password: string, coords?: LoginCoords | null) =>
  api<AdminIdentity>('POST', '/api/admin/verify', undefined, { 'X-Admin-Password': password, ...geoHeaders(coords) })

// Verify via Google JWT (token already set via setAdminToken before calling this).
export const adminVerifyGoogle = (coords?: LoginCoords | null) =>
  api<AdminIdentity>('POST', '/api/admin/verify', undefined, geoHeaders(coords))

export interface Member {
  id: string
  name: string
  group_name: string
  subgroup: string
  member_role: string
  gender: string
  phone: string
  birth_date: string | null
  kakao_id: string
  is_new_member: boolean
  notes: string
  registration_date?: string | null
  new_member_edu_week1?: boolean
  new_member_edu_week2?: boolean
  pastoral_visit_requested?: boolean | null
  // 새가족 등록 카드 fields (stored on members; /api/roster returns them via select *).
  baptism_status?: string
  school_or_work?: string
  faith_duration?: string
  is_staff?: boolean
  // 상태 표기 (master-sheet grey marks: 한국 귀국 / 이주 / 돌아옴 …). The 출석부 renders the
  // note as a grey cell spanning status_start → status_end (null = the term's last Sunday).
  // 예전 단일 표기 — 서버가 status_marks의 현재/최신 표기를 여기에 계속 mirror 한다.
  status_note?: string
  status_start?: string | null
  status_end?: string | null
  // 멤버당 여러 개의 상태 표기 (방학 → 한국 귀국 …). lib/status.ts가 읽는 목록.
  status_marks?: { note: string; start: string | null; end: string | null }[]
  // 구글 로그인 신원 (두 스키마 공통). email_alt는 같은 사람의 두 번째 계정 — 20260811.
  email?: string
  email_alt?: string
  // 장년부 새교우 방문·등록 카드의 칸들 (마이그레이션 20260808 — adult.members에만 있다).
  // 대학·청년부 멤버에는 언제나 undefined다.
  name_en?: string
  phone_home?: string
  address?: string
  city?: string
  state?: string
  zip_code?: string
  birth_date_raw?: string
  attend_reason?: string
  registration_choice?: string
  visit_date?: string | null
  member_no?: string
  family?: { nameKo: string; nameEn: string; relation: string; birthDate: string; gender: string; baptism: string }[]
  household_id?: string | null
}

export interface LogEntry {
  id?: number
  memberId?: string | null
  name: string
  group: string
  subgroup: string
  date: string
  time: string
  ts: number
  firstVisit?: boolean
  memberRole?: string
  // 무엇의 출석인가. 서버가 `log`에는 예배만, `dongsanLog`에는 동산모임만 담아 보내므로
  // 화면이 이 값을 보고 갈라낼 일은 없다 — 한 줄만 따로 들여다볼 때를 위한 표시다.
  kind?: AttendanceKind
  // 이 줄을 만든 것. 'sheet'면 구글 시트 연동이 넣었다는 뜻(앱에서 찍은 것은 비어 있다).
  source?: string | null
}

// 주일예배 출석과 동산모임 출석은 서로 다른 사실이다 — 동산모임에는 왔지만 예배에는 못 온
// 주가 실제로 있고, 동산 시트가 그 둘을 따로 적는다.
export type AttendanceKind = 'worship' | 'dongsan'

// One retired term's 동산 편성, frozen by the server the day the term ended (the live
// assignment is cleared at that point). Keyed by member id → 동산.
export interface TermDongsan {
  endedAt: string
  subgroups: Record<string, string>
}

export interface RosterResponse {
  role: AdminRole
  // The 부 this roster was scoped to — the same value /api/admin/verify returned.
  partition?: Partition
  members: Member[]
  // 주일예배 출석만. 지금까지와 같은 목록이라, 이것을 읽는 화면은 동산모임이 생겼다는 것을
  // 몰라도 계속 맞는다.
  log: LogEntry[]
  // 동산모임 출석. 구글 시트 연동이 들어오기 전에는 비어 있다.
  dongsanLog?: LogEntry[]
  // 학기 종료 시 얼려둔 동산 편성, 학기 키("2026-summer")별 — 지난 학기 출석부가 그 학기의
  // 동산 블록을 유지하는 근거. Scoped to the members this admin can see.
  dongsanHistory?: Record<string, TermDongsan>
  // True for super-admins and leaders who are NOT a 동산지기/부동산지기 — they may bulk
  // reassign members' 동산 (feature-gated client-side; enforced server-side too).
  canBulkSubgroup?: boolean
  // True for super-admins (clear directly) + leader/welcoming non-동산지기 (request a clear).
  canClearAttendance?: boolean
}

// The role-scoped roster (super/pastor → all; leader → their 동산).
export const getRoster = () => api<RosterResponse>('GET', '/api/roster')

// Bulk-set the 동산 (subgroup) of many members at once; subgroup "" removes them from any
// 동산. super-admin or a non-동산지기 leader; out-of-scope members dropped + audited
// server-side. Returns how many were actually updated.
export const bulkSetSubgroup = (memberIds: string[], subgroup: string) =>
  api<{ status: string; updated: number }>('POST', '/api/admin/members/bulk-subgroup', { memberIds, subgroup })

// Remove several members from the roster in one scoped request. The server deletes their
// member/device/role rows but intentionally keeps historical attendance records.
export const deleteMembers = (memberIds: string[]) =>
  api<{ status: string; deleted: number }>('POST', '/api/admin/members/delete', { memberIds })

// ── Clear all attendance (super clears directly; others request → super approves) ─────
export interface ClearRequest {
  requestedBy: string
  requestedByName: string
  requestedAt: number
}

// Wipe all attendance. super-admin → { status:'cleared' }; an allowed non-super admin →
// { status:'pending' } (held for a super-admin to approve). Audited server-side.
export const clearAttendance = () =>
  api<{ status: 'cleared' | 'pending' }>('POST', '/api/admin/attendance/clear')

// Pending clear-all requests (super-admin only).
export const getClearPending = () =>
  api<{ pending: ClearRequest[] }>('GET', '/api/admin/attendance/clear-pending').then((r) => r.pending)

// Approve a pending clear → wipes all attendance + empties the queue (super-admin only).
export const approveClear = () => api<{ status: string }>('POST', '/api/admin/attendance/clear-approve')

// Dismiss/reject pending clear requests (super-admin only).
export const rejectClear = () => api<{ status: string }>('POST', '/api/admin/attendance/clear-reject')

// 여름 모드 is not here: it is derived from semesterDates server-side (여름학기 기간이면 on),
// so there is nothing to set.
export interface SettingsPatch {
  groupColors?: Record<string, string>
  // The 2년치 학기 목록. The server derives the recurring template from it, so the two never
  // drift apart — there is no separate semesterDates patch any more.
  semesterSchedule?: SemesterSchedule
}

// Update any subset of the app-wide settings (super-admin). Only the provided
// fields change.
export const updateSettings = (patch: SettingsPatch) =>
  api<{ status: string }>('POST', '/api/admin/settings', patch)

// 동산 (dongsan) names, keyed by group: { "대학부": [...], "청년부": [...] } (super-admin).
export type DongsanNames = Record<string, string[]>

// Read the 동산-names map (super-admin); falls back to seeded defaults server-side.
export const getDongsanNames = () =>
  api<{ names: DongsanNames }>('GET', '/api/admin/dongsan-names').then((r) => r.names)

// Replace the whole 동산-names map (super-admin). Audited as a config-change server-side.
export const updateDongsanNames = (names: DongsanNames) =>
  api<{ status: string }>('POST', '/api/admin/dongsan-names', { names })

// ── 동산지기 / 부동산지기 display roles ────────────────────────────────────
// The 동산지기 (leader, 👑) + 부동산지기 (sub-leaders, ⭐) per 동산. This is a display
// badge system distinct from the `leader` admin role (which controls data scope). The
// map is keyed by group (or "합동" in summer mode), then by 동산 name.
export interface DongsanLeaderEntry {
  leader: string
  subLeaders: string[]
}
export type DongsanLeaders = Record<string, Record<string, DongsanLeaderEntry>>

// Read the 동산지기 map (any verified admin — badges show for everyone who can see the
// roster). Falls back to {} server-side.
export const getDongsanLeaders = () =>
  api<{ leaders: DongsanLeaders }>('GET', '/api/admin/dongsan-leaders').then((r) => r.leaders)

// Set one 동산's leader + sub-leaders (super-admin only). In summer mode pass group "합동".
export const setDongsanLeader = (group: string, subgroup: string, leader: string, subLeaders: string[]) =>
  api<{ status: string }>('POST', '/api/admin/dongsan-leaders', { group, subgroup, leader, subLeaders })

// ── Admins tab (super-admin) ──────────────────────────────────────────────
export interface AdminRoleRow {
  memberId: string
  name: string
  role: AdminRole
  group: string
  subgroup: string
  ministry: string
}

// All admin role grants (super-admin only).
export const getAdminRoles = () => api<{ roles: AdminRoleRow[] }>('GET', '/api/admin/roles')

export interface RoleAssignment {
  memberId: string
  role: AdminRole
  group?: string
  subgroup?: string
  ministry?: string
}

// Assign/replace a member's admin role (super-admin only).
export const setAdminRole = (a: RoleAssignment) => api<{ status: string }>('POST', '/api/admin/role/set', a)

// Revoke a member's admin role (super-admin only; refuses the last super admin).
export const removeAdminRole = (memberId: string) =>
  api<{ status: string }>('POST', '/api/admin/role/remove', { memberId })

export interface AuditEntry {
  ts: number
  action: string
  adminName: string
  details: unknown
}

// Recent admin actions, newest first (super-admin only).
export const getAuditLog = (limit = 100) =>
  api<{ log: AuditEntry[] }>('GET', `/api/admin/audit?limit=${limit}`)

// Approximate place a login IP resolves to (city-level — an IP can never give a
// GPS-exact position). null while unresolved; empty fields for private/reserved IPs.
export interface LoginLocation {
  city: string
  region: string
  country: string
  lat: number | null
  lon: number | null
  org: string
}

// Precise device-GPS location for a login, present only when the admin allowed the browser
// location prompt at sign-in. `address` is the reverse-geocoded street-level address (''
// until resolved or if the geocoder had nothing); accuracy is the browser's radius in m.
export interface LoginGps {
  lat: number
  lon: number
  accuracy: number | null
  address: string
}

export interface LoginLogEntry {
  ts: number
  role: AdminRole
  // The linked member's name when the sign-in device maps to one; '' for a pure
  // break-glass login (shared password on an unlinked device).
  memberName: string
  deviceId: string
  ip: string
  method: 'password' | 'google'
  // City-level IP estimate — the fallback when GPS wasn't granted.
  location: LoginLocation | null
  // Precise device GPS, when the admin allowed it. Preferred over `location`.
  gps: LoginGps | null
  // 이 로그인이 들어간 부 (20260814 migration). '' = 알 수 없음 — 부가 기록되기 전의
  // 공용 비밀번호 로그인. 사람의 소속이 아니라 **그때 들어간 부**라, 두 부를 오가는 계정은
  // 같은 사람의 로그인이 두 부에 나뉘어 남는다.
  partition?: Partition | ''
}

// Successful admin sign-ins — which account, when, from which IP/device, and the IP's
// approximate place — newest first. Restricted to the designated viewer (김호연): other
// super-admins get a 403 (see identity.canViewLoginLog). Repeat re-verifies within an
// hour are collapsed server-side.
export const getLoginLog = (limit = 100) =>
  api<{ log: LoginLogEntry[] }>('GET', `/api/admin/login-log?limit=${limit}`)

export interface MemberEdit {
  name?: string
  group?: string
  subgroup?: string
  memberRole?: string
  isNewMember?: boolean
  gender?: string
  phone?: string
  kakaoId?: string
  birthDate?: string | null
  notes?: string
  registrationDate?: string | null
  newMemberEduWeek1?: boolean
  newMemberEduWeek2?: boolean
  // 새가족 등록 카드 fields (the member-update endpoint maps them in its COLS table).
  baptismStatus?: string
  schoolOrWork?: string
  faithDuration?: string
  pastoralVisitRequested?: boolean | null
  // 상태 표기 목록 (여러 개). 서버가 여기서 예전 단일 컬럼도 채운다.
  statusMarks?: { note: string; start: string | null; end: string | null }[]
  // 장년부 카드의 칸들 — 서버는 장년부 요청에서만 이 이름들을 받는다 (대학·청년부 표에는
  // 그런 컬럼이 없다). index.ts ADULT_CARD_COLS.
  nameEn?: string
  phoneHome?: string
  address?: string
  city?: string
  state?: string
  zipCode?: string
  birthDateRaw?: string
  attendReason?: string
  registrationChoice?: string
  visitDate?: string | null
  memberNo?: string
  // 카드의 *이메일 칸. members.email이 곧 구글 로그인 신원이기도 하지만, 로그인은 역할
  // 행(member_roles)이 따로 있어야 성립하므로 여기 적는 것만으로는 아무 권한도 생기지 않는다.
  email?: string
  family?: { nameKo: string; nameEn: string; relation: string; birthDate: string; gender: string; baptism: string }[]
}

// Edit a member (scoped server-side: leaders only their 동산; pastor read-only).
export const updateMember = (memberId: string, fields: MemberEdit) =>
  api<{ status: string }>('PUT', '/api/admin/member', { memberId, ...fields })

// Merge one member into another: the source's devices + attendance move to the target,
// then the source member is deleted. Scoped + audited server-side (pastor read-only).
export const mergeMembers = (fromId: string, toId: string) =>
  api<{ status: string }>('POST', '/api/admin/merge', { fromId, toId })

// Delete a member and their linked devices/role while preserving historical attendance.
// Scoped + audited server-side; pastor read-only.
export const deleteMember = (memberId: string) =>
  api<{ status: string }>('POST', '/api/admin/member/delete', { memberId })

export interface MemberCheckinResponse {
  status: 'ok' | 'already'
  time?: string
  name?: string
  firstVisit?: boolean
}

// Manually mark a member present for today (bypasses day/time/location). Scoped +
// audited server-side; pastor read-only. Returns 'already' if they're in for today.
export const memberCheckin = (memberId: string) =>
  api<MemberCheckinResponse>('POST', '/api/admin/member-checkin', { memberId })

// Add a manual attendance entry for a member on any date (back-fill). Scoped + audited;
// pastor read-only. Returns 'already' if an entry exists for that member+date.
export const addMemberAttendance = (memberId: string, date: string) =>
  api<{ status: 'ok' | 'already' }>('POST', '/api/admin/log/add', { memberId, date })

// Remove a single attendance entry by its row id. Scoped + audited; pastor read-only.
export const removeAttendance = (logId: number) =>
  api<{ status: string }>('POST', '/api/admin/log/remove', { logId })

// Add an entry for many members on a chosen date. Out-of-scope members are dropped and
// already-present ones skipped server-side; returns how many were actually added.
export const addBulkAttendance = (memberIds: string[], date: string) =>
  api<{ status: string; added: number }>('POST', '/api/admin/log/add-bulk', { memberIds, date })

// ── Off-site encrypted DB backup (super-admin) ────────────────────────────
// The full weekly Postgres dump pipeline to Cloudflare R2 (scripts/backup/,
// .github/workflows/backup.yml) — the only backup/restore path in the app.
export interface DbBackupEntry {
  date: string
  current: boolean
  updatedAt?: string
  totalSize?: number
  sqlKey?: string
  sqlSize?: number
  schemaKey?: string
  schemaSize?: number
}

// Bucket-level storage usage returned alongside the backup list so the UI can render a
// limit bar. limitBytes defaults server-side to the R2 free tier (10 GB, decimal).
export interface DbBackupStorage {
  usedBytes: number
  limitBytes: number
}

// Triggers the scheduled GH Actions workflow immediately instead of waiting for Sunday.
export const runDbBackupNow = () => api<{ status: string }>('POST', '/api/admin/db-backup/run')

export const listDbBackups = () =>
  api<{ backups: DbBackupEntry[]; storage?: DbBackupStorage }>('GET', '/api/admin/db-backup/list')

// Short-lived presigned R2 URL — the browser downloads the still-encrypted file directly.
export const getDbBackupDownloadUrl = (key: string) =>
  api<{ url: string }>('GET', `/api/admin/db-backup/download?key=${encodeURIComponent(key)}`)

export interface RestoreDbBackupPayload {
  source: 'online' | 'upload'
  key?: string
  fileBase64?: string
  privateKey: string
  confirm: string
}

// Destructive: decrypts the given backup with a private key supplied fresh in this one
// call (never persisted anywhere) and replaces every table's contents. Requires the
// literal confirmation phrase "RESTORE" as a server-side backstop behind the UI's own
// confirm gate. Generous timeout — decrypt + full-table reload over a cold pooler
// connection can run past the default budget even though this DB is tiny.
export const restoreDbBackup = (payload: RestoreDbBackupPayload) =>
  api<{ status: string; tables: number }>('POST', '/api/admin/db-backup/restore', payload, undefined, 60_000)

// ── Kiosk (runs on a verified admin device) ───────────────────────────────
// Guest (방문자) check-in from the kiosk: records a visitor attendance row for today
// (is_manual + is_guest, member_role "visitor"), bypassing day/time/location. Hardened
// (verifyAdmin) + audited server-side; pastor read-only. Deduped by name+date.
// `group` (대학부/청년부) puts the visitor on that 부서's 오늘 sheet / 출석부 이미지.
export const guestCheckin = (name: string, group: string) =>
  api<{ status: 'ok' | 'already'; time?: string; name?: string }>('POST', '/api/admin/guest-checkin', { name, group })

export interface NewMemberFields {
  name: string
  group: string
  subgroup?: string
  gender?: string
  phone?: string
  kakaoId?: string
  birthDate?: string | null
  baptismStatus?: string
  schoolOrWork?: string
  faithDuration?: string
  // 등록일 (registration date). Optional; server defaults to today when omitted.
  registrationDate?: string | null
  pastoralVisitRequested?: boolean | null
  // Admin card-scan path: create the member + device but skip today's attendance row
  // (e.g. entering a stack of paper cards later in the week). Kiosk never sends this.
  skipCheckin?: boolean
  // 로그인 없이 도는 공유 링크가 "어느 부의 링크인지" 말하는 값. 로그인 경로에서는 서버가
  // 신원에서 부를 알아내므로 보내지 않는다.
  partition?: 'youth' | 'adult'
  // 장년부 카드가 묻는 것들 — 그 부의 등록에서만 쓰인다 (adult.members에만 있는 칸들).
  nameEn?: string
  phoneHome?: string
  email?: string
  address?: string
  city?: string
  state?: string
  zipCode?: string
  attendReason?: string
  registrationChoice?: string
  visitDate?: string | null
  memberNo?: string
  birthDateRaw?: string
  family?: { nameKo: string; nameEn: string; relation: string; birthDate: string; gender: string; baptism: string }[]
}

// 새가족 (new-family) registration from the kiosk: creates a member with
// is_new_member=true + a NEW-{ts} device, then records today's attendance (first_visit)
// unless skipCheckin. Hardened (verifyAdmin) + audited server-side; pastor read-only.
export const kioskNewMember = (fields: NewMemberFields) =>
  api<{ status: 'ok'; memberId: string; time?: string }>('POST', '/api/admin/kiosk-new-member', fields)

// 새가족 등록 카드 photo extraction: sends a downscaled card photo (base64) to the edge
// function, which has a vision model read the handwriting/checkboxes into raw card JSON —
// normalized client-side (cardExtraction.ts) before showing it for review. Nothing is
// saved server-side. `cards` holds every card found in the photo (a stack photographed
// in one shot yields several); `card` is the first one, kept for older clients. `model`
// names the free model that read it — the server falls back through a chain of them, so
// a single call can take well over the default 12s budget.
export const extractCard = (image: string, mediaType: string) =>
  api<{ status: 'ok'; cards?: Record<string, unknown>[]; card?: Record<string, unknown>; model?: string; usage: CardScanUsage }>('POST', '/api/admin/extract-card', { image, mediaType }, undefined, 60_000)

export interface CardScanUsage {
  limit: number
  remaining: number
  day: string
  resetsAt: number
  updatedAt: number
}

// Live card-recognition API-call allowance for the current Pittsburgh day (any verified
// admin). The server counts every outbound Gemini request, including failed responses;
// only the number remaining is exposed, and the daily limit is super-admin-configurable.
export const getCardScanUsage = () => api<CardScanUsage>('GET', '/api/admin/card-scan-usage')

// ── Share-link card registration (no login) ──────────────────────────────────
// share.html registers 새가족 cards without any sign-in, so it calls the unauthenticated
// twins of the three endpoints above. Server-side they run the same code paths and draw
// on the same shared daily scan quota; the only difference is that no admin role is
// resolved. Anyone holding the link can register a card — that is the intent.
export const extractCardViaShare = (image: string, mediaType: string) =>
  api<{ status: 'ok'; cards?: Record<string, unknown>[]; card?: Record<string, unknown>; model?: string; usage: CardScanUsage }>('POST', '/api/share/extract-card', { image, mediaType }, undefined, 60_000)

export const shareNewMember = (fields: NewMemberFields) =>
  api<{ status: 'ok'; memberId: string; time?: string }>('POST', '/api/share/new-member', fields)

export const getShareCardScanUsage = () => api<CardScanUsage>('GET', '/api/share/card-scan-usage')

// ── 구글 시트 동산 출석 연동 ──────────────────────────────────────────────────
// 동산은 예배·동산모임 출석을 구글 시트에 적는다. 그 시트가 바뀌면 시트에 붙인 Apps
// Script가 서버를 두드리고, **읽고 해석하는 일은 서버가 한다** — 여기 있는 것은 어느
// 시트를 볼지 등록하고, 지난번에 무슨 일이 있었는지 읽어 오는 관리자 쪽 손잡이뿐이다.

export interface SheetSource {
  /** 스프레드시트 id (공유 링크에서 뽑는다). */
  id: string
  /** 탭 gid. 비어 있으면 첫 번째 탭. */
  gid: string
  title: string
  /** 이 시트가 어느 부서의 것인가. 여름 합동 시트처럼 부서가 섞여 있으면 빈 문자열. */
  group: string
  /**
   * 이 시트가 어느 학기의 것인가 ("2026-summer", 붙인 날의 학기). 동산 시트는 학기마다 새로
   * 만드는 물건이라, 지난 학기 시트는 등록된 채 남아 있어도 **이번 학기의 그 부서를 담당하지
   * 않는다** — 그래야 여름 시트 한 장이 가을 리더 링크를 영영 막지 않는다. 동기화 자체는
   * 학기와 무관하게 계속 돈다.
   */
  term: string
}

/** 시트 한 장을 읽고 난 결과. 관리자 화면에 그대로 보여준다. */
export interface SheetSyncOutcome {
  sourceId: string
  title: string
  /** 새로 넣은 출석 줄 수. */
  added: number
  /** 시트에서 O가 X로 바뀌어 되돌린 줄 수 (연동이 넣었던 것만). */
  removed: number
  /** 상태 표기·등록일자·동산이 갱신된 사람 수. */
  marked: number
  /** 명단에 없어서 새로 만든 사람. */
  created: string[]
  /** 누구인지 확실하지 않아 손대지 않은 이름 (동명이인 등). */
  unmatched: string[]
  warnings: string[]
  error?: string
}

export interface SheetSyncRun {
  at: number
  /** 누가 돌렸나: 관리자의 '지금 동기화' · Apps Script의 두드림 · 서버가 스스로 당긴 것. */
  by: 'admin' | 'sheet' | 'auto'
  outcomes: SheetSyncOutcome[]
}

export interface SheetSyncSettings {
  /** 시트에 붙인 Apps Script가 들고 오는 연동 키. */
  token: string
  sources: SheetSource[]
  lastRun: SheetSyncRun | null
  /** Apps Script가 두드릴 주소 (설치 안내에 그대로 보여준다). */
  pingUrl?: string
}

export const getSheetSync = () => api<SheetSyncSettings>('GET', '/api/admin/sheet-sync')

export const addSheetSource = (url: string, title: string, group: string) =>
  api<SheetSyncSettings>('POST', '/api/admin/sheet-sync', { action: 'add-source', url, title, group })

export const removeSheetSource = (id: string, gid: string) =>
  api<SheetSyncSettings>('POST', '/api/admin/sheet-sync', { action: 'remove-source', id, gid })

export const rotateSheetSyncToken = () =>
  api<SheetSyncSettings>('POST', '/api/admin/sheet-sync', { action: 'rotate-token' })

// 시트를 읽는 데는 왕복이 몇 번 걸린다 (시트 내려받기 + 명단 대조 + 쓰기) — 기본 12초로는
// 사람 수가 많은 시트에서 끊긴다.
export const runSheetSync = (sourceId?: string) =>
  api<{ lastRun: SheetSyncRun }>('POST', '/api/admin/sheet-sync/run', { sourceId }, undefined, 60_000)

// ── 동산 리더 링크 ────────────────────────────────────────────────────────────
// 리더가 자기 동산의 **동산모임 출석만** 적는 화면(/dongsan/:token)이 쓰는 손잡이. 로그인이
// 아니라 링크가 신원이라, 여기서 나가는 요청에는 관리자 비밀번호도 구글 토큰도 실리지 않는다.

export interface DongsanBoardMember {
  id: string
  name: string
  group: string
  /** 이 사람의 동산. 부서 링크는 여러 동산이 한 화면에 오므로 이것으로 묶어 그린다. */
  subgroup: string
  // 상태 표기 — lib/status.ts가 읽는 그 칸들 그대로. 귀국·이주처럼 명단에서 빠진 사람이
  // 리더 화면에도 뜨지 않도록, 같은 규칙을 같은 코드로 적용하기 위해 실어 보낸다.
  status_marks?: { note: string; start: string | null; end: string | null }[] | null
  status_note?: string | null
  status_start?: string | null
  status_end?: string | null
}

export interface DongsanBoard {
  partition: Partition
  /** 이 링크가 가리키는 부서. 여름 합동 동산 링크면 빈 문자열. */
  group: string
  /** 이 링크가 가리키는 동산. **비어 있으면 group 부서 전체를 담는 부서 링크다.** */
  subgroup: string
  /** 적을 수 있는 주일들 (오래된 것부터). 서버가 정한다. */
  dates: string[]
  members: DongsanBoardMember[]
  /** 출석한 칸들 — `${memberId}|${date}`. */
  marks: string[]
}

export const getDongsanBoard = (token: string) =>
  api<DongsanBoard>('GET', `/api/dongsan/board?token=${encodeURIComponent(token)}`)

export const markDongsan = (token: string, memberId: string, date: string, present: boolean) =>
  api<{ status: string; present: boolean }>(
    'POST',
    '/api/dongsan/mark',
    { memberId, date, present },
    { 'X-Dongsan-Token': token },
  )

export interface DongsanLink {
  token: string
  group: string
  subgroup: string
  /** 이 링크가 사는 학기 ("2026-fall"). 빈 값이면 학기에 매이지 않은 링크. */
  term: string
  createdAt: number
}

// 링크 자리를 어떻게 그릴지는 서버가 정한 사실 위에서 갈린다 — 지금이 어느 학기인가(term),
// 어느 부서를 시트가 담당하는가(sheetGroups), 이 부의 링크가 학기를 따라 자동으로 나고 지는가
// (auto: 대학·청년부만. 장년부에는 학기가 없어 사람이 내고 거둔다). 규칙을 화면에 옮겨 적으면
// 서버와 어긋나므로 받아서 쓴다.
export interface DongsanLinksState {
  links: DongsanLink[]
  term: string
  sheetGroups: string[]
  auto: boolean
}

export const getDongsanLinks = () => api<DongsanLinksState>('GET', '/api/admin/dongsan-links')

// 링크는 부서 하나짜리뿐이다 — 그 부서의 동산을 다 담는다 (DongsanLinks.tsx의 이유 참고).
// 학기가 있는 부에서는 이 길을 쓸 일이 없다 (학기가 시작할 때 서버가 알아서 낸다).
export const createDongsanLink = (group: string) =>
  api<DongsanLinksState & { created: DongsanLink | null }>('POST', '/api/admin/dongsan-links', {
    action: 'create',
    group,
  })

// 학기 중인 부서 링크를 폐기하면 그 자리에 **새 주소가 곧바로 난다** (서버가 규칙을 다시
// 세운다). 새어 나간 주소를 죽이는 것이 목적이지 그 부서를 학기 도중에 닫는 것이 아니다.
export const revokeDongsanLink = (token: string) =>
  api<DongsanLinksState>('POST', '/api/admin/dongsan-links', { action: 'revoke', token })

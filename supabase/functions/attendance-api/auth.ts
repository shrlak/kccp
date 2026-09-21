// Admin auth + scope helpers for the hardened edge function (spec D1).
//
// Two auth paths, tried in order by resolveAdmin():
//   1. Google JWT (Bearer token): email → members.email → member_roles → role/scope.
//   2. Break-glass: a shared team password alone — works on ANY device, registered or not.
//      여섯이다. **출석 셋**은 명단을 열고, **영역 셋**은 주일 화면과 콘티를 연다:
//        • SUPER_PASSWORD      → "super_admin" role (full panel: settings, admins, backup…)
//        • WELCOMING_PASSWORD  → "welcoming"   role (새가족팀 dashboard, 대학·청년부만)
//        • ADULT_PASSWORD      → "super_admin" role in the **장년부 partition** (see below)
//        • ALL_PASSWORD        → 영역 셋 전부 · 두 부 · 모든 팀 (소유자 이메일과 같은 크기)
//        • MEDIA_PASSWORD      → 슬라이드(PPT) + 콘티. 명단에는 닿지 않는다
//        • PRAISE_PASSWORD     → 콘티만
//      표는 `passwordGrant` 하나다. 영역 셋의 대가는 거기 주석에 적어 두었다.
//      A device that happens to be linked to a roled member keeps that member's scope
//      — **출석 자격일 때만.** 영역 비밀번호는 member_roles를 보지 않는다 (verifyAdmin);
//      otherwise the login gets the password's break-glass role. The two 대학·청년부
//      passwords see that ministry's whole roster (a shared password can't pin to one
//      동산); only SUPER_PASSWORD grants the super_admin powers (settings, admin
//      management, 동산지기/임원, backup).
//      **리더에게는 공용 비밀번호가 없다** — 리더는 구글 로그인으로 들어온다. 자기 동산이
//      곧 리더의 권한 범위인데, 공용 비밀번호는 사람을 가리키지 못해 그 범위를 짚을 수
//      없었다 (그래서 kccpleaders로 들어온 리더는 대학·청년부 명단 전체를 보고 있었다).
// Public check-in stays anonymous and PII-free.
//
// ── PARTITIONS (부) ──────────────────────────────────────────────────────────────────
// The app serves two departments and they must never see each other's people:
// 대학·청년부 ("youth") and 장년부 ("adult"). **The boundary is the Postgres schema.**
// 대학·청년부 lives in `public`, 장년부 in `adult` (migration 20260807) — separate tables,
// separate sequences, separate backups. Reading `public.members` with no filter at all
// returns zero 장년부 people, because they are not in that table.
//
// Every admin carries the partition their credentials belong to (`Role.partition`), and
// `dbOf(sb, partition)` is the single place that turns it into a database handle. Get that
// right and the rest follows: a query can't reach across departments even if someone
// forgets a WHERE clause.
//
// scopeFilter()/inScope() still exist and still matter — they carry the 동산/셀 scoping a
// 리더 needs *within* their own department, and they double as belt-and-braces on the 부서
// (`{all:true, exclude:['장년부']}` for a youth super). But the schema is the real wall.
//
// Wired into index.ts (imports resolveAdmin + dbOf + scopeFilter + inScope) and unit-tested
// (auth.test.ts).

import { createClient } from "jsr:@supabase/supabase-js@2";

// The pure auth/scope unit tests intentionally run without --allow-env. Production edge
// functions grant env access, while a permission-restricted import should still be able to
// exercise the fallback credentials and authorization helpers below.
function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHARED TEAM PASSWORDS — change these lines to rotate them (or set the matching env
//  vars to override without editing code). Each grants admin access from ANY device and
//  lands on its own dashboard, so treat them as secrets and rotate if leaked:
//    • SUPER_PASSWORD     → the full super-admin panel (대학·청년부)
//    • WELCOMING_PASSWORD → the 새가족팀(welcoming) dashboard — **대학·청년부 전용.**
//                           장년부에는 이 역할로 들어오는 비밀번호가 없다.
//    • ADULT_PASSWORD     → the 장년부 panel: the same admin surface, but every query is
//                           pinned to the 장년부 partition, so it never shows — and can
//                           never touch — a 대학부/청년부 member (and vice versa).
//
//  리더 공용 비밀번호(kccpleaders)는 없앴다. 리더의 권한 범위는 자기 동산인데 공용 비밀번호는
//  사람을 가리키지 못해 그 범위를 짚을 수 없었고, 그래서 그 비밀번호로 들어온 리더는 실제로는
//  대학·청년부 명단 전체를 보고 있었다. 리더는 구글 로그인으로 들어온다 — 그때는 members 행이
//  잡히므로 scopeFilter가 자기 동산으로 좁힌다. (이미 기록된 지난 로그인은 그대로 남는다.)
export const SUPER_PASSWORD = readEnv("SUPER_PASSWORD") ?? "kccpadmin";
export const WELCOMING_PASSWORD =
  readEnv("WELCOMING_PASSWORD") ?? readEnv("MASTER_PASSWORD") ?? "kccpwelcome";
export const ADULT_PASSWORD = readEnv("ADULT_PASSWORD") ?? "kccpadults";

// ── 영역을 여는 비밀번호 셋 ───────────────────────────────────────────────────────────
//  **이 셋은 위의 셋과 성질이 다르다.** 위의 셋은 명단(출석)을 열고, 이 셋은 주일 화면과
//  AI 무료 한도를 연다. 원래 이 문은 구글 계정에만 열려 있었다 — 계정은 한 사람만 끊을
//  수 있고 로그인 기록에 이름이 남기 때문이다. 비밀번호는 둘 다 못 한다: 바꾸면 그걸
//  쓰던 모두가 한꺼번에 막히고, 누가 썼는지는 기록에 남지 않는다.
//
//  그럼에도 여는 이유는 운영이다 — 미디어팀·찬양팀은 매 학기 사람이 바뀌는데, 구글
//  계정을 새 사람에게 넘기는 일은 배포할 수 있는 한 사람을 매번 거쳐야 한다. 대가는
//  분명히 적어 둔다: **새면 회수하는 길은 이 값을 바꾸는 것뿐이고, 그러면 그 비밀번호를
//  쓰던 모두가 함께 막힌다.** 새 학기마다 바꾸는 것이 그래서 기본값이어야 한다.
//
//    • ALL_PASSWORD    → 모든 영역 · 두 부(部) · 모든 팀. 소유자 이메일과 같은 크기다.
//    • MEDIA_PASSWORD  → 슬라이드(PPT 생성) + 콘티. 부서 미디어팀 계정의 비밀번호 짝.
//    • PRAISE_PASSWORD → 콘티만. 찬양팀이 올리는 자리.
export const ALL_PASSWORD = readEnv("ALL_PASSWORD") ?? "kccp1980";
export const MEDIA_PASSWORD = readEnv("MEDIA_PASSWORD") ?? "kccpmedia";
export const PRAISE_PASSWORD = readEnv("PRAISE_PASSWORD") ?? "kccppraise";
// Backwards-compat alias for the legacy single break-glass credential (now the welcoming
// password). Kept so older references / env overrides keep working.
export const MASTER_PASSWORD = WELCOMING_PASSWORD;
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  CROSS-PARTITION EMAILS — 두 부를 다 보는 사람.
//
//  보통 한 사람은 한 부에만 산다: 이메일이 어느 스키마의 members에서 나오느냐가 곧 그 사람의
//  부이고, 그것 말고 부에 속하는 길은 없다. 그런데 두 부를 다 맡는 사람이 하나 있다 — 그
//  사람은 로그인한 뒤 **어느 부의 패널로 들어갈지 고른다.**
//
//  두 번째 members 행을 만들어 주는 방법은 쓰지 않았다: 그러면 장년부 명단에 실제 교인이
//  아닌 사람이 한 명 늘고, 출석부·통계·백업이 전부 그 사람을 세게 된다. 부를 고르는 것은
//  **명단이 아니라 신원의 성질**이므로 여기, 인증 쪽에 둔다.
//
//  구글 로그인에만 적용된다. 공용 비밀번호는 그 자체가 부를 뜻하므로(ADULT_PASSWORD →
//  장년부) 고를 것이 없고, 무엇보다 아무나 칠 수 있는 값이라 신원이 아니다.
export const CROSS_PARTITION_EMAILS = readEmails(
  readEnv("CROSS_PARTITION_EMAILS") ?? "spencerkim1235@gmail.com",
);

function readEmails(raw: string): Set<string> {
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// May this email pick its 부 at sign-in? Case-insensitive: Google hands back whatever
// casing the account was typed with, and an address is not case-sensitive.
export function canCrossPartitions(email: string | null | undefined): boolean {
  return !!email && CROSS_PARTITION_EMAILS.has(email.trim().toLowerCase());
}

// A partition name off the wire (the X-Partition header) → the value, or null for anything
// else. The header is a *request*, never a grant: only canCrossPartitions() honors it.
export function readPartition(raw: string | null | undefined): Partition | null {
  const v = (raw || "").trim().toLowerCase();
  return v === "adult" ? "adult" : v === "youth" ? "youth" : null;
}
// ─────────────────────────────────────────────────────────────────────────────

// The 부서 that makes up the 장년부 partition. Everything else is the youth partition.
export const ADULT_GROUP = "장년부";
// 장년부의 표가 사는 스키마. 대학·청년부는 기본 스키마(public)를 그대로 쓴다.
export const ADULT_SCHEMA = "adult";
export type Partition = "youth" | "adult";

// Which partition a 부서 belongs to. The empty/unknown 부서 (guests, legacy rows, staff
// with no 부서) stays with 대학·청년부, which is where those rows have always shown up.
export function partitionOfGroup(group: string | null | undefined): Partition {
  return (group || "") === ADULT_GROUP ? "adult" : "youth";
}

// **The one place a 부 becomes a database handle.** Everything the two departments own —
// 사람·기기·출석·권한·설정·감사기록 — is reached through this, so a query is scoped to a
// department by construction rather than by remembering a filter.
//
// A stored admin grant no longer needs a 부서 to say which 부 it belongs to: it belongs to
// the schema it was found in.
// deno-lint-ignore no-explicit-any
export function dbOf(sb: any, partition: Partition): any {
  return partition === "adult" ? sb.schema(ADULT_SCHEMA) : sb;
}

// ── 영역(Area) ──────────────────────────────────────────────────────────────
// 합쳐진 앱은 출석과 슬라이드를 함께 담는다. 무엇을 볼 수 있는지는 역할이 아니라
// **자격**이 정한다. 자격마다 여는 영역이 다르고, 그 표는 `passwordGrant`(비밀번호)와
// `verifyAdminJwt`(구글 계정) 두 곳뿐이다.
//
// 출석 비밀번호 셋(kccpadmin·kccpwelcome·kccpadults)은 **여전히 출석뿐이다.** 명단은
// 사람의 정보라 영역을 넓혀 줄 이유가 없다 — 슬라이드를 쓰라고 준 비밀번호로 명단이
// 열리면 그것은 기능이 아니라 유출이다. 반대로 영역 비밀번호 셋(kccp1980 제외)은
// 명단에 닿지 않는다: `areas`에 'attend'가 없으면 resolveAdmin이 /api/admin/* 전부를
// 거절한다.
export type Area = "attend" | "slides" | "praise";

// 라우트 접두사 → 필요한 영역. 기본값이 "attend"인 것이 안전 방향이다: 나중에 규칙을
// 빠뜨린 새 라우트가 생기면 **더 좁은 쪽**으로 떨어져 슬라이드 계정이 거부된다.
// 열리는 것이 아니라 막히는 쪽으로 실패한다.
const ROUTE_AREA: ReadonlyArray<[string, Area]> = [
  ["/api/slides/", "slides"],
  ["/api/praise/", "praise"],
];

export function areaOf(pathname: string): Area {
  for (const [prefix, area] of ROUTE_AREA) {
    if (pathname.startsWith(prefix)) return area;
  }
  return "attend";
}

// 부·팀·영역의 모든 경계를 넘는 유일한 자격. 코드가 아니라 설정에 두는 이유는
// LOGIN_LOG_VIEWER_MEMBER_ID와 같다 — 사람이 바뀔 때 배포를 다시 하지 않으려고.
export const OWNER_EMAIL = (readEnv("KCCP_OWNER_EMAIL") ?? "spencerkim1235@gmail.com")
  .trim().toLowerCase();

export function isOwner(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === OWNER_EMAIL;
}

// 부서 미디어팀의 **역할 계정**이다 — 사람이 아니다. 그래서 members에 행을 만들지
// 않는다: 만드는 순간 그 이름이 출석부와 키오스크 명단에 나타난다. 이메일 → 부(部).
//   KCCP_MEDIA_ACCOUNTS="a@x.com:adult,b@y.com:youth" 로 덮어쓸 수 있다.
export const MEDIA_ACCOUNTS: ReadonlyMap<string, Partition> = readMediaAccounts(
  readEnv("KCCP_MEDIA_ACCOUNTS") ??
    "kccpmedia@gmail.com:adult,kccp.bitjulove.media@gmail.com:youth",
);

function readMediaAccounts(raw: string): ReadonlyMap<string, Partition> {
  const out = new Map<string, Partition>();
  for (const entry of raw.split(",")) {
    const [email, part] = entry.split(":").map((x) => (x ?? "").trim());
    const partition = readPartition(part);
    if (email && partition) out.set(email.toLowerCase(), partition);
  }
  return out;
}

// 이 이메일이 미디어 역할 계정이면 그 부를, 아니면 null.
export function mediaPartitionOf(email: string | null | undefined): Partition | null {
  if (!email) return null;
  return MEDIA_ACCOUNTS.get(email.trim().toLowerCase()) ?? null;
}

// 비밀번호 하나가 여는 것 전부. 넓은 것부터 견준다 — 두 값이 같게 설정되면 넓은 쪽이
// 이겨야 한다(좁은 쪽이 이기면 "왜 안 열리지"가 되고, 그 답은 코드를 읽어야 나온다).
// 리더 공용 비밀번호(kccpleaders)는 없앴다 — 위 주석 참조.
export interface PasswordGrant {
  role: "super_admin" | "leader" | "welcoming" | "media" | "praise_leader";
  partition: Partition;
  areas: Area[];
  // 이 비밀번호는 부(部)를 **고른다.** 보통 비밀번호는 그 자체가 부를 뜻하지만(장년부
  // 비밀번호 → 장년부), 영역 비밀번호는 부가 아니라 **일**을 뜻한다 — 미디어팀 하나가
  // 두 부의 슬라이드를 만드는 주가 실제로 있다. 고르는 길은 구글 계정과 똑같다
  // (X-Partition 헤더 → canChoosePartition).
  crossPartition?: boolean;
  // 이 자격에는 **자기 팀이 없고, 대신 아무 팀으로나 일한다.** `team_leaders`의 인도자는
  // 팀이 자격에 적혀 있지만(그래서 묻지 않는다), 공용 비밀번호는 사람을 가리키지 못해
  // 팀도 가리키지 못한다. 그래서 화면이 **묻고**, 서버는 고른 팀을 받아 준다 — 소유자와
  // 같은 모양이다. 그 대가는 이 비밀번호를 아는 사람이 남의 팀 콘티도 열 수 있다는 것이고,
  // 그것이 공용 비밀번호의 성질이다.
  anyTeam?: boolean;
}

export function passwordGrant(password: string): PasswordGrant | null {
  if (!password) return null;
  const attend: Area[] = ["attend"];

  // ── 영역 비밀번호 ──
  // 모든 것을 여는 값. 소유자 이메일과 같은 크기라 가장 먼저 견준다.
  if (password === ALL_PASSWORD) {
    return {
      role: "super_admin",
      partition: "youth",
      areas: ["attend", "slides", "praise"],
      crossPartition: true,
      anyTeam: true,
    };
  }
  // 미디어팀: PPT를 만들고(slides) 그 재료인 콘티를 본다(praise). 출석은 없다.
  if (password === MEDIA_PASSWORD) {
    return {
      role: "media",
      partition: "youth",
      areas: ["slides", "praise"],
      crossPartition: true,
      anyTeam: true,
    };
  }
  // 찬양팀: 콘티만. 부(部)는 **팀이 정하므로** 여기서 고를 것이 없다 — 그래서
  // crossPartition이 없다 (있으면 뜻 없는 물음이 하나 생긴다).
  if (password === PRAISE_PASSWORD) {
    return { role: "praise_leader", partition: "youth", areas: ["praise"], anyTeam: true };
  }

  // ── 출석 비밀번호 (그대로) ──
  if (password === SUPER_PASSWORD) return { role: "super_admin", partition: "youth", areas: attend };
  // 새가족팀 공용 비밀번호는 대학·청년부의 것이다. 장년부에는 짝이 없다.
  if (password === WELCOMING_PASSWORD) return { role: "welcoming", partition: "youth", areas: attend };
  // 장년부 runs its own department end to end, so its shared password is a super_admin —
  // inside the 장년부 partition only. scopeFilter pins it to 장년부 regardless of role.
  if (password === ADULT_PASSWORD) return { role: "super_admin", partition: "adult", areas: attend };
  return null;
}

// The role a password grants, ignoring its partition. Kept as the narrow helper older
// call sites (and tests) use; passwordGrant is the full answer.
export function passwordRole(password: string): PasswordGrant["role"] | null {
  return passwordGrant(password)?.role ?? null;
}

// Roles. "staff" is a legacy combined 리더+새가족팀 break-glass role (no longer minted by the
// password path, which now grants "leader"/"welcoming" directly — kept for back-compat).
// Distinct from a member's is_staff flag, which is unrelated.
export type AdminRole =
  | "super_admin" | "leader" | "pastor" | "welcoming" | "staff"
  // 합치면서 생긴 셋. 전부 출석 명단에는 닿지 않는다 (areas가 막는다).
  | "media"          // 부서 미디어팀 역할 계정 — 자기 부의 슬라이드만
  | "praise_leader"  // 찬양팀 인도자 — 자기 팀의 콘티만
  | "owner";         // 소유자 — 모든 경계를 넘는다

/**
 * 이 로그인이 이끄는 찬양팀. `praise` 영역의 모든 범위가 여기서 나온다 — 어느 예배의
 * 콘티를 올릴 수 있는지도, 그 콘티가 어느 부(部)의 것인지도.
 *
 * **자격이지 요청이 아니다.** 클라이언트가 팀을 보내는 길은 없다: 보낼 수 있으면 그것이
 * 곧 남의 팀 콘티를 덮어쓰는 길이다.
 */
export interface LeaderTeam {
  id: string;
  name: string;
  kind: "praise" | "choir";
  partition: Partition;
}

export interface Role {
  memberId: string;
  role: AdminRole;
  group: string;
  subgroup: string;
  ministry: string;
  // 대학·청년부 or 장년부. Every row this admin may read or write lives in this partition;
  // see scopeFilter/inScope. Derived, never sent by the client — except that a
  // cross-partition email may *ask* for one of the two (see CROSS_PARTITION_EMAILS).
  partition: Partition;
  // The verified Google email this login came in on. Identity, not scope: it decides
  // whether the login may choose its 부 at all. Absent ⇒ a password login, which never can.
  email?: string;
  // The schema `memberId` actually lives in. Normally the same as `partition`; they differ
  // for exactly one case — a cross-partition login working in the *other* 부, where the
  // person is still their own member row back home. Anything that resolves the member (the
  // sign-in log's name) must read this, not `partition`. Absent ⇒ the two are the same.
  memberPartition?: Partition;
  // 이 자격이 들어갈 수 있는 영역. resolveAdmin이 라우트마다 검사한다 — 탭을 숨기는 것은
  // 화면일 뿐이고, 비밀번호는 bearer 자격이라 서버가 막지 않으면 curl 한 번에 뚫린다.
  areas: Area[];
  // 이 자격은 부(部)를 고른다 — 영역 비밀번호가 그렇다 (PasswordGrant.crossPartition).
  // 구글 계정 쪽의 짝은 CROSS_PARTITION_EMAILS이고, 둘을 합쳐 canChoosePartition()이
  // 답한다. 없으면 이 자격의 부는 하나다.
  crossPartition?: boolean;
  // 이 자격에는 자기 팀이 없고 아무 팀으로나 일한다 (PasswordGrant.anyTeam).
  // canPickTeam()이 이것과 소유자를 함께 답한다 — 두 곳에서 따로 물으면 한쪽이 뒤처진다.
  anyTeam?: boolean;
  // 이 사람이 이끄는 찬양팀 — `team_leaders`에 줄이 있을 때만. 없는 것이 보통이다
  // (출석 쪽 자격에는 뜻이 없는 값이다). 소유자는 'praise' 영역을 갖되 팀이 없으므로,
  // 그 화면이 팀을 **묻는다** — 자격에 없는 팀을 자격이 지어내지 않는다.
  team?: LeaderTeam;
}

// What an admin may see. `all` is "the whole partition", which is not the whole table:
// `exclude` lists the 부서 that belong to the OTHER partition and must be filtered out.
export type Scope =
  | { all: true; exclude: string[] }
  | { all: false; groups: string[]; subgroup: string };

// Any device id that is NOT a ROSTER-## seed stub is a real personal device. Admin
// roles may only ever attach to personal devices — never to ROSTER placeholders.
export function isPersonalDevice(deviceId: string): boolean {
  return !!deviceId && !deviceId.startsWith("ROSTER-");
}

// Mirror of the legacy browser ACL, now partition-first:
//
// • 장년부 admins are pinned to 장년부 — always, whatever their role. A 장년부 리더 is
//   additionally pinned to their 동산; every other 장년부 role sees the whole 장년부
//   roster. 여름 합동 never applies here (that is a 대학·청년부 arrangement).
// • 대학·청년부 super/pastor/staff see everything in their partition, i.e. everything
//   EXCEPT 장년부 — which is why `all` carries an `exclude` list instead of meaning
//   "no filter at all".
// • A 대학·청년부 leader or 새가족팀(welcoming) member is scoped to their 부서 + 동산.
//   A "합동" group spans BOTH 대학부·청년부 in EVERY season (the shared 임원 account); in
//   summer mode a 대학부/청년부 scope is likewise promoted to 합동 — so during 여름동산 a
//   새가족팀원 sees both 부서, while in 봄/가을동산 a 대학부 새가족팀원 sees only 대학부
//   and a 청년부 새가족팀원 only 청년부. The subgroup always pins to their 동산.
export function scopeFilter(role: Role, summerMode: boolean): Scope {
  if (role.partition === "adult") {
    // A 장년부 리더 with a stored 동산 keeps that 동산; the shared 장년부 password (and
    // every other 장년부 role) sees the whole 장년부 roster.
    const subgroup = role.role === "leader" ? role.subgroup : "";
    return { all: false, groups: [ADULT_GROUP], subgroup };
  }
  // super/pastor see their whole partition; staff (legacy break-glass) too.
  if (role.role === "super_admin" || role.role === "pastor" || role.role === "staff") {
    return { all: true, exclude: [ADULT_GROUP] };
  }
  // Password-only (break-glass) leader/welcoming logins have no linked member (memberId="")
  // to scope to, so they see the whole 대학·청년부 roster — a shared team password can't pin
  // to one person's 부서/동산. Real roled leaders/welcoming members always carry a memberId.
  if ((role.role === "leader" || role.role === "welcoming") && !role.memberId) {
    return { all: true, exclude: [ADULT_GROUP] };
  }
  if (role.role === "leader" || role.role === "welcoming") {
    const combined = role.group === "합동" ||
      (summerMode && (role.group === "대학부" || role.group === "청년부"));
    const groups = combined ? ["대학부", "청년부"] : [role.group].filter(Boolean);
    return { all: false, groups, subgroup: role.subgroup };
  }
  // any other scoped role
  return { all: false, groups: [role.group].filter(Boolean), subgroup: role.subgroup };
}

// Is this 부서/동산 inside the scope? THE membership test — every per-row authorization
// check in index.ts goes through here, super admins included, because `all` no longer
// means "everything in the table" (it excludes the other partition).
export function inScope(scope: Scope, group: string | null | undefined, subgroup?: string | null): boolean {
  if (!inScopeGroup(scope, group)) return false;
  if (!scope.all && scope.subgroup && (subgroup || "") !== scope.subgroup) return false;
  return true;
}

// The 부서 half of the test on its own — "may this admin file someone under this 부서?".
// Used where the thing being checked is a DESTINATION rather than an existing row: the 부서
// a member is being moved to, a 새가족 is being registered into, a 방문자 is tagged with.
// Deliberately ignores the 동산: a 동산-scoped 리더 registering a 새가족 in their own 부서
// hasn't picked a 동산 yet (it's assigned later), and requiring one would reject the save.
export function inScopeGroup(scope: Scope, group: string | null | undefined): boolean {
  const g = group || "";
  if (scope.all) return !scope.exclude.includes(g);
  return scope.groups.includes(g);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN-LOG VIEWER — the sign-in history (who logged in, when, from which IP and
//  approximate place) is personal-audit data, so it is NOT a general super-admin feature:
//  only 김호연 may read it. He is pinned by his members-table UUID (env-overridable), and
//  the sign-in must be attributable to that member row — via his linked personal device or
//  his Google email. A shared team password typed on an unlinked device (memberId "")
//  never qualifies, even though it grants super_admin, because anyone could type it.
//
//  login_log는 부서를 가리지 않는 **시스템 전체의 기록**(공용 표)이라 어느 부의 패널에서 보든
//  같은 목록이다. 그래서 이 사람이 부를 건너가도 권한이 따라간다 — memberId에 걸려 있고, 그
//  UUID는 부를 건너가도 그대로이기 때문이다 (memberPartition이 그 행이 사는 곳을 가리킨다).
export const LOGIN_LOG_VIEWER_MEMBER_ID =
  readEnv("LOGIN_LOG_VIEWER_MEMBER_ID") ?? "e45e9708-9d44-418d-9ff5-734adf81fa68"; // 김호연
// ─────────────────────────────────────────────────────────────────────────────

export function canViewLoginLog(role: Role | null): boolean {
  return !!role && role.role === "super_admin" && !!role.memberId &&
    role.memberId === LOGIN_LOG_VIEWER_MEMBER_ID;
}

// 로그인한 뒤 부를 고를 수 있는가 — 패널이 "어느 부로 들어갈까요" 화면을 띄울지 정하는 값.
// 구글 로그인에만 해당한다 (비밀번호 로그인은 role.email이 비어 있다).
export function canChoosePartition(role: Role | null): boolean {
  // 두 길이 있다: 구글 계정(CROSS_PARTITION_EMAILS)과 영역 비밀번호(crossPartition).
  // 한 함수가 둘 다 답해야 호출부가 어느 길로 들어왔는지 몰라도 된다 — 지금 이 값을
  // 읽는 곳이 슬라이드 라우트 여섯이고, 거기서 갈라지기 시작하면 한쪽이 뒤처진다.
  return !!role && (role.crossPartition === true || canCrossPartitions(role.email));
}

/**
 * 이 자격이 **아무 팀으로나** 콘티를 다룰 수 있는가.
 *
 * 인도자는 팀이 자격에 적혀 있어서(`role.team`) 이 물음이 필요 없다. 필요한 것은 팀이
 * 없는 자격 — 소유자와 영역 비밀번호다. 그 둘은 화면에서 팀을 **고르고**, 서버는 고른
 * 팀을 받아 준다.
 *
 * 한 곳에 두는 이유: 이 판단이 세 라우트(`/api/praise/setlists` · `/conti` · 콘티 한 줄
 * 만지기)에 흩어져 있었고, 흩어진 판단은 새 자격이 생길 때 **한 곳만 고쳐진다.**
 */
export function canPickTeam(role: Role | null | undefined): boolean {
  return !!role && (role.role === "owner" || role.anyTeam === true);
}

type SB = ReturnType<typeof createClient>;

// Verify an admin via a shared team password. Any of the three passwords grants access
// from ANY device — no registration required and the device id is irrelevant (so staff can
// sign in from a phone, a borrowed laptop, a fresh browser, etc.). If the device happens to
// be a personal one linked to a member who holds a scoped role, that member's scope is
// preserved; otherwise the login gets the role the password maps to (SUPER_PASSWORD →
// "super_admin", WELCOMING_PASSWORD → "welcoming", ADULT_PASSWORD → "super_admin" in the
// 장년부 partition). Returns null only when the password matches none of them.
export async function verifyAdmin(
  sb: SB,
  deviceId: string,
  password: string,
  wanted?: Partition | null,
): Promise<Role | null> {
  const grant = passwordGrant(password);
  if (!grant) return null;
  // 영역 비밀번호는 부를 **고른다** — X-Partition을 읽는다. 출석 비밀번호는 그 자체가
  // 부를 뜻하므로 헤더를 보지 않는다 (보면 장년부 비밀번호로 대학·청년부가 열린다).
  const partition = grant.crossPartition ? (readPartition(wanted ?? null) ?? grant.partition) : grant.partition;
  const extra = {
    ...(grant.crossPartition ? { crossPartition: true } : {}),
    ...(grant.anyTeam ? { anyTeam: true } : {}),
  };
  // 기기에 걸린 역할을 물려받는 것은 **출석 자격일 때만** 뜻이 있다. member_roles는 출석
  // 쪽 역할표라, 슬라이드·콘티만 여는 비밀번호가 거기서 super_admin을 주워 오면 역할은
  // 넓어지고 영역은 그대로인 이상한 자격이 된다 — 그 조합은 아무도 의도하지 않았다.
  if (grant.areas.includes("attend") && isPersonalDevice(deviceId)) {
    // Look only in the schema the typed password belongs to. That is what keeps a device's
    // stored grant from crossing departments: the 장년부 password on a 청년부 리더's phone
    // searches `adult.devices`, doesn't find them, and falls through to break-glass.
    const db = dbOf(sb, partition);
    const { data: dev } = await db.from("devices").select("member_id").eq("id", deviceId).single();
    const memberId = (dev as { member_id?: string } | null)?.member_id;
    if (memberId) {
      const { data: r } = await db.from("member_roles").select("*").eq("member_id", memberId).single();
      if (r) {
        const row = r as { role: AdminRole; group_name?: string; subgroup?: string; ministry?: string };
        return {
          memberId,
          role: row.role,
          group: row.group_name || "",
          subgroup: row.subgroup || "",
          ministry: row.ministry || "",
          partition,
          email: "",
          memberPartition: partition,
          areas: grant.areas,
          ...extra,
        };
      }
    }
  }
  // Break-glass: correct team password on a device with no linked admin role → the role the
  // password maps to, scoped to that password's partition. memberId is empty (no member to
  // attribute) — safe because every role.memberId lookup downstream is gated behind a
  // leader/welcoming/staff role check (super_admin paths key off role.role and audit via
  // the device id), and scopeFilter still pins the login to its own partition.
  return {
    memberId: "",
    role: grant.role,
    group: "",
    subgroup: "",
    ministry: "",
    partition,
    email: "",
    memberPartition: partition,
    areas: grant.areas,
    ...extra,
  };
}

// Verify via Supabase JWT (Google sign-in path). Resolves email → member → role. Both
// departments are searched, 대학·청년부 first; **whichever schema the member turns up in is
// the 부 they get** — there is no other way to belong to one. 그러니 어떤 이메일을 어느
// 스키마의 멤버에 붙이느냐가 곧 "이 사람은 로그인하면 어느 부를 보는가"이다.
//
// 예외가 하나 있다: CROSS_PARTITION_EMAILS의 이메일은 `wanted`로 부를 **고른다.** 고른 부에
// 자기 members 행이 없으면(보통 그렇다 — 그 사람은 한쪽 부의 교인이다) 그 부의 super_admin
// 으로 들어가되, 저쪽 부의 자리를 뜻하는 부서·동산은 지우고 간다. memberId는 그대로 들고
// 가고 memberPartition이 그 행이 사는 스키마를 가리킨다 — 로그인 기록에 이름이 남아야 하고,
// 로그인 기록 열람 권한도 그 UUID에 걸려 있기 때문이다.
export async function verifyAdminJwt(sb: SB, jwt: string, wanted?: Partition | null): Promise<Role | null> {
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user?.email) return null;
  const email = user.email;

  // 부서 미디어팀 역할 계정. **사람이 아니라 부서**라 members 행이 없고, 있어서도 안
  // 된다 — 있으면 그 이름이 출석부와 키오스크 명단에 나타난다. 영역이 슬라이드뿐이라
  // 이 계정으로는 명단에 닿을 수 없다(resolveAdmin이 막는다).
  const mediaPartition = mediaPartitionOf(email);
  if (mediaPartition) {
    return {
      memberId: "",
      role: "media",
      group: "",
      subgroup: "",
      ministry: "",
      partition: mediaPartition,
      email,
      areas: ["slides"],
    };
  }

  const resolved = await resolveMemberLogin(sb, email, wanted);

  // 찬양팀 인도자. 소유자와 같은 모양이다 — **신원을 대체하지 않고 영역만 넓힌다.**
  // members 행이 있는 인도자(출석 쪽 역할도 가진 사람)는 그 사람으로 남아야 로그인
  // 기록에 이름이 남고, 없는 인도자도 들어올 수 있어야 콘티가 올라온다.
  //
  // 부(部)는 **팀이 정한다**: 인도자가 어느 부 교인이냐가 아니라 어느 팀을 이끄느냐가
  // 그 콘티가 어느 예배의 것인지를 정하기 때문이다 (헵시바는 장년부, 주랑은 대학·청년부).
  const team = await praiseTeamOf(sb, email);
  if (team && !isOwner(email)) {
    if (resolved) {
      return { ...resolved, areas: [...resolved.areas, "praise"], team };
    }
    return {
      memberId: "",
      role: "praise_leader",
      group: "",
      subgroup: "",
      ministry: "",
      partition: team.partition,
      email,
      areas: ["praise"],
      team,
    };
  }

  // 소유자는 **신원을 대체하지 않고 영역만 넓힌다.** members 행이 있으면 그 사람으로
  // 남아야 하기 때문이다 — 로그인 기록에 남는 이름도, 로그인 기록 열람 권한도 그
  // memberId에 걸려 있다. 갈아치우면 그 둘이 조용히 사라진다.
  if (isOwner(email)) {
    const owned: Area[] = ["attend", "slides", "praise"];
    if (resolved) return { ...resolved, areas: owned, ...(team ? { team } : {}) };
    // 명단에 행이 없는 소유자 — 그래도 들어올 수 있어야 한다.
    return {
      memberId: "",
      role: "owner",
      group: "",
      subgroup: "",
      ministry: "",
      partition: readPartition(wanted ?? null) ?? "youth",
      email,
      areas: owned,
      ...(team ? { team } : {}),
    };
  }
  return resolved;
}

// 이메일 → members 행 → 역할. verifyAdminJwt에서 갈라낸 안쪽 절반이다: 소유자 판정이
// 이 결과를 **감싸야** 하므로(대체가 아니라) 따로 서 있어야 한다.
async function resolveMemberLogin(
  sb: SB,
  email: string,
  wanted?: Partition | null,
): Promise<Role | null> {
  const cross = canCrossPartitions(email);
  // 고를 수 있는 사람이 고른 부를 먼저 찾는다 — 양쪽에 행이 있다면 고른 쪽이 이겨야 한다.
  const order: Partition[] = cross && wanted === "adult" ? ["adult", "youth"] : ["youth", "adult"];
  for (const partition of order) {
    const db = dbOf(sb, partition);
    // 사람 하나가 이메일 둘을 쓸 수 있다 (사역용 · 개인용). 어느 쪽으로 들어와도 같은 사람이다
    // — 20260811의 email_alt. 따옴표로 감싸 값 안의 쉼표·괄호가 필터 문법으로 읽히지 않게 한다.
    const needle = email.replace(/["\\]/g, "");
    const { data: member } = await db
      .from("members")
      .select("id")
      .or(`email.ilike."${needle}",email_alt.ilike."${needle}"`)
      .limit(1)
      .maybeSingle();
    const memberId = (member as { id?: string } | null)?.id;
    if (!memberId) continue;
    const { data: r } = await db.from("member_roles").select("*").eq("member_id", memberId).single();
    if (!r) continue;
    const row = r as { role: AdminRole; group_name?: string; subgroup?: string; ministry?: string };
    const home: Role = {
      memberId,
      role: row.role,
      group: row.group_name || "",
      subgroup: row.subgroup || "",
      ministry: row.ministry || "",
      partition,
      email,
      memberPartition: partition,
      // 사람으로 들어온 로그인은 역할이 있으면 출석을 갖는다. 슬라이드는 dept_roles로
      // 따로 주는 자리를 남겨 둔다 — 언젠가 "누가 만들었는지" 이름으로 남기고 싶어지면
      // 공용 계정을 건드리지 않고 그 사람에게 한 줄만 주면 된다.
      areas: ["attend"],
    };
    // 고를 수 있는 사람이 자기 행이 없는 쪽을 골랐다: 그 부의 super_admin으로 건너간다.
    // 부서·동산을 비우는 이유 — 그것들은 **저쪽 부의 이름**이라 여기서는 뜻이 없고, 남겨 두면
    // scopeFilter가 있지도 않은 동산으로 명단을 좁힐 수 있다. (장년부 super_admin은 부서·동산
    // 없이 자기 부 전체를 본다.)
    if (cross && wanted && wanted !== partition) {
      return { ...home, role: "super_admin", group: "", subgroup: "", ministry: "", partition: wanted };
    }
    return home;
  }
  return null;
}

/**
 * 이 이메일이 이끄는 찬양팀 — `team_leaders` 의 살아 있는 줄 하나.
 *
 * 이메일 하나에 팀 하나인 것은 데이터베이스가 지킨다 (`team_leaders_one_team_per_email`).
 * 그래도 `limit(1)` 을 두는 이유는, 그 제약이 언젠가 풀렸을 때 이 함수가 **아무것도
 * 돌려주지 않는 쪽으로** 깨지지 않게 하기 위해서다 — 인도자가 로그인하지 못하는 실패는
 * 주일 아침에 발견된다.
 *
 * 팀이 `active=false` 면 인도자도 아니다: 팀이 없어진 뒤에도 남아 있는 자격은, 회수할 수
 * 있는 자격을 쓰기로 한 이유를 조용히 지운다.
 */
export async function praiseTeamOf(sb: SB, email: string): Promise<LeaderTeam | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  const { data } = await sb
    .from("team_leaders")
    .select("email, team_id, teams!inner(id, name, kind, partition, active)")
    .ilike("email", needle)
    .eq("active", true)
    .eq("teams.active", true)
    .limit(1)
    .maybeSingle();

  // ilike 로 찾고 **다시 정확히 견준다.** ilike 의 패턴에서 `_` 는 아무 글자 하나를
  // 뜻하는데 `_` 는 이메일에 쓸 수 있는 글자다 — 그래서 `a_b@x.com` 으로 들어온 로그인이
  // `axb@x.com` 의 줄을 집어 올 수 있다. 둘 다 실재하는 인도자라도 **팀이 다르면 남의 팀
  // 콘티를 여는 것**이고, 그 잘못은 콘티가 엉뚱한 예배에 앉은 주일 아침에야 드러난다.
  // (대소문자를 무시해야 해서 eq 를 쓸 수 없는 자리이고, 견주기는 공짜다.)
  const found = data as { email?: string; teams?: unknown } | null;
  if ((found?.email ?? "").trim().toLowerCase() !== needle) return null;

  // PostgREST 의 임베드는 관계에 따라 객체 하나이거나 배열이다. 여기서는 팀이 하나뿐인
  // 관계이지만, 두 모양을 다 읽어 둔다 — 틀리면 인도자가 로그인하지 못한다.
  const raw = found?.teams;
  const row = (Array.isArray(raw) ? raw[0] : raw) as
    | { id?: string; name?: string; kind?: string; partition?: string }
    | undefined;
  const partition = readPartition(row?.partition ?? null);
  if (!row?.id || !partition) return null;
  return {
    id: row.id,
    name: row.name || "",
    kind: row.kind === "choir" ? "choir" : "praise",
    partition,
  };
}

// Unified resolver: try Google JWT first (Authorization: Bearer), fall back to
// device + master password. All hardened admin endpoints call this.
//
// X-Partition is the panel's *request* for a 부, sent on every call once a login that may
// choose one has picked it. It is not a grant and cannot become one: verifyAdminJwt honors
// it only for CROSS_PARTITION_EMAILS, and verifyAdmin only for a grant with
// `crossPartition` (the 영역 비밀번호). **출석 비밀번호는 읽지도 않는다** — 그 값은 이미
// 부 하나를 뜻하므로, 읽으면 장년부 비밀번호로 대학·청년부가 열린다.
export async function resolveAdmin(sb: SB, req: Request): Promise<Role | null> {
  const role = await resolveIdentity(sb, req);
  if (!role) return null;
  // 영역 검사. 여기 하나에 두는 이유는, 굳은 라우트가 전부 이 함수를 지나기 때문이다 —
  // 호출부를 한 줄도 고치지 않고 표면 전체가 덮인다. 탭을 숨기는 것으로는 아무것도
  // 지켜지지 않는다: 슬라이드 계정이 /api/admin/list 를 curl하면 명단이 나와야 할 이유가
  // 없고, 막는 것은 화면이 아니라 여기다.
  const wanted = areaOf(new URL(req.url).pathname);
  if (!role.areas.includes(wanted)) return null;
  return role;
}

// 자격 → 신원. 영역 검사를 하지 않는 안쪽 절반 — 로그인 화면이 "이 사람은 어느 영역을
// 갖고 있나"를 물어야 하므로(어디로 보낼지 정하려고) 그 물음에는 문이 열려 있어야 한다.
export async function resolveIdentity(sb: SB, req: Request): Promise<Role | null> {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) {
    return verifyAdminJwt(sb, auth.slice(7), readPartition(req.headers.get("x-partition")));
  }
  const deviceId = req.headers.get("x-device-id") || req.headers.get("X-Device-Id") || "";
  // X-Partition은 여기서도 **요청일 뿐이다.** verifyAdmin이 grant.crossPartition인
  // 비밀번호에만 적용한다 — 출석 비밀번호는 읽지도 않는다.
  return verifyAdmin(
    sb,
    deviceId,
    req.headers.get("x-admin-password") || "",
    readPartition(req.headers.get("x-partition")),
  );
}

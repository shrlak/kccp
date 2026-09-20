// Run with: deno test supabase/functions/attendance-api/auth.test.ts
// (Deno isn't part of the local web toolchain; these run where Deno is available —
//  local `supabase functions` / CI.)
import { assertEquals } from "jsr:@std/assert";
import {
  ADULT_GROUP,
  ADULT_PASSWORD,
  ADULT_SCHEMA,
  isPersonalDevice,
  inScope,
  inScopeGroup,
  partitionOfGroup,
  scopeFilter,
  dbOf,
  verifyAdmin,
  passwordGrant,
  passwordRole,
  canViewLoginLog,
  canChoosePartition,
  canCrossPartitions,
  readPartition,
  verifyAdminJwt,
  CROSS_PARTITION_EMAILS,
  LOGIN_LOG_VIEWER_MEMBER_ID,
  SUPER_PASSWORD,
  WELCOMING_PASSWORD,
  MASTER_PASSWORD,
  type Role,
  type Scope,
  areaOf,
  isOwner,
  mediaPartitionOf,
  OWNER_EMAIL,
  MEDIA_ACCOUNTS,
  resolveAdmin,
  resolveIdentity,
} from "./auth.ts";

const leader: Role = {
  memberId: "m", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM", partition: "youth", areas: ["attend"] };
// 두 부를 다 맡는 계정의 이메일 — 기본값 하나뿐이지만, 목록에서 읽어 와 환경변수로 바꿔도
// 테스트가 따라가게 한다.
const CROSS_EMAIL = [...CROSS_PARTITION_EMAILS][0];
// 대학·청년부 "everything" is everything except the other partition.
const YOUTH_ALL: Scope = { all: true, exclude: [ADULT_GROUP] };

// Minimal chainable Supabase stub. `data` is the public (대학·청년부) schema; `adultData`
// is what `.schema('adult')` sees — the two are genuinely different tables here, which is
// the whole point of the split.
// deno-lint-ignore no-explicit-any
function mockSb(data: Record<string, any>, adultData: Record<string, any> = {}, email?: string): any {
  // deno-lint-ignore no-explicit-any
  const handle = (rows: Record<string, any>): any => ({
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        or: () => chain,
        limit: () => chain,
        single: () => Promise.resolve({ data: rows[table] ?? null }),
        maybeSingle: () => Promise.resolve({ data: rows[table] ?? null }),
      };
      return chain;
    },
  });
  const publicHandle = handle(data);
  return {
    ...publicHandle,
    schema: (name: string) => (name === "adult" ? handle(adultData) : publicHandle),
    auth: { getUser: () => Promise.resolve({ data: { user: email ? { email } : null } }) },
  };
}

Deno.test("isPersonalDevice: ROSTER stubs are not personal", () => {
  assertEquals(isPersonalDevice("ROSTER-44"), false);
  assertEquals(isPersonalDevice("DEV-B5D13150-CCFD0D1F"), true);
  assertEquals(isPersonalDevice("NEW-1780798747776"), true);
  assertEquals(isPersonalDevice(""), false);
});

Deno.test("partitionOfGroup: only 장년부 is the adult partition", () => {
  assertEquals(partitionOfGroup(ADULT_GROUP), "adult");
  assertEquals(partitionOfGroup("대학부"), "youth");
  assertEquals(partitionOfGroup("청년부"), "youth");
  assertEquals(partitionOfGroup("EM"), "youth");
  // guests / legacy rows with no 부서 stay where they have always shown up
  assertEquals(partitionOfGroup(""), "youth");
  assertEquals(partitionOfGroup(null), "youth");
});

Deno.test("passwordRole: maps each password to its break-glass role", () => {
  assertEquals(passwordRole(SUPER_PASSWORD), "super_admin");
  assertEquals(passwordRole(WELCOMING_PASSWORD), "welcoming");
  assertEquals(passwordRole("nope"), null);
  assertEquals(passwordRole(""), null);
});

Deno.test("passwordGrant: the 장년부 password is a super_admin in the adult partition", () => {
  assertEquals(passwordGrant(ADULT_PASSWORD), { role: "super_admin", partition: "adult", areas: ["attend"] });
  assertEquals(passwordGrant(SUPER_PASSWORD), { role: "super_admin", partition: "youth", areas: ["attend"] });
  assertEquals(passwordGrant(WELCOMING_PASSWORD), { role: "welcoming", partition: "youth", areas: ["attend"] });
  assertEquals(passwordGrant("nope"), null);
});

Deno.test("MASTER_PASSWORD aliases the welcoming password (back-compat)", () => {
  assertEquals(MASTER_PASSWORD, WELCOMING_PASSWORD);
});

Deno.test("verifyAdmin: wrong password is rejected (no DB hit)", async () => {
  const r = await verifyAdmin(mockSb({}), "DEV-anything", "nope");
  assertEquals(r, null);
});

Deno.test("verifyAdmin: super password grants break-glass 'super_admin' from an unregistered device", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", SUPER_PASSWORD);
  assertEquals(r, { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth", email: "", memberPartition: "youth", areas: ["attend"] });
});

Deno.test("verifyAdmin: welcoming password grants break-glass 'welcoming' from an unregistered device", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", WELCOMING_PASSWORD);
  assertEquals(r, { memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "", partition: "youth", email: "", memberPartition: "youth", areas: ["attend"] });
});

Deno.test("verifyAdmin: the 장년부 password lands in the adult partition", async () => {
  const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", ADULT_PASSWORD);
  assertEquals(r, { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult", email: "", memberPartition: "adult", areas: ["attend"] });
});

Deno.test("verifyAdmin: a password works on a ROSTER/blank device too", async () => {
  assertEquals((await verifyAdmin(mockSb({}), "ROSTER-12", SUPER_PASSWORD))?.role, "super_admin");
  assertEquals((await verifyAdmin(mockSb({}), "", WELCOMING_PASSWORD))?.role, "welcoming");
});

Deno.test("verifyAdmin: a registered device linked to a leader keeps that scope", async () => {
  const r = await verifyAdmin(
    mockSb({
      devices: { member_id: "m1" },
      member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산", ministry: "KM" },
    }),
    "DEV-KNOWN-01",
    MASTER_PASSWORD,
  );
  assertEquals(r, {
    memberId: "m1", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM", partition: "youth",
    email: "", memberPartition: "youth",
      areas: ["attend"],
  });
});

Deno.test("verifyAdmin: a 장년부 리더's phone keeps that scope under the 장년부 password", async () => {
  const r = await verifyAdmin(
    mockSb({}, {
      devices: { member_id: "a1" },
      member_roles: { role: "leader", group_name: ADULT_GROUP, subgroup: "1셀", ministry: "" },
    }),
    "DEV-KNOWN-02",
    ADULT_PASSWORD,
  );
  assertEquals(r, {
    memberId: "a1", role: "leader", group: ADULT_GROUP, subgroup: "1셀", ministry: "", partition: "adult",
    email: "", memberPartition: "adult",
      areas: ["attend"],
  });
});

Deno.test("verifyAdmin: a device's grant never crosses partitions", async () => {
  // 장년부 비밀번호는 adult 스키마만 뒤진다. 청년부 리더의 기기 기록은 public에 있으므로
  // 찾지 못하고 break-glass로 떨어진다 — 스키마가 곧 경계다.
  const crossed = await verifyAdmin(
    mockSb({
      devices: { member_id: "m1" },
      member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산", ministry: "KM" },
    }),
    "DEV-KNOWN-01",
    ADULT_PASSWORD,
  );
  assertEquals(crossed, {
    memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult",
    email: "", memberPartition: "adult", areas: ["attend"],
  });
  // …그리고 그 반대도 마찬가지.
  const other = await verifyAdmin(
    mockSb({}, {
      devices: { member_id: "a1" },
      member_roles: { role: "leader", group_name: ADULT_GROUP, subgroup: "1셀", ministry: "" },
    }),
    "DEV-KNOWN-02",
    SUPER_PASSWORD,
  );
  assertEquals(other?.partition, "youth");
  assertEquals(other?.memberId, "");
});

// dbOf가 부(部)를 데이터베이스 손잡이로 바꾸는 유일한 자리다.
Deno.test("dbOf: 장년부만 adult 스키마로 간다", () => {
  const marker = { schema: (name: string) => ({ picked: name }) };
  assertEquals(dbOf(marker, "adult"), { picked: ADULT_SCHEMA });
  assertEquals(dbOf(marker, "youth"), marker);
});

Deno.test("super_admin sees their whole partition — everything except 장년부", () => {
  const s: Role = { memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth", areas: ["attend"] };
  assertEquals(scopeFilter(s, false), YOUTH_ALL);
});

Deno.test("pastor sees the 대학·청년부 roster (read-only is enforced elsewhere)", () => {
  const s: Role = { memberId: "m", role: "pastor", group: "", subgroup: "", ministry: "", partition: "youth", areas: ["attend"] };
  assertEquals(scopeFilter(s, false), YOUTH_ALL);
});

Deno.test("staff (break-glass) sees the whole 대학·청년부 roster, like super/pastor", () => {
  const s: Role = { memberId: "", role: "staff", group: "", subgroup: "", ministry: "", partition: "youth", areas: ["attend"] };
  assertEquals(scopeFilter(s, false), YOUTH_ALL);
  assertEquals(scopeFilter(s, true), YOUTH_ALL);
});

Deno.test("break-glass leader/welcoming (no memberId) see the whole 대학·청년부 roster", () => {
  const bgLeader: Role = { memberId: "", role: "leader", group: "", subgroup: "", ministry: "", partition: "youth", areas: ["attend"] };
  const bgWelcoming: Role = { memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "", partition: "youth", areas: ["attend"] };
  assertEquals(scopeFilter(bgLeader, false), YOUTH_ALL);
  assertEquals(scopeFilter(bgLeader, true), YOUTH_ALL);
  assertEquals(scopeFilter(bgWelcoming, false), YOUTH_ALL);
  assertEquals(scopeFilter(bgWelcoming, true), YOUTH_ALL);
});

Deno.test("leader is scoped to their group+subgroup in semester mode", () => {
  assertEquals(scopeFilter(leader, false), { all: false, groups: ["청년부"], subgroup: "건영동산" });
});

Deno.test("KM leader spans both depts in summer mode (합동)", () => {
  assertEquals(scopeFilter(leader, true), { all: false, groups: ["대학부", "청년부"], subgroup: "건영동산" });
});

Deno.test("합동 leader spans both 부서 in EVERY season (임원 account)", () => {
  const s: Role = { memberId: "m", role: "leader", group: "합동", subgroup: "", ministry: "KM", partition: "youth", areas: ["attend"] };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
  assertEquals(scopeFilter(s, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
});

Deno.test("welcoming is scoped to its group in semester mode (봄/가을동산)", () => {
  const s: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM", partition: "youth", areas: ["attend"] };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["청년부"], subgroup: "" });
});

Deno.test("welcoming spans both 부서 in summer mode (여름동산 합동)", () => {
  const univ: Role = { memberId: "m", role: "welcoming", group: "대학부", subgroup: "", ministry: "KM", partition: "youth", areas: ["attend"] };
  const young: Role = { memberId: "m", role: "welcoming", group: "청년부", subgroup: "", ministry: "KM", partition: "youth", areas: ["attend"] };
  assertEquals(scopeFilter(univ, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
  assertEquals(scopeFilter(young, true), { all: false, groups: ["대학부", "청년부"], subgroup: "" });
});

Deno.test("장년부 admins are pinned to 장년부 — summer 합동 never applies", () => {
  const adultSuper: Role = {
    memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult", areas: ["attend"],
  };
  assertEquals(scopeFilter(adultSuper, false), { all: false, groups: [ADULT_GROUP], subgroup: "" });
  assertEquals(scopeFilter(adultSuper, true), { all: false, groups: [ADULT_GROUP], subgroup: "" });
  // a 장년부 리더 additionally keeps their 동산
  const adultLeader: Role = {
    memberId: "a1", role: "leader", group: ADULT_GROUP, subgroup: "1구역", ministry: "", partition: "adult", areas: ["attend"] };
  assertEquals(scopeFilter(adultLeader, true), { all: false, groups: [ADULT_GROUP], subgroup: "1구역" });
});

Deno.test("inScope: the two partitions can never see each other", () => {
  const youth = scopeFilter(
    { memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth", areas: ["attend"] },
    false,
  );
  const adult = scopeFilter(
    { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult", areas: ["attend"] },
    false,
  );
  assertEquals(inScope(youth, "청년부", "건영동산"), true);
  assertEquals(inScope(youth, ""), true); // guests / 미지정 stay with 대학·청년부
  assertEquals(inScope(youth, ADULT_GROUP), false);
  assertEquals(inScope(adult, ADULT_GROUP, "1구역"), true);
  assertEquals(inScope(adult, "청년부"), false);
  assertEquals(inScope(adult, ""), false);
});

Deno.test("inScope: a 동산-scoped leader only reaches their own 동산", () => {
  const s = scopeFilter(leader, false);
  assertEquals(inScope(s, "청년부", "건영동산"), true);
  assertEquals(inScope(s, "청년부", "다른동산"), false);
  assertEquals(inScope(s, "대학부", "건영동산"), false);
});

// 목적지 부서 검사는 동산을 보지 않는다: 동산에 묶인 리더가 자기 부서에 새가족을 등록할 때
// 동산은 아직 정해지지 않았고, 멤버 정보를 고쳐 저장할 때도 부서 칸은 늘 함께 실려 온다.
// 여기서 동산까지 요구하면 그 평범한 저장들이 전부 403이 된다.
Deno.test("inScopeGroup: 목적지 부서만 본다 — 동산은 묻지 않는다", () => {
  const s = scopeFilter(leader, false);
  assertEquals(inScopeGroup(s, "청년부"), true);   // 동산 없이도 통과
  assertEquals(inScope(s, "청년부"), false);        // inScope는 여전히 동산을 요구한다
  assertEquals(inScopeGroup(s, "대학부"), false);   // 다른 부서는 그대로 막힌다
  const adult = scopeFilter(
    { memberId: "", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "adult", areas: ["attend"] },
    false,
  );
  assertEquals(inScopeGroup(adult, ADULT_GROUP), true);
  assertEquals(inScopeGroup(adult, "청년부"), false);
});

Deno.test("canViewLoginLog: only the designated member, and only as super_admin", () => {
  const viewer: Role = {
    memberId: LOGIN_LOG_VIEWER_MEMBER_ID, role: "super_admin", group: "대학부", subgroup: "호연동산", ministry: "",
    partition: "youth", areas: ["attend"] };
  assertEquals(canViewLoginLog(viewer), true);
  // any other super admin is denied — this is not a role-wide feature
  assertEquals(canViewLoginLog({ ...viewer, memberId: "someone-else" }), false);
  // the designated member without super_admin (e.g. a demoted role) is denied
  assertEquals(canViewLoginLog({ ...viewer, role: "leader" }), false);
  // the shared super password on an unlinked device (memberId "") is denied: the login
  // isn't attributable to him, and anyone could have typed it
  assertEquals(canViewLoginLog({ ...viewer, memberId: "" }), false);
  assertEquals(canViewLoginLog(null), false);
});

// ── 두 부를 다 맡는 계정 ───────────────────────────────────────────────────────────────

Deno.test("canCrossPartitions: 지정된 이메일만, 대소문자는 가리지 않는다", () => {
  assertEquals(canCrossPartitions(CROSS_EMAIL), true);
  assertEquals(canCrossPartitions(CROSS_EMAIL.toUpperCase()), true);
  assertEquals(canCrossPartitions(`  ${CROSS_EMAIL}  `), true);
  assertEquals(canCrossPartitions("someone.else@gmail.com"), false);
  assertEquals(canCrossPartitions(""), false);
  assertEquals(canCrossPartitions(null), false);
});

Deno.test("readPartition: 헤더에서 오는 값은 둘 중 하나이거나 아무것도 아니다", () => {
  assertEquals(readPartition("adult"), "adult");
  assertEquals(readPartition("ADULT"), "adult");
  assertEquals(readPartition(" youth "), "youth");
  assertEquals(readPartition("public"), null);
  assertEquals(readPartition(""), null);
  assertEquals(readPartition(null), null);
});

Deno.test("verifyAdminJwt: 보통 계정은 자기 members 행이 있는 부를 그대로 받는다", async () => {
  const sb = mockSb(
    { members: { id: "m1" }, member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산", ministry: "KM" } },
    {},
    "leader@example.com",
  );
  const r = await verifyAdminJwt(sb, "jwt");
  assertEquals(r?.partition, "youth");
  assertEquals(r?.memberId, "m1");
  assertEquals(r?.email, "leader@example.com");
  assertEquals(r?.memberPartition, "youth");
});

Deno.test("verifyAdminJwt: 고를 수 없는 계정은 X-Partition을 적어 보내도 건너가지 못한다", async () => {
  const sb = mockSb(
    { members: { id: "m1" }, member_roles: { role: "super_admin", group_name: "대학부", subgroup: "", ministry: "" } },
    {},
    "someone.else@gmail.com",
  );
  // 헤더는 요청일 뿐이다 — 이 이메일에게는 아무 효력이 없다.
  const r = await verifyAdminJwt(sb, "jwt", "adult");
  assertEquals(r?.partition, "youth");
});

Deno.test("verifyAdminJwt: 두 부를 다 맡는 계정은 고른 부로 들어간다", async () => {
  const sb = mockSb(
    { members: { id: LOGIN_LOG_VIEWER_MEMBER_ID }, member_roles: { role: "super_admin", group_name: "대학부", subgroup: "호연동산", ministry: "" } },
    {},
    CROSS_EMAIL,
  );
  // 고르지 않으면 지금까지와 똑같다: 자기 행이 있는 부.
  const home = await verifyAdminJwt(sb, "jwt");
  assertEquals(home?.partition, "youth");
  assertEquals(home?.group, "대학부");

  // 장년부를 고르면 장년부의 super_admin이 된다. 저쪽 부의 자리를 뜻하는 부서·동산은 지우고
  // 가되(여기서는 뜻이 없다), 사람 자체는 여전히 자기 행으로 남는다.
  const crossed = await verifyAdminJwt(sb, "jwt", "adult");
  assertEquals(crossed?.partition, "adult");
  assertEquals(crossed?.role, "super_admin");
  assertEquals(crossed?.group, "");
  assertEquals(crossed?.subgroup, "");
  assertEquals(crossed?.memberId, LOGIN_LOG_VIEWER_MEMBER_ID);
  assertEquals(crossed?.memberPartition, "youth"); // 이름은 여기서 찾아야 한다
});

Deno.test("두 부를 다 맡는 계정은 건너간 부에서도 로그인 기록을 본다", () => {
  // login_log는 부서를 가리지 않는 공용 표라, 어느 부의 패널에서 보든 같은 목록이다.
  const youth: Role = {
    memberId: LOGIN_LOG_VIEWER_MEMBER_ID, role: "super_admin", group: "대학부", subgroup: "호연동산",
    ministry: "", partition: "youth", email: CROSS_EMAIL, memberPartition: "youth",
      areas: ["attend"],
  };
  const adult: Role = { ...youth, group: "", subgroup: "", partition: "adult", areas: ["attend"] };
  assertEquals(canViewLoginLog(youth), true);
  assertEquals(canViewLoginLog(adult), true);
  // 장년부 공용 비밀번호는 여전히 안 된다 — 누구든 칠 수 있는 값이라 신원이 아니다.
  assertEquals(canViewLoginLog({ ...adult, memberId: "", email: undefined }), false);
});

Deno.test("canChoosePartition: 구글 로그인에만, 지정된 이메일에만 붙는다", () => {
  const base: Role = {
    memberId: "m", role: "super_admin", group: "", subgroup: "", ministry: "", partition: "youth", areas: ["attend"] };
  assertEquals(canChoosePartition({ ...base, email: CROSS_EMAIL }), true);
  assertEquals(canChoosePartition({ ...base, email: "someone.else@gmail.com" }), false);
  // 비밀번호 로그인에는 이메일이 없다 — 비밀번호 자체가 이미 부를 뜻한다.
  assertEquals(canChoosePartition({ ...base, email: "" }), false);
  assertEquals(canChoosePartition(base), false);
  assertEquals(canChoosePartition(null), false);
});

// ── 공용 비밀번호는 셋뿐이고, 저마다 자기 부의 것이다 ────────────────────────────────

Deno.test("리더 공용 비밀번호는 없다 — kccpleaders는 이제 아무것도 아니다", async () => {
  // 리더의 권한 범위는 자기 동산인데 공용 비밀번호는 사람을 가리키지 못한다. 그래서
  // 없앴고, 예전 값은 다른 틀린 비밀번호와 똑같이 거절된다.
  assertEquals(passwordGrant("kccpleaders"), null);
  assertEquals(passwordRole("kccpleaders"), null);
  assertEquals(await verifyAdmin(mockSb({}), "DEV-anything", "kccpleaders"), null);
  // 기기가 리더에게 묶여 있어도 마찬가지다 — 비밀번호가 먼저 통과해야 기기를 본다.
  const linked = await verifyAdmin(
    mockSb({
      devices: { member_id: "m1" },
      member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산", ministry: "KM" },
    }),
    "DEV-KNOWN-01",
    "kccpleaders",
  );
  assertEquals(linked, null);
});

Deno.test("새가족팀 공용 비밀번호는 대학·청년부 전용이다", () => {
  assertEquals(passwordGrant(WELCOMING_PASSWORD)?.partition, "youth");
  // 그 비밀번호로 들어온 로그인이 보는 범위도 대학·청년부뿐 — 장년부는 빠진다.
  const scope = scopeFilter(
    { memberId: "", role: "welcoming", group: "", subgroup: "", ministry: "", partition: "youth", areas: ["attend"] },
    false,
  );
  assertEquals(inScopeGroup(scope, "대학부"), true);
  assertEquals(inScopeGroup(scope, "청년부"), true);
  assertEquals(inScopeGroup(scope, ADULT_GROUP), false);
});

Deno.test("공용 비밀번호는 셋 — 그 밖의 값은 전부 거절", async () => {
  const grants = [SUPER_PASSWORD, WELCOMING_PASSWORD, ADULT_PASSWORD].map((p) => passwordGrant(p));
  assertEquals(grants.filter(Boolean).length, 3);
  for (const wrong of ["kccpleaders", "kccpleader", "nope", " ", ""]) {
    assertEquals(await verifyAdmin(mockSb({}), "DEV-x", wrong), null);
  }
});


// ── 영역(Area) ─────────────────────────────────────────────────────────────
// 합치면서 새로 생긴 규칙: 자격이 영역을 준다. 아래 테스트가 지키는 것은 두 문장이다 —
// 비밀번호는 언제나 출석뿐이고, 슬라이드는 구글 계정으로만 열린다.

Deno.test("areaOf: 기본값은 attend — 규칙을 빠뜨린 라우트는 좁은 쪽으로 떨어진다", () => {
  assertEquals(areaOf("/api/admin/list"), "attend");
  assertEquals(areaOf("/api/roster"), "attend");
  assertEquals(areaOf("/api/some/route/nobody/mapped"), "attend");
  assertEquals(areaOf("/api/slides/deck"), "slides");
  assertEquals(areaOf("/api/praise/setlist"), "praise");
});

Deno.test("미디어 역할 계정은 두 부에 하나씩, 사람이 아니라 부서다", () => {
  assertEquals(mediaPartitionOf("kccpmedia@gmail.com"), "adult");
  assertEquals(mediaPartitionOf("kccp.bitjulove.media@gmail.com"), "youth");
  // 대소문자·공백은 사람이 흘리는 것이라 신원을 가르면 안 된다.
  assertEquals(mediaPartitionOf("  KCCPMedia@Gmail.com "), "adult");
  assertEquals(mediaPartitionOf("someone.else@gmail.com"), null);
  assertEquals(mediaPartitionOf(null), null);
  assertEquals(MEDIA_ACCOUNTS.size, 2);
});

Deno.test("isOwner: 소유자 이메일은 설정에 살고 대소문자를 가리지 않는다", () => {
  assertEquals(isOwner(OWNER_EMAIL), true);
  assertEquals(isOwner(" SpencerKim1235@Gmail.com "), true);
  assertEquals(isOwner("kccpmedia@gmail.com"), false);
  assertEquals(isOwner(""), false);
});

Deno.test("비밀번호는 셋 다 출석뿐이다 — 슬라이드를 여는 비밀번호는 없다", async () => {
  for (const pw of [SUPER_PASSWORD, WELCOMING_PASSWORD, ADULT_PASSWORD]) {
    const r = await verifyAdmin(mockSb({ devices: null }), "DEV-UNKNOWN-99", pw);
    assertEquals(r?.areas, ["attend"]);
  }
});

Deno.test("미디어 계정: 슬라이드만, 자기 부만, members 행 없이", async () => {
  // members/member_roles를 통째로 비워 둔다 — 이 계정은 명단에 없어야 하고,
  // 없어도 들어올 수 있어야 한다.
  const adult = await verifyAdminJwt(mockSb({}, {}, "kccpmedia@gmail.com"), "jwt");
  assertEquals(adult?.role, "media");
  assertEquals(adult?.areas, ["slides"]);
  assertEquals(adult?.partition, "adult");
  assertEquals(adult?.memberId, "");

  const youth = await verifyAdminJwt(mockSb({}, {}, "kccp.bitjulove.media@gmail.com"), "jwt");
  assertEquals(youth?.partition, "youth");
  assertEquals(youth?.areas, ["slides"]);
});

Deno.test("소유자는 신원을 대체하지 않고 영역만 넓힌다", async () => {
  const sb = mockSb(
    { members: { id: LOGIN_LOG_VIEWER_MEMBER_ID }, member_roles: { role: "super_admin", group_name: "대학부", subgroup: "호연동산", ministry: "" } },
    {},
    OWNER_EMAIL,
  );
  const r = await verifyAdminJwt(sb, "jwt");
  // 사람은 그대로다 — 로그인 기록의 이름도, 로그인 기록 열람 권한도 이 memberId에 걸려 있다.
  assertEquals(r?.memberId, LOGIN_LOG_VIEWER_MEMBER_ID);
  assertEquals(r?.role, "super_admin");
  assertEquals(r?.group, "대학부");
  // 넓어지는 것은 영역뿐이다.
  assertEquals(r?.areas, ["attend", "slides", "praise"]);
});

Deno.test("소유자가 명단에 없어도 들어온다", async () => {
  const r = await verifyAdminJwt(mockSb({}, {}, OWNER_EMAIL), "jwt");
  assertEquals(r?.role, "owner");
  assertEquals(r?.areas, ["attend", "slides", "praise"]);
  // 찬양 영역은 있어도 팀은 없다 — 자격에 없는 팀을 자격이 지어내지 않는다.
  // 그 화면이 팀을 묻는 이유가 이것이다.
  assertEquals(r?.team, undefined);
});

// ── 찬양팀 인도자 ──────────────────────────────────────────────────────────
// 영역을 주는 것은 `team_leaders` 의 줄 하나뿐이다. 비밀번호에는 이 영역이 없고
// (passwordGrant 는 언제나 ['attend']), 미디어 역할 계정에도 없다.

const LEADER_ROW = {
  team_leaders: {
    // 저장된 이메일은 사람이 적은 대소문자 그대로다 — 로그인은 소문자로 들어온다.
    email: "Leader@Example.com",
    team_id: "team-ju",
    teams: { id: "team-ju", name: "주랑 찬양팀", kind: "praise", partition: "youth" },
  },
};

Deno.test("인도자는 자기 팀과 함께 들어오고, 부(部)는 팀이 정한다", async () => {
  const r = await verifyAdminJwt(mockSb(LEADER_ROW, {}, "leader@example.com"), "jwt");
  assertEquals(r?.role, "praise_leader");
  assertEquals(r?.areas, ["praise"]);
  assertEquals(r?.team?.id, "team-ju");
  // 인도자가 어느 부 교인이냐가 아니라 **어느 팀을 이끄느냐**가 콘티의 부를 정한다.
  assertEquals(r?.partition, "youth");
  // 명단에는 닿지 않는다 — 영역이 하나뿐이고, resolveAdmin 이 그것을 본다.
  assertEquals(
    await resolveAdmin(mockSb(LEADER_ROW, {}, "leader@example.com"), req("/api/admin/list", { authorization: "Bearer jwt" })),
    null,
  );
});

Deno.test("인도자 자격은 신원을 대체하지 않고 영역만 넓힌다", async () => {
  // members 행이 있는 인도자 — 그 사람으로 남아야 로그인 기록에 이름이 남는다.
  const sb = mockSb(
    { ...LEADER_ROW, members: { id: "m-1" }, member_roles: { role: "leader", group_name: "청년부", subgroup: "건영동산" } },
    {},
    "leader@example.com",
  );
  const r = await verifyAdminJwt(sb, "jwt");
  assertEquals(r?.memberId, "m-1");
  assertEquals(r?.role, "leader");
  assertEquals(r?.group, "청년부");
  assertEquals(r?.areas, ["attend", "praise"]);
  assertEquals(r?.team?.id, "team-ju");
});

Deno.test("ilike 가 집어 온 줄이라도 이메일이 정확히 같아야 한다", async () => {
  // `_` 는 이메일에 쓸 수 있는 글자인데 ilike 의 패턴에서는 아무 글자 하나를 뜻한다.
  // 스텁은 질의를 흉내 내지 않고 늘 같은 줄을 주므로, 여기서 보는 것은 **집어 온 줄을
  // 다시 견주는가** 하나다 — 그 견주기가 없으면 남의 팀 콘티를 여는 길이 된다.
  assertEquals(await verifyAdminJwt(mockSb(LEADER_ROW, {}, "leaderXexample.com"), "jwt"), null);
});

Deno.test("`team_leaders` 에 줄이 없으면 아무것도 아니다 — 구글 로그인만으로는 문이 열리지 않는다", async () => {
  assertEquals(await verifyAdminJwt(mockSb({}, {}, "stranger@example.com"), "jwt"), null);
  // 줄을 내리는 것(active=false)과 팀을 내리는 것(teams.active=false)도 같은 답이어야
  // 한다. 그 거르기는 질의 쪽에 있어(praiseTeamOf) 여기 스텁으로는 확인되지 않는다 —
  // 회수가 실제로 듣는지는 마이그레이션 재생과 손으로 하는 확인이 맡는다.
  assertEquals(await verifyAdminJwt(mockSb({}, {}, "leader@example.com"), "jwt"), null);
});

Deno.test("비밀번호는 찬양 영역을 주지 않는다", () => {
  for (const password of [SUPER_PASSWORD, WELCOMING_PASSWORD]) {
    assertEquals(passwordGrant(password)?.areas, ["attend"]);
  }
});

// ── 서버가 막는다 ──────────────────────────────────────────────────────────
// 탭을 숨기는 것은 화면일 뿐이다. 아래 셋이 그 문장을 코드로 붙잡는다.

function req(path: string, headers: Record<string, string>): Request {
  return new Request("https://kccp.example" + path, { headers });
}

Deno.test("미디어 계정으로 명단 라우트를 열면 거부된다", async () => {
  const sb = mockSb({}, {}, "kccpmedia@gmail.com");
  const auth = { authorization: "Bearer jwt" };

  // 신원은 풀린다 — 로그인 화면이 "어느 영역을 가졌나"를 물어야 하므로.
  assertEquals((await resolveIdentity(sb, req("/api/admin/list", auth)))?.role, "media");
  // 그런데 출석 라우트는 열리지 않는다.
  assertEquals(await resolveAdmin(sb, req("/api/admin/list", auth)), null);
  // 자기 영역은 열린다.
  assertEquals((await resolveAdmin(sb, req("/api/slides/deck", auth)))?.role, "media");
});

Deno.test("출석 비밀번호로 슬라이드 라우트를 열면 거부된다", async () => {
  const sb = mockSb({ devices: null });
  const pw = { "x-device-id": "DEV-UNKNOWN-99", "x-admin-password": SUPER_PASSWORD };
  assertEquals((await resolveAdmin(sb, req("/api/admin/list", pw)))?.role, "super_admin");
  assertEquals(await resolveAdmin(sb, req("/api/slides/deck", pw)), null);
});

Deno.test("소유자는 양쪽 다 열린다", async () => {
  const sb = mockSb({}, {}, OWNER_EMAIL);
  const auth = { authorization: "Bearer jwt" };
  const owned = ["attend", "slides", "praise"];
  assertEquals((await resolveAdmin(sb, req("/api/admin/list", auth)))?.areas, owned);
  assertEquals((await resolveAdmin(sb, req("/api/slides/deck", auth)))?.areas, owned);
  // 찬양도 열린다 — 잘못 앉은 콘티를 옮길 자격이 하나는 있어야 한다 (praise.ts).
  assertEquals((await resolveAdmin(sb, req("/api/praise/me", auth)))?.areas, owned);
});

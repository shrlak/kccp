import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { areaOf, type LeaderTeam, type Role } from "./auth.ts";
import {
  canTouchSetlist,
  canUploadTo,
  deckFileName,
  defaultService,
  leaderServices,
  upcomingSunday,
  type LeaderService,
  type ServiceRow,
  type TeamServiceRow,
} from "./praise.ts";

const hepzibah: LeaderTeam = { id: "team-hep", name: "헵시바 찬양팀", kind: "praise", partition: "adult" };
const jurang: LeaderTeam = { id: "team-ju", name: "주랑 찬양팀", kind: "praise", partition: "youth" };

const services: ServiceRow[] = [
  { id: "sv-1", name: "1부", starts_at: "09:00", partition: "adult", sort_order: 1 },
  { id: "sv-2", name: "2부", starts_at: "11:15", partition: "adult", sort_order: 2 },
  { id: "sv-3", name: "3부", starts_at: "14:00", partition: "youth", sort_order: 3 },
];

const links: TeamServiceRow[] = [
  { team_id: "team-hep", service_id: "sv-1", leads_ppt: true },
  { team_id: "team-hep", service_id: "sv-2", leads_ppt: true },
  { team_id: "team-choir", service_id: "sv-2", leads_ppt: false },
  { team_id: "team-ju", service_id: "sv-3", leads_ppt: true },
];

Deno.test("콘티는 다음 주일로 간다 — 목요일에 올린 것이 지난 주일에 앉지 않는다", () => {
  // 2026-09-17 은 목요일, 그 주 주일은 09-20.
  assertEquals(upcomingSunday("2026-09-17"), "2026-09-20");
  // 토요일 저녁에 올려도 같은 주일이다.
  assertEquals(upcomingSunday("2026-09-19"), "2026-09-20");
  // 주일 당일은 오늘이다 — 아침에 급히 올리는 그 경우가 실제로 있다.
  assertEquals(upcomingSunday("2026-09-20"), "2026-09-20");
  // 주일 다음 날은 벌써 다음 주일이다.
  assertEquals(upcomingSunday("2026-09-21"), "2026-09-27");
});

Deno.test("모양이 틀린 날짜로는 주일을 셈하지 않는다", () => {
  assertThrows(() => upcomingSunday("9/17/26"));
  assertThrows(() => upcomingSunday(""));
});

Deno.test("덱 이름은 ppt의 규칙 그대로 MMDD — 미디어팀이 이 이름으로 한 주를 찾는다", () => {
  assertEquals(deckFileName("2026-09-20"), "0920.pptx");
  assertEquals(deckFileName("2026-01-04"), "0104.pptx");
  assertThrows(() => deckFileName("2026-9-4"));
});

Deno.test("인도자는 자기 팀이 서는 예배만 본다", () => {
  assertEquals(leaderServices(services, links, "team-hep").map((s) => s.name), ["1부", "2부"]);
  assertEquals(leaderServices(services, links, "team-ju").map((s) => s.name), ["3부"]);
  // 서는 예배가 없는 팀에는 빈 목록 — 화면이 「올릴 곳이 없습니다」라고 말해야 하는 자리다.
  assertEquals(leaderServices(services, links, "team-none"), []);
});

Deno.test("순서는 sort_order 다 — 시각으로 정렬하면 부가 섞인다", () => {
  const shuffled = [services[2], services[0], services[1]];
  const all: TeamServiceRow[] = services.map((sv) => ({ team_id: "t", service_id: sv.id, leads_ppt: false }));
  assertEquals(leaderServices(shuffled, all, "t").map((s) => s.name), ["1부", "2부", "3부"]);
});

Deno.test("이끄는 예배가 하나면 묻지 않고, 둘이면 묻는다", () => {
  assertEquals(defaultService(leaderServices(services, links, "team-ju"))?.name, "3부");
  // 헵시바는 1부와 2부를 다 이끈다 — 임의로 고르면 1부 콘티가 2부에 앉는 주가 생긴다.
  assertEquals(defaultService(leaderServices(services, links, "team-hep")), null);
});

Deno.test("이끌지는 않지만 서는 예배가 하나뿐이면 그것이 기본이다 — 찬양대가 그렇다", () => {
  const choir: LeaderService[] = leaderServices(services, links, "team-choir");
  assertEquals(choir.map((s) => s.name), ["2부"]);
  assertEquals(defaultService(choir)?.name, "2부");
});

const asRole = (over: Partial<Role>): Pick<Role, "role" | "team"> => ({
  role: "praise_leader",
  ...over,
} as Pick<Role, "role" | "team">);

Deno.test("인도자는 자기 팀의 콘티만 만진다", () => {
  const mine = asRole({ team: hepzibah });
  assertEquals(canTouchSetlist(mine, { team_id: "team-hep" }), true);
  assertEquals(canTouchSetlist(mine, { team_id: "team-ju" }), false);
  // 팀이 없는 자격은 어느 줄도 만지지 못한다 — 빈 팀이 모든 팀이 되면 안 된다.
  assertEquals(canTouchSetlist(asRole({}), { team_id: "team-hep" }), false);
});

Deno.test("소유자는 예외다 — 잘못 앉은 콘티를 옮길 자격이 하나는 있어야 한다", () => {
  assertEquals(canTouchSetlist(asRole({ role: "owner" }), { team_id: "team-ju" }), true);
});

Deno.test("최고관리자는 예외가 아니다 — 그 사람이 콘티를 다루는 자리는 슬라이드 영역이다", () => {
  assertEquals(canTouchSetlist(asRole({ role: "super_admin" }), { team_id: "team-hep" }), false);
});

Deno.test("팀의 부와 예배의 부가 다르면 올리지 않는다", () => {
  assertEquals(canUploadTo(hepzibah, { partition: "adult" }), true);
  assertEquals(canUploadTo(hepzibah, { partition: "youth" }), false);
  assertEquals(canUploadTo(jurang, { partition: "youth" }), true);
});

Deno.test("이 영역의 모든 경로는 praise 를 요구한다", () => {
  // 접두사가 곧 영역 판정이다. 한 칸 벗어나면 'attend'로 떨어지고, 그 순간 출석
  // 비밀번호가 콘티를 올릴 수 있게 된다 — 여기서는 **열리는** 실패다.
  for (
    const route of [
      "/api/praise/me",
      "/api/praise/conti",
      "/api/praise/setlists",
      "/api/praise/setlists/11111111-1111-1111-1111-111111111111/conti",
      "/api/praise/setlists/11111111-1111-1111-1111-111111111111/deck",
      "/api/praise/ai/usage",
      "/api/praise/ai/openrouter",
      "/api/praise/ai/gemini/gemini-3.6-flash",
    ]
  ) {
    assertEquals(areaOf(route), "praise", route);
  }
  assertEquals(areaOf("/api/praise-me"), "attend");
});

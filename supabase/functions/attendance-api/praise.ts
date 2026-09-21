// 찬양팀 인도자의 영역 — 범위를 정하는 규칙들.
//
// ── 무엇이 다른가 ────────────────────────────────────────────────────────────────────
// 슬라이드 영역(`slides.ts`)의 범위는 **부(部)** 다: 미디어팀은 자기 부의 예배를 전부
// 본다. 여기서는 **팀**이다. 인도자는 자기 팀의 콘티 하나만 올리고, 자기 팀의 콘티만
// 다시 연다 — 헵시바의 인도자가 주랑의 콘티를 열 이유가 없고, 열 수 있으면 언젠가
// 덮어쓴다.
//
// 그래서 이 파일의 모든 함수는 **팀 id를 받는다.** 클라이언트가 보낸 값이 아니라
// `auth.ts`의 `Role.team` 에서 온 값이다 — 자격이지 요청이 아니다.
//
// `slides.ts`가 그렇듯 순수 함수만 모았다. 서명 URL을 만드는 자리(index.ts)는 이
// 규칙들을 부를 뿐이고, 그래서 규칙에는 단위 테스트가 붙는다.
import { canPickTeam } from "./auth.ts";
import type { LeaderTeam, Role } from "./auth.ts";
import { isIsoDate, type SetlistRow, type SlidePartition } from "./slides.ts";

/**
 * 콘티가 향하는 주일.
 *
 * 인도자는 「이번 주 콘티」를 올린다. 오늘이 주일이면 오늘이고, 아니면 **다음 주일**이다
 * — 목요일에 올리는 콘티는 지난 주일 것이 아니다. 주일 오후에 다음 주 것을 미리 올리는
 * 일은 드물고, 그때는 화면에서 날짜를 고칠 수 있다.
 *
 * 날짜는 교회 현지 시간으로 받는다 (`localDate()`). 서버의 UTC로 자르면 토요일 저녁에
 * 올린 콘티가 이미 일요일이 되어 그 주일에 앉는다.
 */
export function upcomingSunday(today: string): string {
  if (!isIsoDate(today)) throw new Error("today must be YYYY-MM-DD");
  const at = new Date(`${today}T12:00:00Z`);
  const ahead = (7 - at.getUTCDay()) % 7;
  at.setUTCDate(at.getUTCDate() + ahead);
  return at.toISOString().slice(0, 10);
}

/**
 * 완성된 덱의 파일 이름 — ppt가 쓰던 규칙 그대로 `MMDD.pptx`.
 *
 * 미디어팀이 받는 파일이고, 그쪽은 이 이름으로 한 주를 찾는다. 앱 안에서만 도는 이름이
 * 아니므로 바꾸지 않는다.
 */
export function deckFileName(serviceDate: string): string {
  if (!isIsoDate(serviceDate)) throw new Error("serviceDate must be YYYY-MM-DD");
  return `${serviceDate.slice(5, 7)}${serviceDate.slice(8, 10)}.pptx`;
}

export interface ServiceRow {
  id: string;
  name: string;
  starts_at: string;
  partition: SlidePartition;
  sort_order?: number;
}

export interface TeamServiceRow {
  team_id: string;
  service_id: string;
  leads_ppt: boolean;
}

export interface LeaderService {
  id: string;
  name: string;
  startsAt: string;
  partition: SlidePartition;
  /** 이 예배의 슬라이드를 이 팀이 이끄는가. 2부에는 콘티가 둘 오고 하나만 참이다. */
  leadsPpt: boolean;
}

/**
 * 이 팀이 서는 예배들 — 화면에 나열되는 순서대로.
 *
 * 비어 있을 수 있다: 팀은 있는데 `team_services`에 줄이 없는 경우다. 그때 화면은 「올릴
 * 곳이 없습니다」라고 말해야 한다. 여기서 아무 예배나 골라 주면 콘티가 엉뚱한 예배에
 * 앉고, 그것은 주일 아침에 드러난다.
 */
export function leaderServices(
  services: ServiceRow[],
  links: TeamServiceRow[],
  teamId: string,
): LeaderService[] {
  const mine = new Map(links.filter((l) => l.team_id === teamId).map((l) => [l.service_id, l]));
  return services
    .filter((sv) => mine.has(sv.id))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((sv) => ({
      id: sv.id,
      name: sv.name,
      startsAt: sv.starts_at,
      partition: sv.partition,
      leadsPpt: !!mine.get(sv.id)?.leads_ppt,
    }));
}

/**
 * 인도자가 콘티를 올릴 때 기본으로 고르는 예배.
 *
 * **슬라이드를 이끄는 예배가 먼저다.** 헵시바는 1부와 2부에 서지만 2부에는 찬양대도
 * 오므로, 「어느 콘티가 슬라이드가 되는가」는 이미 `leads_ppt`가 답해 두었다. 그 값이
 * 여기서도 답이 되면 인도자가 고를 일이 하나 줄어든다.
 *
 * 이끄는 예배가 둘이면(헵시바가 그렇다) 고를 수 없으므로 null을 돌려준다 — 화면이
 * 묻는다. 임의로 첫 번째를 고르면 1부 콘티가 2부에 앉는 주가 생기고, 그 잘못은 올린
 * 사람 눈에 보이지 않는다.
 */
export function defaultService(services: LeaderService[]): LeaderService | null {
  const leading = services.filter((sv) => sv.leadsPpt);
  if (leading.length === 1) return leading[0];
  if (leading.length === 0 && services.length === 1) return services[0];
  return null;
}

/**
 * 이 자격이 이 콘티 줄을 만질 수 있는가 — **팀이 같은가** 하나다.
 *
 * 소유자는 예외다. 팀이 없어도(보통 없다) 들어올 수 있어야 하는데, 그 이유는 편의가
 * 아니라 **이 길을 고칠 수 있는 사람이 하나는 있어야 하기 때문**이다: 인도자가 올린
 * 콘티가 잘못된 예배에 앉았을 때 그것을 옮길 자격이 아무에게도 없으면, 고치는 방법이
 * 데이터베이스를 직접 여는 것밖에 없다.
 *
 * 출석 쪽 최고관리자는 **예외가 아니다.** 출석 비밀번호로 들어온 최고관리자는 `areas`가
 * ['attend'] 뿐이라 이 경로에 닿지도 못하고, 구글로 들어온 최고관리자에게도 남의 팀
 * 콘티를 여는 자격을 주지 않는다 — 그 사람이 콘티를 다루는 자리는 슬라이드 영역이고,
 * 거기서는 부(部)가 범위다.
 *
 * 예외는 **팀이 없는 자격**이다: 소유자와 영역 비밀번호(kccp1980·kccpmedia·kccppraise).
 * 팀이 없으니 「자기 팀」으로 좁힐 것이 없고, 좁힐 수 없는 자격을 좁은 척 다루면 그
 * 화면은 아무것도 못 한다. 대신 그 자격은 화면에서 팀을 **고른다** — 자격이 팀을
 * 지어내지 않는다는 규칙은 그대로다. `canPickTeam`이 그 한 판단이다.
 */
export function canTouchSetlist(
  role: Pick<Role, "role" | "team" | "anyTeam">,
  row: Pick<SetlistRow, "team_id">,
): boolean {
  if (canPickTeam(role as Role)) return true;
  return !!role.team && role.team.id === row.team_id;
}

/**
 * 이 팀이 이 예배에 콘티를 올릴 수 있는가.
 *
 * 팀이 그 예배에 서는지(`team_services`)를 부르는 쪽이 이미 확인하지만, 부(部)는 여기서
 * 한 번 더 본다: 팀의 부와 예배의 부가 다르면 `team_services`에 줄이 잘못 들어간 것이고,
 * 그 줄을 믿고 진행하면 장년부 콘티가 대학·청년부 예배에 앉는다.
 */
export function canUploadTo(team: LeaderTeam, service: { partition: SlidePartition }): boolean {
  return team.partition === service.partition;
}

// 슬라이드 파일이 어디에 놓이는가 — 키를 짓는 규칙과 그 규칙이 지키는 것들.
//
// ppt에서는 파일이 Durable Object 안에 1 MiB 조각으로 쪼개져 있었다. 이제 Supabase
// Storage의 객체 하나다. 그래서 남는 어려운 부분은 **키를 어떻게 짓는가** 하나뿐이고,
// 그것은 순수 함수라 여기서 단위 테스트가 붙는다.
//
// 브라우저는 파일을 엣지 함수로 보내지 않는다. 함수는 **서명된 URL만 발급**하고 바이트는
// 브라우저와 Storage 사이에서 곧장 오간다 — 조각내기가 사라진 이유가 그것이다. 대신
// 함수가 발급 전에 자격을 확인하고, 발급한 링크는 짧게 산다.

/** 콘티 PDF. 찬양팀이 올린다. */
export const CONTI_BUCKET = "kccp-conti";
/** 콘티에서 잘라 낸 악보 쪽 이미지. */
export const SHEET_BUCKET = "kccp-sheets";
/** 완성된 예배 슬라이드와 그 재료. */
export const DECK_BUCKET = "kccp-decks";

/**
 * 서명 URL의 수명. 짧은 이유는 이 링크가 **자격 없이도 열리기** 때문이다 — 화면에
 * 남고, 로그에 남고, 카톡으로 옮겨진다. 한 번 열어 보기에는 넉넉하고 주중에 돌려
 * 쓰기에는 모자라야 한다.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

/** 업로드 URL은 더 길게 — 3.6 MB짜리 덱이 느린 회선에서 5분을 넘길 수 있다. */
export const SIGNED_UPLOAD_TTL_SECONDS = 1800;

const MAX_NAME = 80;

/**
 * 사람이 지은 파일 이름을 객체 키의 **마지막 칸**으로 쓸 수 있게 만든다.
 *
 * 경로가 아니라 이름을 뽑는다: 슬래시로 잘라 마지막 조각만 남기므로 "../../x" 는 "x"가
 * 되고, 키 하나로 버킷 안의 다른 자리에 쓸 방법이 없어진다. 앞의 점도 지운다 — ".." 가
 * 남을 여지를 없애고, 숨김 파일이 되는 것도 함께 막는다.
 *
 * 한글은 남긴다. 곡 제목이 곧 파일 이름인 자리라, 다 지우면 사람이 자기 파일을 알아보지
 * 못한다. 제어문자는 지운다 — 키에 들어가면 Storage가 그 객체를 다른 이름으로 읽어서,
 * 올린 사람만 아는 파일이 되고 목록에는 보이지 않는다.
 */
export function safeObjectName(raw: string, fallback = "file"): string {
  const base = (raw ?? "").normalize("NFC").split(/[/\\]/).pop() ?? "";
  const cleaned = base
    // deno-lint-ignore no-control-regex -- 제어문자를 지우는 것이 이 정규식의 일이다
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim();
  return (cleaned || fallback).slice(0, MAX_NAME);
}

/** YYYY-MM-DD 인가. 키의 첫 칸이라 모양이 틀리면 폴더가 흩어진다. */
export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export interface ObjectKeyParts {
  serviceDate: string;
  /** setlists.id — 같은 날 같은 예배에 여러 팀이 올려도 서로 덮지 않게. */
  setlistId: string;
  name: string;
}

/**
 * `2026-08-30/<setlistId>/<name>` — 날짜가 앞에 오는 이유는 목록·정리가 전부 날짜
 * 단위이기 때문이다. Storage에는 폴더가 없고 접두사만 있으므로, 접두사가 곧 폴더다.
 *
 * setlistId가 가운데 칸인 것이 핵심이다. 팀·예배 이름으로 짓고 싶어지지만 그러면 이름이
 * 바뀔 때 옛 파일이 미아가 된다. UUID는 바뀌지 않는다.
 */
export function objectKey(parts: ObjectKeyParts): string {
  if (!isIsoDate(parts.serviceDate)) throw new Error("service_date must be YYYY-MM-DD");
  if (!/^[0-9a-fA-F-]{36}$/.test(parts.setlistId)) throw new Error("setlistId must be a uuid");
  return `${parts.serviceDate}/${parts.setlistId}/${safeObjectName(parts.name)}`;
}

/** 주어진 키가 이 setlist 의 것인가 — 남이 준 키를 그대로 서명해 주지 않기 위해. */
export function keyBelongsTo(key: string, serviceDate: string, setlistId: string): boolean {
  return typeof key === "string" && key.startsWith(`${serviceDate}/${setlistId}/`);
}

export type SlidePartition = "youth" | "adult";

export interface SetlistRow {
  id: string;
  team_id: string;
  service_id: string;
  service_date: string;
  conti_path: string | null;
  deck_path: string | null;
  archived_at: string | null;
}

/**
 * 이 자격이 이 예배의 콘티를 만질 수 있는가.
 *
 * 미디어 역할 계정은 자기 부의 예배만 본다 (kccpmedia=장년, bitjulove=대학·청년).
 * 소유자와 최고관리자는 양쪽을 본다 — 2부의 콘티가 둘이고 그중 어느 쪽이 슬라이드가
 * 되는지를 정하는 것이 사람의 판단이라, 그 판단을 할 수 있는 자격이 하나는 있어야 한다.
 */
export function canTouchService(
  role: { role: string; partition: SlidePartition },
  servicePartition: SlidePartition,
  crossPartition: boolean,
): boolean {
  if (crossPartition || role.role === "owner" || role.role === "super_admin") return true;
  return role.partition === servicePartition;
}

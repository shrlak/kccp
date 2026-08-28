import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  canTouchService,
  isIsoDate,
  keyBelongsTo,
  objectKey,
  safeObjectName,
  SIGNED_URL_TTL_SECONDS,
} from "./slides.ts";

const UUID = "42159ef9-4e60-4570-8195-04b4766f05fa";

Deno.test("경로가 아니라 이름을 뽑는다 — 키 하나로 다른 자리에 쓸 수 없다", () => {
  assertEquals(safeObjectName("../../secret.pptx"), "secret.pptx");
  assertEquals(safeObjectName("a/b/c.pdf"), "c.pdf");
  assertEquals(safeObjectName("..\\..\\x"), "x");
  assertEquals(safeObjectName("..."), "file");
  assertEquals(safeObjectName(".env"), "env");
  assertEquals(safeObjectName(""), "file");
  assertEquals(safeObjectName("   "), "file");
});

Deno.test("제어문자는 사라진다 — 키에 들어가면 Storage가 다르게 읽는다", () => {
  // 제어문자가 키에 들어가면 Storage가 그 객체를 다른 이름으로 읽는다 — 올린 사람만
  // 아는 파일이 되고, 목록에는 보이지 않는다.
  assertEquals(safeObjectName("con\u0001ti.pdf"), "conti.pdf");
  assertEquals(safeObjectName("a\u007Fb.pdf"), "ab.pdf");
});

Deno.test("한글 제목은 남는다 — 곡 제목이 곧 파일 이름이다", () => {
  assertEquals(safeObjectName("주 은혜임을 (2026-08-30).pptx"), "주 은혜임을 (2026-08-30).pptx");
});

Deno.test("이름 길이를 자른다", () => {
  assertEquals(safeObjectName("가".repeat(200)).length, 80);
});

Deno.test("날짜 모양", () => {
  assertEquals(isIsoDate("2026-08-30"), true);
  assertEquals(isIsoDate("2026-8-30"), false);
  assertEquals(isIsoDate("2026-13-40"), false);
  assertEquals(isIsoDate(20260830), false);
});

Deno.test("객체 키는 날짜 · setlist id · 이름", () => {
  assertEquals(
    objectKey({ serviceDate: "2026-08-30", setlistId: UUID, name: "콘티.pdf" }),
    `2026-08-30/${UUID}/콘티.pdf`,
  );
});

Deno.test("모양이 틀린 날짜나 id로는 키를 짓지 않는다", () => {
  assertThrows(() => objectKey({ serviceDate: "8/30/26", setlistId: UUID, name: "x" }));
  assertThrows(() => objectKey({ serviceDate: "2026-08-30", setlistId: "../..", name: "x" }));
});

Deno.test("남이 준 키를 그대로 서명해 주지 않는다", () => {
  const key = objectKey({ serviceDate: "2026-08-30", setlistId: UUID, name: "콘티.pdf" });
  assertEquals(keyBelongsTo(key, "2026-08-30", UUID), true);
  assertEquals(keyBelongsTo(key, "2026-08-23", UUID), false);
  assertEquals(keyBelongsTo(`2026-08-30/${UUID.replace("42", "99")}/x`, "2026-08-30", UUID), false);
});

Deno.test("서명 URL은 짧게 산다 — 자격 없이도 열리는 링크다", () => {
  assertEquals(SIGNED_URL_TTL_SECONDS <= 600, true);
});

Deno.test("미디어 역할 계정은 자기 부의 예배만 만진다", () => {
  const adultMedia = { role: "media", partition: "adult" as const };
  assertEquals(canTouchService(adultMedia, "adult", false), true);
  assertEquals(canTouchService(adultMedia, "youth", false), false);
});

Deno.test("소유자·최고관리자·양부 계정은 2부의 두 콘티를 다 본다", () => {
  assertEquals(canTouchService({ role: "owner", partition: "youth" }, "adult", false), true);
  assertEquals(canTouchService({ role: "super_admin", partition: "youth" }, "adult", false), true);
  assertEquals(canTouchService({ role: "media", partition: "youth" }, "adult", true), true);
});

// 이 함수가 서비스하는 **모든 경로**가 제 영역을 요구하는지.
//
// 「curl로 출석 비밀번호를 실어 같은 경로를 때려 보고 거부되는지 확인한다 — 그게 이 설계의
// 값이 실제로 있는지 보는 테스트다」의 단위 테스트판이다. 프록시가 도는 동안 상류에 붙지
// 않고도 같은 것을 묻는다: 경로 하나가 접두사를 벗어나면 areaOf가 'attend'로 떨어뜨리고,
// 그 순간 출석 비밀번호로 교회의 AI 무료 한도를 쓸 수 있게 된다.
import { assertEquals } from "jsr:@std/assert@1";
import { areaOf } from "../attendance-api/auth.ts";

/** index.ts가 실제로 답하는 나머지 경로들 (영역 접두사를 벗긴 뒤의 모양). */
const TAILS = [
  "/settings",
  "/usage",
  "/openrouter",
  "/gemini/gemini-3.6-flash",
  // 모델 이름에 슬래시가 있는 경우 (OpenRouter 슬러그가 Gemini 경로로 잘못 오더라도)
  "/gemini/nvidia%2Fnemotron-nano-12b-v2-vl",
];

/** index.ts의 AREA_PREFIXES 와 짝이다. 접두사를 더하면 여기에도 더한다. */
const PREFIXES: Record<string, "slides" | "praise"> = {
  "/api/slides/ai": "slides",
  "/api/praise/ai": "praise",
};

Deno.test("ai-proxy의 모든 경로는 그 접두사의 영역을 요구한다", () => {
  for (const [prefix, area] of Object.entries(PREFIXES)) {
    for (const tail of TAILS) {
      assertEquals(areaOf(prefix + tail), area, prefix + tail);
    }
  }
});

Deno.test("두 접두사는 서로의 영역을 열지 않는다", () => {
  // 슬라이드 계정이 찬양 경로로, 인도자가 슬라이드 경로로 들어오는 것은 각각의 areas가
  // 막는다. 여기서 확인하는 것은 **판정이 갈린다**는 것 하나다 — 같은 값으로 떨어지면
  // 한쪽 자격이 다른 쪽 문을 열게 된다.
  assertEquals(areaOf("/api/slides/ai/usage") === areaOf("/api/praise/ai/usage"), false);
});

Deno.test("접두사를 한 칸 벗어나면 곧바로 출석으로 떨어진다", () => {
  // 안전 방향의 실패이지만(더 좁은 쪽), 이 함수에서는 **열리는** 실패다: 출석 자격이
  // 상류 키를 쓸 수 있게 된다. 그래서 경로를 옮길 때 여기가 먼저 빨개져야 한다.
  assertEquals(areaOf("/api/ai/gemini/gemini-3.6-flash"), "attend");
  assertEquals(areaOf("/api/slides-ai/usage"), "attend");
  assertEquals(areaOf("/api/praise-ai/usage"), "attend");
});

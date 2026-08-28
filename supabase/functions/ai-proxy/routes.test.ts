// 이 함수가 서비스하는 **모든 경로**가 슬라이드 영역인지.
//
// 「curl로 출석 비밀번호를 실어 같은 경로를 때려 보고 거부되는지 확인한다 — 그게 이 설계의
// 값이 실제로 있는지 보는 테스트다」의 단위 테스트판이다. 프록시가 도는 동안 상류에 붙지
// 않고도 같은 것을 묻는다: 경로 하나가 접두사를 벗어나면 areaOf가 'attend'로 떨어뜨리고,
// 그 순간 출석 비밀번호로 교회의 AI 무료 한도를 쓸 수 있게 된다.
import { assertEquals } from "jsr:@std/assert@1";
import { areaOf } from "../attendance-api/auth.ts";

/** index.ts가 실제로 답하는 경로들. 새 경로를 더하면 여기에도 더한다. */
const ROUTES = [
  "/api/slides/ai/settings",
  "/api/slides/ai/usage",
  "/api/slides/ai/openrouter",
  "/api/slides/ai/gemini/gemini-3.6-flash",
  // 모델 이름에 슬래시가 있는 경우 (OpenRouter 슬러그가 Gemini 경로로 잘못 오더라도)
  "/api/slides/ai/gemini/nvidia%2Fnemotron-nano-12b-v2-vl",
];

Deno.test("ai-proxy의 모든 경로는 슬라이드 영역을 요구한다", () => {
  for (const route of ROUTES) {
    assertEquals(areaOf(route), "slides", route);
  }
});

Deno.test("접두사를 한 칸 벗어나면 곧바로 출석으로 떨어진다", () => {
  // 안전 방향의 실패이지만(더 좁은 쪽), 이 함수에서는 **열리는** 실패다: 출석 자격이
  // 상류 키를 쓸 수 있게 된다. 그래서 경로를 옮길 때 여기가 먼저 빨개져야 한다.
  assertEquals(areaOf("/api/ai/gemini/gemini-3.6-flash"), "attend");
  assertEquals(areaOf("/api/slides-ai/usage"), "attend");
});

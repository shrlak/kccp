// ── QR 그리기 ─────────────────────────────────────────────────────────────────
// qrcode-generator를 감싸는 유일한 자리. 그 라이브러리(52kB)는 SheetJS·Chart.js와 같은
// 규칙으로 지연 로드한다 — QR 창을 열 때만 내려오고, 나머지 화면은 그 비용을 지지 않는다.
//
// 결과는 DOM이 아니라 boolean 격자다: 그리는 일은 컴포넌트가 SVG로 한다 (라이브러리가
// 만들어 주는 SVG 문자열을 innerHTML로 꽂지 않아도 되고, 색·크기를 우리가 정한다).

export type QrModules = boolean[][]

let encoder: Promise<(text: string) => QrModules> | null = null

export function loadQrEncoder(): Promise<(text: string) => QrModules> {
  if (encoder) return encoder
  encoder = import('qrcode-generator').then((mod) => {
    const qrcode = mod.default
    // 이름이 한글이다. 라이브러리의 기본 stringToBytes는 latin1이라 한글이 통째로 깨지므로
    // UTF-8로 갈아 끼운다 (플랫폼의 TextEncoder면 충분하다 — 라이브러리의 UTF-8 빌드는
    // 서브패스 import라 package.json의 exports가 막는다).
    qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s))
    return (text: string) => {
      // 0 = 내용이 들어가는 가장 작은 판, M = 15% 복원력. 종이에 인쇄하는 게 아니라 화면을
      // 폰으로 찍는 것이므로 M이면 넉넉하고, 판이 작을수록 칸이 커져 찍기 쉽다.
      const qr = qrcode(0, 'M')
      qr.addData(text, 'Byte')
      qr.make()
      const n = qr.getModuleCount()
      return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
    }
  })
  return encoder
}

// 검은 칸들을 SVG path 하나로 — 칸마다 <rect>를 두면 사각형이 수백 개 생긴다.
// 좌표계는 모듈 단위(0..n)이므로 viewBox만 맞추면 어느 크기로도 늘어난다.
export function modulesToPath(modules: QrModules): string {
  const out: string[] = []
  for (let r = 0; r < modules.length; r++) {
    const row = modules[r]
    for (let c = 0; c < row.length; c++) {
      if (row[c]) out.push(`M${c} ${r}h1v1h-1z`)
    }
  }
  return out.join('')
}

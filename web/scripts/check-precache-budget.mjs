// 선캐시 예산을 사람보다 먼저 알아채는 자리.
//
// 랜딩이 조금씩 무거워지는 것은 **아무도 못 알아챈다.** 한 번에 300 KiB가 늘면 누구나
// 보지만, 배포마다 20 KiB씩 늘면 어느 주일 아침에야 드러난다 — 그때는 원인이 스무
// 커밋 뒤에 있다. 그래서 숫자를 여기에 박아 두고 빌드가 말하게 한다.
//
// 기준선은 **슬라이드 코드가 들어오기 전에** 재 뒀다: 1063 KiB (영역 구조 도입 직후).
// 그 값이 의미가 있는 이유는, 슬라이드 영역이 lazy로 남아 있는 한 이 숫자가 거의
// 움직이지 않기 때문이다. 크게 뛰면 무언가 랜딩으로 샜다는 뜻이고, 그것이 이 검사가
// 잡으려는 유일한 사건이다.
//
// 예산을 올려야 할 때는 **커밋 메시지에 왜를 적고** 올린다. 조용히 올리면 이 파일은
// 숫자를 따라다니는 주석이 되고, 그 순간 아무것도 지키지 않는다.
import { readFile, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')

// KiB. 이 스크립트가 재는 오늘의 값 1107 + 여유 60 — 리팩터링 한 번의 자연스러운
// 흔들림은 통과시키고, 청크 하나가 랜딩으로 새는 것은 통과시키지 않는 폭이다.
//
// 빌드 로그에 workbox가 찍는 숫자(1062 KiB)와 조금 다르다. 이 스크립트는 dist에 실제로
// 놓인 바이트를 재고, workbox는 매니페스트를 만들 때의 값을 보고한다. 둘 다 같은 방향으로
// 같은 크기만큼 움직이므로 새는 것은 어느 쪽으로 재든 잡힌다 — 예산은 **이 스크립트의
// 단위**이고, 두 숫자를 섞어 비교하지만 않으면 된다.
const BUDGET_KIB = Number(process.env.PRECACHE_BUDGET_KIB || 1167)

const sw = await readFile(resolve(dist, 'sw.js'), 'utf8')
const entries = [...sw.matchAll(/\{"revision":(?:"[^"]*"|null),"url":"([^"]+)"\}/g)].map((m) => m[1])

if (entries.length === 0) {
  console.error('선캐시 목록을 찾지 못했다. sw.js의 모양이 바뀌었거나 빌드가 없다.')
  process.exit(1)
}

let total = 0
const missing = []
for (const url of entries) {
  try {
    total += (await stat(resolve(dist, url))).size
  } catch {
    missing.push(url)
  }
}

const kib = total / 1024
const rows = [`선캐시 ${entries.length}개 · ${kib.toFixed(2)} KiB · 예산 ${BUDGET_KIB} KiB`]
if (missing.length) rows.push(`※ dist에서 찾지 못한 항목 ${missing.length}개: ${missing.slice(0, 3).join(', ')}`)
console.log(rows.join('\n'))

if (kib > BUDGET_KIB) {
  console.error(
    `\n선캐시가 예산을 넘었다 (${kib.toFixed(2)} > ${BUDGET_KIB} KiB).\n` +
      '슬라이드 영역이 lazy로 남아 있는 한 이 숫자는 거의 움직이지 않는다 — 크게 뛰었다면\n' +
      '무언가 랜딩으로 샌 것이다. 먼저 그것을 찾고, 정말 늘어야 하는 무게라면 커밋에 왜를\n' +
      '적고 이 파일의 BUDGET_KIB를 올려라.',
  )
  process.exit(1)
}

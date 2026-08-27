import { easternNow, type EasternNow } from '../../../lib/checkinWindow'

// ── 다 안 적힌 카드도 등록된다 ──────────────────────────────────────────────────
// 종이 카드는 사람이 손으로 채우는 것이라 빈 칸이 늘 있다: 이름이 안 읽히기도 하고,
// 소속 네모를 아무도 찍지 않기도 한다. 그래도 **인식한 카드는 등록된다** — 화면이 등록을
// 거절하면 그 사람은 어디에도 남지 않고 종이는 곧 사라지는데, 빈 칸은 나중에 멤버 탭에서
// 언제든 채울 수 있다. 대신 우리가 대신 채운 칸은 등록 전에 화면에 적어 준다
// (CardScanDialog의 안내 블록) — 조용히 지어낸 값은 나중에 아무도 못 찾는다.
//
// 이름은 이 시스템의 신원이다 (출석부·키오스크·시트 연동이 이름으로 사람을 찾는다). 그래서
// 비었을 때 빈 이름을 넣는 대신 자리표를 만든다. 자리표의 조건이 둘이다:
//   · 한눈에 임시임이 보인다 → '이름 미기재'
//   · **두 장이 같은 이름을 갖지 않는다** → 시각(분·초)까지 붙인다. 서버의 중복 병합은
//     이름+부서로 사람을 찾으므로(전화·생년월일이 어긋날 때만 갈라진다), 이름이 같고
//     연락처가 비어 있는 카드 두 장은 한 줄로 합쳐진다 — 등록을 막지 않으려던 것이
//     사람을 잃는 것으로 돌아온다.
// 화면 언어와 무관하게 한글 한 가지로 둔다: 저장되는 것은 UI 문구가 아니라 명단의 값이고,
// 적는 사람의 언어 설정에 따라 명단에 두 종류의 자리표가 생기면 찾을 수 없다.
export const UNNAMED_CARD_NAME = '이름 미기재'

const two = (n: number) => String(n).padStart(2, '0')

// '이름 미기재 08-17 14:23:05' — 연도는 등록일자가 이미 들고 있으므로 빼고, 초는 남긴다
// (한 장을 넣는 데 1초는 걸리므로 같은 초에 두 장이 들어오는 일은 없다).
export function unnamedCardName(now: EasternNow = easternNow()): string {
  return `${UNNAMED_CARD_NAME} ${now.date.slice(5)} ${two(now.hh)}:${two(now.mm)}:${two(now.ss)}`
}

// 카드에서 읽은 이름 → 저장할 이름. 비어 있을 때만 자리표가 들어간다.
export function cardMemberName(raw: string, now: EasternNow = easternNow()): string {
  return raw.trim() || unnamedCardName(now)
}

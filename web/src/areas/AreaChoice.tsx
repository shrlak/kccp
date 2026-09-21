import { useAdminAuth } from '../stores/useAdminAuth'
import { areasOf, type Area } from '../lib/api'
import { KccpMark } from './attend/checkin/KccpMark'
import { Button } from '../components/ui/Button'

// 영역을 둘 이상 가진 자격만 이 화면을 본다. 하나뿐이면 묻지 않고 곧장 들어간다 —
// 고를 것이 없는데 고르라고 묻는 화면은 한 번 더 누르게 할 뿐이다. 지금 이 화면을
// 보는 것은 사실상 소유자뿐이고, 그건 의도한 것이다.
const LABEL: Record<Area, { name: string; desc: string }> = {
  attend: { name: '출석', desc: '출석부 · 멤버 · 통계 · 새가족 · 키오스크' },
  slides: { name: '슬라이드', desc: '예배 슬라이드 만들기 · 라이브러리' },
  praise: { name: '찬양', desc: '콘티 · 악보 · 연습' },
}

export function AreaChoice() {
  const identity = useAdminAuth((s) => s.identity)
  const chooseArea = useAdminAuth((s) => s.chooseArea)
  const signOut = useAdminAuth((s) => s.signOut)
  const areas = areasOf(identity)

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-gutter">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <span className="grid size-14 place-items-center rounded-[20px] bg-primary text-primary-fg">
            <KccpMark size={30} />
          </span>
          <p className="text-center text-sm text-muted">
            이 자격은 영역을 <b className="text-text">{areas.length}개</b> 갖고 있습니다.
            <br />
            어디로 들어갈까요?
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          {areas.map((area) => (
            <button
              key={area}
              type="button"
              onClick={() => chooseArea(area)}
              className={
                'flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left shadow-[var(--shadow-sm)] ' +
                'transition-[box-shadow,transform,border-color] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
                'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow)] active:translate-y-0'
              }
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold tracking-tight">{LABEL[area].name}</span>
                <span className="mt-0.5 block text-xs text-muted">{LABEL[area].desc}</span>
              </span>
              <span aria-hidden className="text-lg text-subtle">
                ›
              </span>
            </button>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={signOut} className="self-center">
          로그아웃
        </Button>
      </div>
    </main>
  )
}

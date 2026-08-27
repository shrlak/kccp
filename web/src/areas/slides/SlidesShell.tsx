import { useAdminAuth } from '../../stores/useAdminAuth'
import { areasOf } from '../../lib/api'

// 슬라이드 영역의 껍데기.
//
// 지금 이 화면이 하는 일은 셋이다: 자격이 이 영역을 가졌는지 확인하고, 어느 부(部)의
// 예배를 맡는지 보여 주고, 다음에 무엇이 여기 들어오는지 적어 둔다. ppt의 6단계 마법사
// (찬양 → 성경 말씀 → 설교 → 광고 → 추가 자료 → 다운로드)는 vendor/ppt/ 에 히스토리째
// 들어와 있고, 그 순수 라이브러리를 이 폴더로 git mv 하는 것이 다음 단계다.
//
// 껍데기를 먼저 두는 이유: 영역 분리가 **실제로 도는지**를 마법사 이식과 분리해서
// 확인할 수 있기 때문이다. 이 화면에 들어와지면 자격·라우팅·게이트가 다 맞은 것이고,
// 그 위에 마법사를 얹는 일은 순수하게 화면 작업이 된다.

const SERVICES: Record<string, { name: string; time: string }[]> = {
  adult: [
    { name: '주일 1부', time: '오전 9:00' },
    { name: '주일 2부', time: '오전 11:15' },
  ],
  youth: [{ name: '주일 3부', time: '오후 2:00' }],
}

const STEPS = ['찬양', '성경 말씀', '설교', '광고', '추가 자료', '다운로드']

export function SlidesShell() {
  const identity = useAdminAuth((s) => s.identity)
  const signOut = useAdminAuth((s) => s.signOut)
  const partition = identity?.partition ?? 'youth'
  // 소유자는 두 부를 다 본다. 미디어 계정은 자기 부의 예배만.
  const services = areasOf(identity).includes('attend')
    ? [...SERVICES.adult, ...SERVICES.youth]
    : (SERVICES[partition] ?? [])

  return (
    <main className="min-h-dvh bg-canvas px-gutter pb-16 pt-6">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <header className="flex items-baseline gap-3">
          <h1 className="flex-1 text-xl font-semibold tracking-tight">슬라이드</h1>
          <span className="text-xs text-muted">{partition === "adult" ? "장년부" : "대학·청년부"}</span>
          <button type="button" onClick={signOut} className="text-xs font-medium text-primary">
            로그아웃
          </button>
        </header>

        <section className="rounded-lg bg-surface p-4">
          <h2 className="text-xs font-medium uppercase tracking-widest text-subtle">이번 주 예배</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {services.map((s) => (
              <li key={s.name} className="flex items-baseline gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                <span className="flex-1 text-[15px] font-medium">{s.name}</span>
                <span className="font-mono text-xs tabular-nums text-subtle">{s.time}</span>
              </li>
            ))}
          </ul>
          {services.length === 0 && <p className="mt-3 text-sm text-muted">맡은 예배가 없습니다.</p>}
        </section>

        <section className="rounded-lg bg-surface-alt p-4">
          <h2 className="text-xs font-medium uppercase tracking-widest text-subtle">다음 단계</h2>
          <ol className="mt-3 flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className="rounded-full bg-surface px-2.5 py-1 font-mono text-[11px] text-subtle"
              >
                {i + 1} {s}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            ppt의 6단계 마법사가 여기 들어옵니다. 코드는 <code className="font-mono text-xs">vendor/ppt/</code>에
            히스토리째 들어와 있고, 순수 라이브러리(<code className="font-mono text-xs">pptxMerge</code> ·{' '}
            <code className="font-mono text-xs">bible/</code>)를 이 폴더로 옮기는 것이 다음 작업입니다.
          </p>
        </section>

        <p className="px-1 text-center text-xs leading-relaxed text-subtle">
          이 화면이 열렸다면 자격·라우팅·영역 검사가 전부 맞은 것입니다.
          <br />
          출석 비밀번호로는 여기 들어올 수 없습니다.
        </p>
      </div>
    </main>
  )
}

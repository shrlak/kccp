// 슬라이드 영역 — 여섯 단계 마법사.
//
// 껍데기였던 화면에 ppt의 마법사가 들어왔다. 순서는 그대로다: 찬양 → 성경 말씀 → 설교 →
// 광고 → 추가 자료 → 다운로드. **그 순서가 곧 예배 순서**이고, 바꾸는 것은 리팩터링이
// 아니라 예배를 바꾸는 일이다 (조립 순서는 lib/buildDeck.ts).
//
// ppt의 styles.css(3,515줄)는 들고 오지 않았다. 마크업은 옮기되 클래스는 KCCP 토큰으로
// 갈아입혔다 — 그대로 옮기면 한 로그인 뒤의 두 화면이 서로 다른 앱처럼 보인다.
//
// 아직 오지 않은 것: 콘티 사진에서 가사를 읽어 내는 AI 인식 화면(LyricsGenerator ·
// SongCard, 4,890줄 중 절반)과 편집기 보기(SlideOverviewList · SlideThumbnail). 뒤엣것은
// 없어도 슬라이드가 만들어지고, 앞엣것은 lib/learning·lib/storage를 다시 지은 다음이다.
// 프록시(ai-proxy)와 그 클라이언트(lib/ai/proxy.ts)는 이미 서 있다.
import { useAdminAuth } from '../../stores/useAdminAuth'
import { BibleStep } from './steps/BibleStep'
import { DownloadStep } from './steps/DownloadStep'
import { ExtraStep } from './steps/ExtraStep'
import { NoticeStep } from './steps/NoticeStep'
import { PraiseStep } from './steps/PraiseStep'
import { SermonStep } from './steps/SermonStep'
import { Button } from './ui'
import { AreaHeader } from '../AreaHeader'
import { useWizard, WIZARD_STEPS } from './useWizard'

export function SlidesShell() {
  const identity = useAdminAuth((s) => s.identity)
  const partition = identity?.partition ?? 'youth'
  const wizard = useWizard()

  return (
    <main className="safe-x min-h-dvh bg-canvas pb-24">
      <AreaHeader title="슬라이드" meta={partition === 'adult' ? '장년부' : '대학·청년부'} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-5">
        <StepRail step={wizard.step} onMove={wizard.goTo} />

        {wizard.stepId === 'praise' && <PraiseStep wizard={wizard} />}
        {wizard.stepId === 'bible' && <BibleStep wizard={wizard} />}
        {wizard.stepId === 'sermon' && <SermonStep wizard={wizard} />}
        {wizard.stepId === 'notice' && <NoticeStep wizard={wizard} />}
        {wizard.stepId === 'extra' && <ExtraStep wizard={wizard} />}
        {wizard.stepId === 'download' && <DownloadStep wizard={wizard} />}

        <nav className="flex items-center justify-between gap-3" aria-label="단계 이동">
          {wizard.step > 0 ? (
            <Button onClick={wizard.back} data-testid={`wizard-back-${wizard.stepId}`}>
              ← 이전
            </Button>
          ) : (
            <span />
          )}
          {wizard.step < WIZARD_STEPS.length - 1 && (
            <Button variant="primary" onClick={wizard.next} data-testid={`wizard-next-${wizard.stepId}`}>
              다음: {WIZARD_STEPS[wizard.step + 1].label} →
            </Button>
          )}
        </nav>
      </div>
    </main>
  )
}

/** 단계 목록. 지나온 단계로는 되돌아갈 수 있어야 한다 — 광고를 적다 곡 하나가 떠오른다. */
function StepRail({ step, onMove }: { step: number; onMove: (n: number) => void }) {
  return (
    // 출석의 필터와 같은 분절 컨트롤이다 — 여섯 단계는 닫힌 집합이고, 지금 어디인지는
    // 트랙 위로 **떠오르는 것**으로 말한다. 예전에는 현재 단계가 꽉 찬 파란 알약이라
    // 화면에서 가장 센 색이 내용이 아니라 이동 막대였다.
    <ol className="segmented flex w-full flex-wrap justify-start" aria-label="단계">
      {WIZARD_STEPS.map((s, i) => {
        const state = i === step ? 'current' : i < step ? 'done' : 'todo'
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onMove(i)}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`min-h-8 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-[background-color,color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] ${
                state === 'current'
                  ? 'bg-surface text-text shadow-[var(--shadow-sm)]'
                  : state === 'done'
                    ? 'text-text hover:text-primary'
                    : 'text-subtle hover:text-text'
              }`}
            >
              {/* 번호와 이름 사이의 공백은 **읽히는 이름**의 일부다 ("1 찬양") — 여백을
                  margin으로만 주면 접근성 이름이 "1찬양"으로 붙는다. */}
              <span className="tabular-nums opacity-60">{i + 1}</span>{' '}
              {s.label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

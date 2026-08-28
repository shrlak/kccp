// 광고 — 번호 매긴 목록을 붙여 넣으면 그대로 슬라이드가 된다.
//
// 제목은 `1. <제목>` 처럼 꺾쇠 안에 온다. 붙여 넣는 원본이 카톡 공지나 메모 앱이라
// 마크다운 강조(**, __, ~~)가 섞여 오는데, 파서가 그것을 삼킨다 — 사람이 손으로 지우게
// 하면 매주 그 일을 하게 된다.
import { parseAnnouncements } from '../lib/utils/announcementBuilder'
import type { Wizard } from '../useWizard'
import { Card, Notice, TextArea } from '../ui'

const SAMPLE = `1. <새가족 환영>
오늘 처음 오신 분들을 진심으로 환영합니다.

2. <여름 수련회>
8월 30일(토) 진행됩니다.
- 주제: 일상으로 보냄받다
- 장소: 피츠버그 한인중앙교회`

export function NoticeStep({ wizard }: { wizard: Wizard }) {
  const { state, patch } = wizard
  const items = parseAnnouncements(state.announcementText)

  return (
    <div className="flex flex-col gap-4">
      <Card title="광고" hint="번호와 꺾쇠로 제목을 적습니다. 그 아래 줄이 본문입니다.">
        <TextArea
          value={state.announcementText}
          onChange={(e) => patch({ announcementText: e.target.value })}
          placeholder={SAMPLE}
          className="min-h-56 font-mono text-[13px]"
          aria-label="광고 본문"
        />
      </Card>

      <Card title={`미리 보기 — ${items.length}장`}>
        {items.length === 0 ? (
          <Notice>읽어 낸 광고가 없습니다. 광고가 없으면 이 구간은 통째로 빠집니다.</Notice>
        ) : (
          <ol className="flex flex-col gap-3">
            {items.map((item, i) => (
              <li key={i} className="rounded-md bg-surface-alt p-3">
                <p className="text-[15px] font-medium">{item.title}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {item.bodyLines.map((line, j) => (
                    <li key={j} className="text-[13px] leading-relaxed text-muted">
                      {line}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

// 성경 말씀 — 구절 입력, 번역본 최대 두 개.
//
// **번역본은 실제로 고른 것만 받는다.** 여섯 개가 27 MB이고, 여기서 무심코 정적 import로
// 바꾸면 그 무게가 첫 화면으로 딸려 온다. bibleData.loadTranslation은 조립할 때 fetch로
// 받고 메모리에 캐시한다 — 그 지연 로드가 이관에서 지켜야 하는 것이다.
import { normalizeContiScripture, parseVerseInput } from '../bible/refParser'
import { MAX_TRANSLATIONS, TRANSLATIONS, type Wizard } from '../useWizard'
import { Card, Field, Notice, TextInput } from '../ui'

export function BibleStep({ wizard }: { wizard: Wizard }) {
  const { state, patch } = wizard
  const bible = state.bible
  const { refs, invalidTokens } = parseVerseInput(normalizeContiScripture(bible.verseInput))

  const toggle = (id: string) => {
    const has = bible.translations.includes(id)
    const next = has
      ? bible.translations.filter((t) => t !== id)
      : [...bible.translations, id].slice(-MAX_TRANSLATIONS)
    patch({ bible: { ...bible, translations: next } })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="본문">
        <div className="flex flex-col gap-3">
          <Field label="구절" hint="예: 로마서 5:1-11, 요한복음 3:16. 콘티에서 읽어 온 표기도 그대로 넣을 수 있습니다.">
            <TextInput
              value={bible.verseInput}
              onChange={(e) => patch({ bible: { ...bible, verseInput: e.target.value } })}
              placeholder="로마서 5장 1-11절"
            />
          </Field>
          <Field label="설교 제목">
            <TextInput
              value={bible.sermonTitle}
              onChange={(e) => patch({ bible: { ...bible, sermonTitle: e.target.value } })}
            />
          </Field>
        </div>

        {refs.length > 0 && (
          <p className="mt-3 text-[13px] text-muted">
            {refs.length}개 구절을 읽었습니다.
          </p>
        )}
        {invalidTokens.length > 0 && (
          // 못 읽은 토큰은 조립을 멈추지 않는다 — 사람에게 보여 주고 계속 간다.
          <Notice kind="error">읽지 못한 부분: {invalidTokens.join(', ')}</Notice>
        )}
      </Card>

      <Card title="번역본" hint={`최대 ${MAX_TRANSLATIONS}개. 셋을 넘기면 한 슬라이드에 들어가지 않습니다.`}>
        <div className="flex flex-wrap gap-2">
          {TRANSLATIONS.map((t) => {
            const on = bible.translations.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t.id)}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  on ? 'bg-primary text-primary-fg' : 'bg-fill text-muted hover:bg-fill-hover'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          고른 번역본만 내려받습니다 (하나에 4–5 MB). 슬라이드를 만들 때 처음 한 번 받고, 그 뒤에는
          기기에 남습니다.
        </p>
      </Card>

      <Card title="한 장당 절 수">
        <Field label="절" hint="많이 넣을수록 글자가 작아집니다.">
          <TextInput
            type="number"
            min={1}
            max={6}
            value={bible.versesPerSlide}
            onChange={(e) => patch({ bible: { ...bible, versesPerSlide: Number(e.target.value) || 2 } })}
          />
        </Field>
      </Card>
    </div>
  )
}

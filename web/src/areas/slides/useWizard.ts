// 그 주의 내용 하나. 여섯 단계가 나눠 쓰는 상태다.
//
// ppt에서는 이것이 App.tsx 안의 열댓 개 useState였고, 단계 화면과 한 몸이었다. 떼어 둔
// 이유는 조립(buildDeck)이 이미 화면을 모르기 때문이다 — 상태까지 떼면 "이번 주에 무엇이
// 들어가는가"가 한 자리에 모이고, 그 자리를 읽는 것만으로 덱을 예측할 수 있다.
import { useCallback, useMemo, useState } from 'react'
import type { AdditionalFile } from './lib/additionalFiles/types'
import type { DeckInput } from './lib/buildDeck'
import type { Section, Song } from './lib/utils/types'

export const WIZARD_STEPS = [
  { id: 'praise', label: '찬양' },
  { id: 'bible', label: '성경 말씀' },
  { id: 'sermon', label: '설교' },
  { id: 'notice', label: '광고' },
  { id: 'extra', label: '추가 자료' },
  { id: 'download', label: '다운로드' },
] as const

export type StepId = (typeof WIZARD_STEPS)[number]['id']

/**
 * 번역본은 **최대 둘**이다. 셋이 되면 한 슬라이드에 들어가지 않는다 — 화면에서 막는
 * 것이 아니라 여기서 자른다.
 */
export const MAX_TRANSLATIONS = 2

export const TRANSLATIONS = [
  { id: 'nkrv', label: '개역개정' },
  { id: 'ko', label: '개역한글' },
  { id: 'saenew', label: '새번역' },
  { id: 'esv', label: 'ESV' },
  { id: 'niv', label: 'NIV' },
  { id: 'kjv', label: 'KJV' },
] as const

let nextId = 1
const newId = (prefix: string) => `${prefix}-${nextId++}`

export function emptySong(title = ''): Song {
  return {
    id: newId('song'),
    title,
    sections: [{ label: 'V1', lines: [''] }],
    order: ['V1'],
    // 템플릿의 기본값. 넘기면 가사가 슬라이드 밖으로 흐른다.
    linesPerSlide: 4,
  }
}

export interface WizardState extends DeckInput {
  /** 콘티에서 읽은 예배 날짜 ("8/30/26" 같은, 사람이 적은 모양). */
  contiDate?: string
  /** 고른 콘티의 setlists.id — 완성된 덱을 그 옆에 둘 때 쓴다. */
  setlistId?: string
}

export interface Wizard {
  state: WizardState
  step: number
  stepId: StepId
  goTo: (step: number) => void
  next: () => void
  back: () => void
  /** 부분 갱신 — 단계 컴포넌트는 자기 칸만 안다. */
  patch: (partial: Partial<WizardState>) => void
  songs: {
    add: (title?: string) => void
    remove: (id: string) => void
    update: (id: string, partial: Partial<Song>) => void
    setSections: (id: string, sections: Section[]) => void
  }
  files: {
    add: (file: AdditionalFile) => void
    remove: (id: string) => void
    move: (id: string, delta: number) => void
  }
  /** 파일 이름 후보. 콘티 날짜가 있으면 그것을 따르고, 없으면 오늘. */
  suggestedFileName: string
}

/** "8/30/26" · "2026-08-30" → "0830". 못 읽으면 오늘 날짜로. */
export function fileStemFromContiDate(raw: string | undefined, today = new Date()): string {
  const iso = raw?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[2]}${iso[3]}`
  const us = raw?.match(/^(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (us) return `${us[1].padStart(2, '0')}${us[2].padStart(2, '0')}`
  return `${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
}

export function useWizard(): Wizard {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>({
    songs: [],
    bible: { verseInput: '', sermonTitle: '', translations: ['nkrv', 'esv'], versesPerSlide: 2 },
    announcementText: '',
    additionalFiles: [],
  })

  const patch = useCallback((partial: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...partial }))
  }, [])

  const goTo = useCallback((next: number) => {
    setStep(Math.max(0, Math.min(WIZARD_STEPS.length - 1, next)))
  }, [])

  const songs = useMemo(
    () => ({
      add: (title = '') => setState((s) => ({ ...s, songs: [...s.songs, emptySong(title)] })),
      remove: (id: string) => setState((s) => ({ ...s, songs: s.songs.filter((x) => x.id !== id) })),
      update: (id: string, partial: Partial<Song>) =>
        setState((s) => ({ ...s, songs: s.songs.map((x) => (x.id === id ? { ...x, ...partial } : x)) })),
      setSections: (id: string, sections: Section[]) =>
        setState((s) => ({
          ...s,
          songs: s.songs.map((x) =>
            x.id === id
              // 순서(order)는 실재하는 파트만 가리켜야 한다. 파트를 지우고 순서를 그대로
              // 두면 빈 슬라이드가 생기고, 그것은 주일 아침 화면에서 보인다.
              ? { ...x, sections, order: x.order.filter((label) => sections.some((sec) => sec.label === label)) }
              : x,
          ),
        })),
    }),
    [],
  )

  const files = useMemo(
    () => ({
      add: (file: AdditionalFile) =>
        setState((s) => ({ ...s, additionalFiles: [...s.additionalFiles, file] })),
      remove: (id: string) =>
        setState((s) => ({ ...s, additionalFiles: s.additionalFiles.filter((f) => f.id !== id) })),
      // 추가 자료는 **순서가 내용의 일부**다 (예배 끝에 붙는 자료들이라 순서대로 나간다).
      move: (id: string, delta: number) =>
        setState((s) => {
          const list = [...s.additionalFiles]
          const from = list.findIndex((f) => f.id === id)
          const to = from + delta
          if (from < 0 || to < 0 || to >= list.length) return s
          const [moved] = list.splice(from, 1)
          list.splice(to, 0, moved)
          return { ...s, additionalFiles: list }
        }),
    }),
    [],
  )

  return {
    state,
    step,
    stepId: WIZARD_STEPS[step].id,
    goTo,
    next: useCallback(() => goTo(step + 1), [goTo, step]),
    back: useCallback(() => goTo(step - 1), [goTo, step]),
    patch,
    songs,
    files,
    suggestedFileName: `${fileStemFromContiDate(state.contiDate)}.pptx`,
  }
}

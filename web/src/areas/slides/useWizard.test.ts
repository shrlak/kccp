import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { fileStemFromContiDate, useWizard, WIZARD_STEPS } from './useWizard'
import type { AdditionalFile } from './lib/additionalFiles/types'

const file = (id: string, name: string): AdditionalFile =>
  ({ id, name, kind: 'pdf', data: new ArrayBuffer(0), slideCount: 1 })

describe('fileStemFromContiDate', () => {
  const today = new Date('2026-08-28T12:00:00Z')

  it('콘티가 적은 모양 그대로 읽는다', () => {
    expect(fileStemFromContiDate('8/30/26', today)).toBe('0830')
    expect(fileStemFromContiDate('12/7/26', today)).toBe('1207')
    expect(fileStemFromContiDate('2026-09-01', today)).toBe('0901')
  })

  it('못 읽으면 오늘로 — 이름이 없어 멈추는 일은 없다', () => {
    expect(fileStemFromContiDate(undefined, today)).toBe('0828')
    expect(fileStemFromContiDate('다음 주', today)).toBe('0828')
  })
})

describe('useWizard', () => {
  it('단계는 양 끝에서 멈춘다', () => {
    const { result } = renderHook(() => useWizard())
    act(() => result.current.back())
    expect(result.current.step).toBe(0)
    act(() => result.current.goTo(99))
    expect(result.current.step).toBe(WIZARD_STEPS.length - 1)
  })

  it('파트를 지우면 순서에서도 사라진다 — 남겨 두면 빈 슬라이드가 생긴다', () => {
    const { result } = renderHook(() => useWizard())
    act(() => result.current.songs.add('주 은혜임을'))
    const id = result.current.state.songs[0].id
    act(() =>
      result.current.songs.update(id, {
        sections: [
          { label: 'V1', lines: ['가'] },
          { label: 'C', lines: ['나'] },
        ],
        order: ['V1', 'C', 'V1'],
      }),
    )
    act(() => result.current.songs.setSections(id, [{ label: 'V1', lines: ['가'] }]))
    expect(result.current.state.songs[0].order).toEqual(['V1', 'V1'])
  })

  it('번역본은 최대 둘 — 셋째를 고르면 가장 오래된 것이 밀린다', () => {
    const { result } = renderHook(() => useWizard())
    expect(result.current.state.bible.translations).toEqual(['nkrv', 'esv'])
    act(() =>
      result.current.patch({
        bible: { ...result.current.state.bible, translations: ['nkrv', 'esv', 'niv'].slice(-2) },
      }),
    )
    expect(result.current.state.bible.translations).toEqual(['esv', 'niv'])
  })

  it('추가 자료는 순서가 내용의 일부다', () => {
    const { result } = renderHook(() => useWizard())
    act(() => {
      result.current.files.add(file('a', 'a.pdf'))
      result.current.files.add(file('b', 'b.pdf'))
      result.current.files.add(file('c', 'c.pdf'))
    })
    act(() => result.current.files.move('c', -1))
    expect(result.current.state.additionalFiles.map((f) => f.id)).toEqual(['a', 'c', 'b'])

    // 끝에서는 움직이지 않는다 — 조용히 목록 밖으로 나가면 그 자료가 사라진다.
    act(() => result.current.files.move('a', -1))
    expect(result.current.state.additionalFiles.map((f) => f.id)).toEqual(['a', 'c', 'b'])

    act(() => result.current.files.remove('c'))
    expect(result.current.state.additionalFiles.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('파일 이름은 콘티 날짜를 따른다', () => {
    const { result } = renderHook(() => useWizard())
    act(() => result.current.patch({ contiDate: '9/6/26' }))
    expect(result.current.suggestedFileName).toBe('0906.pptx')
  })
})

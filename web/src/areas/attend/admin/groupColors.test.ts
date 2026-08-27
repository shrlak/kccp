import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUP_COLORS, resolveGroupColor } from './groupColors'

describe('resolveGroupColor', () => {
  it('uses an administrator-configured color for analytics and other group accents', () => {
    expect(resolveGroupColor({ 대학부: '#123456', 청년부: '#ABCDEF' }, '대학부')).toBe('#123456')
    expect(resolveGroupColor({ 대학부: '#123456', 청년부: '#ABCDEF' }, '청년부')).toBe('#ABCDEF')
  })

  it('falls back when a configured value is absent or invalid', () => {
    expect(resolveGroupColor(undefined, '대학부')).toBe(DEFAULT_GROUP_COLORS.대학부)
    expect(resolveGroupColor({ 대학부: 'brown' }, '대학부')).toBe(DEFAULT_GROUP_COLORS.대학부)
  })
})

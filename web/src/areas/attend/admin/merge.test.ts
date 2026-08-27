import { describe, it, expect } from 'vitest'
import { mergeTargets, canMerge, mergeSummary } from './merge'
import type { Member } from '../../../lib/api'

const member = (id: string, name: string): Member => ({
  id, name, group_name: '', subgroup: '', member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})

describe('mergeTargets', () => {
  const members = [member('1', 'Chan'), member('2', 'Anna'), member('3', 'Bob')]

  it('excludes the source member', () => {
    expect(mergeTargets(members, '2').map((m) => m.id)).toEqual(['3', '1'])
  })
  it('sorts the remaining members by name', () => {
    expect(mergeTargets(members, '9').map((m) => m.name)).toEqual(['Anna', 'Bob', 'Chan'])
  })
})

describe('canMerge', () => {
  it('requires both ids, distinct', () => {
    expect(canMerge({ fromId: '1', toId: '2' })).toBe(true)
    expect(canMerge({ fromId: '1', toId: '1' })).toBe(false)
    expect(canMerge({ fromId: '', toId: '2' })).toBe(false)
    expect(canMerge({ fromId: '1', toId: '' })).toBe(false)
  })
})

describe('mergeSummary', () => {
  const members = [member('1', 'Chan'), member('2', 'Anna')]
  it('renders source → target by name', () => {
    expect(mergeSummary(members, { fromId: '1', toId: '2' })).toBe('Chan → Anna')
  })
  it('falls back to the id when a member is missing', () => {
    expect(mergeSummary(members, { fromId: 'x', toId: '2' })).toBe('x → Anna')
  })
})

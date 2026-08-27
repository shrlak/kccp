import { describe, it, expect } from 'vitest'
import { groupsOf, subgroupsOf, filterMembers, filterLog } from './filters'
import type { Member, LogEntry } from '../../../lib/api'

const m = (id: string, group: string, subgroup: string): Member => ({
  id, name: id, group_name: group, subgroup, member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
const e = (group: string, subgroup: string, date: string): LogEntry => ({
  name: 'x', group, subgroup, date, time: '', ts: 0,
})

const members = [m('1', '청년부', '건영'), m('2', '대학부', '호연'), m('3', '청년부', '호연'), m('4', '', '')]

describe('groupsOf', () => {
  it('returns distinct groups in preferred department order', () => {
    expect(groupsOf(members)).toEqual(['대학부', '청년부'])
  })
})

describe('subgroupsOf', () => {
  it('lists 동산 within a group, sorted', () => {
    expect(subgroupsOf(members, '청년부')).toEqual(['건영', '호연'])
  })
  it('lists 동산 across all groups when group is empty', () => {
    expect(subgroupsOf(members, '')).toEqual(['건영', '호연'])
  })
})

describe('filterMembers', () => {
  it('filters by group then 동산', () => {
    expect(filterMembers(members, { group: '청년부', subgroup: '' }).map((x) => x.id)).toEqual(['1', '3'])
    expect(filterMembers(members, { group: '청년부', subgroup: '호연' }).map((x) => x.id)).toEqual(['3'])
  })
  it('no filter returns all', () => {
    expect(filterMembers(members, { group: '', subgroup: '' })).toHaveLength(4)
  })
})

describe('filterLog', () => {
  const log = [e('청년부', '호연', '2026-06-07'), e('대학부', '호연', '2026-06-07'), e('청년부', '건영', '2026-06-07')]
  it('filters entries by group + 동산', () => {
    expect(filterLog(log, { group: '청년부', subgroup: '' })).toHaveLength(2)
    expect(filterLog(log, { group: '청년부', subgroup: '호연' })).toHaveLength(1)
  })
})

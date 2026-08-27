import { describe, it, expect } from 'vitest'
import type { Member, RosterResponse } from '../../../lib/api'
import { splitRoster } from './useRoster'

const member = (id: string, name: string, extra: Partial<Member> = {}): Member => ({
  id, name, group_name: '청년부', subgroup: '건영동산', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: false, notes: '', ...extra,
})
const roster = (members: Member[]): RosterResponse =>
  ({ role: 'super_admin', members, log: [] } as unknown as RosterResponse)

const TODAY = '2026-08-16'

// splitRoster is the single gate: whatever it leaves in `members` is what every tab shows,
// so these cases *are* the app-wide rule for who is on the roster.
describe('splitRoster', () => {
  it('takes staff out of the roster (unchanged behavior)', () => {
    const out = splitRoster(roster([member('1', '김호연'), member('2', '전도사', { is_staff: true })]), TODAY)
    expect(out.members.map((m) => m.name)).toEqual(['김호연'])
    expect(out.staffMembers.map((m) => m.name)).toEqual(['전도사'])
  })

  it('takes 무기한 표기 members out too, and hands them back as hiddenMembers', () => {
    const out = splitRoster(
      roster([
        member('1', '계속나오는멤버'),
        member('2', '졸업', { status_marks: [{ note: '졸업', start: '2026-05-10', end: null }] }),
        member('3', '타교회정착', { status_marks: [{ note: '타교회 정착', start: '2026-04-19', end: null }] }),
        member('4', '귀국', { status_note: '한국 귀국', status_start: '2026-07-05', status_end: null }),
      ]),
      TODAY,
    )
    expect(out.members.map((m) => m.name)).toEqual(['계속나오는멤버'])
    expect(out.hiddenMembers.map((m) => m.name)).toEqual(['졸업', '타교회정착', '귀국'])
  })

  it('keeps a bounded mark on the roster — 방학은 돌아올 날이 정해져 있다', () => {
    const out = splitRoster(
      roster([member('1', '방학중', { status_marks: [{ note: '방학', start: '2026-08-02', end: '2026-08-23' }] })]),
      TODAY,
    )
    expect(out.members.map((m) => m.name)).toEqual(['방학중'])
    expect(out.hiddenMembers).toEqual([])
  })

  it('is date-relative: a mark that has not started yet does not hide anyone', () => {
    const leaving = member('1', '곧떠남', { status_marks: [{ note: '한국 귀국', start: '2026-09-01', end: null }] })
    expect(splitRoster(roster([leaving]), TODAY).members).toHaveLength(1)
    expect(splitRoster(roster([leaving]), '2026-09-02').hiddenMembers).toHaveLength(1)
  })

  it('never loses anyone — every member lands in exactly one bucket', () => {
    const all = [
      member('1', 'A'),
      member('2', 'B', { is_staff: true }),
      member('3', 'C', { status_marks: [{ note: '이주', start: '2026-01-01', end: null }] }),
    ]
    const out = splitRoster(roster(all), TODAY)
    expect(out.members.length + out.staffMembers.length + out.hiddenMembers.length).toBe(all.length)
  })
})

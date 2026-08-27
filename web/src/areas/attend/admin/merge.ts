import type { Member } from '../../../lib/api'

export interface MergeState {
  fromId: string
  toId: string
}

// Members a source can merge INTO: everyone except the source itself, by name.
export function mergeTargets(members: Member[], fromId: string): Member[] {
  return members
    .filter((m) => m.id !== fromId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// A merge is valid only once both members are chosen and distinct.
export function canMerge(s: MergeState): boolean {
  return !!s.fromId && !!s.toId && s.fromId !== s.toId
}

// "source → target" summary for the destructive confirm prompt (mirrors the audit entry).
export function mergeSummary(members: Member[], s: MergeState): string {
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id
  return `${name(s.fromId)} → ${name(s.toId)}`
}

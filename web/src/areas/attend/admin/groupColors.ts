import { ADULT_GROUP } from '../../../lib/partition'

// ── 부서 accent colors ─────────────────────────────────────────────────────────
// One super-admin-configurable hex color per 부서 (config.group_colors, via
// AppConfig.groupColors), driving the 오늘 tab's name icons, the kiosk's per-부서 tile
// backgrounds, the 멤버 tab's per-부서 card backgrounds, and the 통계 tab's 부서별 비교
// bars — see AdminSettings.tsx for the editor. Falls back to the original hardcoded palette
// (matching the still-fixed accents in todaySheetImage.ts's exported JPG sheet) for any
// group without a saved color. Each 부 stores its own map, so the 장년부 default lives here
// beside the 대학·청년부 ones — one lookup table, whichever panel is open.

export const DEFAULT_GROUP_COLORS: Record<string, string> = {
  대학부: '#E0A800',
  청년부: '#3B82F6',
  [ADULT_GROUP]: '#10B981',
}

const NEUTRAL = '#6b7280'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isValidHex(v: string): boolean {
  return HEX_RE.test(v)
}

// Resolve a group's accent: a saved color, else the built-in default, else a neutral
// grey for groups with neither (e.g. staff, EM, Adult Ministry, no group at all).
export function resolveGroupColor(colors: Record<string, string> | undefined, group: string | null | undefined): string {
  if (!group) return NEUTRAL
  const saved = colors?.[group]
  if (saved && isValidHex(saved)) return saved
  return DEFAULT_GROUP_COLORS[group] ?? NEUTRAL
}

// "#E0A800" + alpha → "rgba(r, g, b, a)", for tinted backgrounds. Invalid hex falls
// back to a transparent neutral instead of throwing.
export function hexTint(hex: string, alpha: number): string {
  if (!isValidHex(hex)) return `rgba(107, 114, 128, ${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

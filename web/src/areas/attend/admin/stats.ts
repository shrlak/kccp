import type { Member, LogEntry } from '../../../lib/api'

export interface Stats {
  today: number // distinct attendees today
  members: number // members in the current scope/filter
  records: number // attendance rows in scope
  days: number // distinct attendance dates in scope
}

// The four stat-bar numbers, computed over an already-filtered members + log.
export function computeStats(members: Member[], log: LogEntry[], today: string): Stats {
  const days = new Set(log.map((e) => e.date))
  const todayNames = new Set(log.filter((e) => e.date === today).map((e) => e.name))
  return { today: todayNames.size, members: members.length, records: log.length, days: days.size }
}

export interface Dashboard {
  total: number
  present: number
  absent: number
  absentNames: string[]
  avgRate: number // % attendance averaged over the last 4 recorded dates
}

// Leader dashboard for a scoped (group+동산) members + log set.
export function leaderDashboard(members: Member[], log: LogEntry[], today: string): Dashboard {
  const total = members.length
  const presentToday = new Set(log.filter((e) => e.date === today).map((e) => e.name))
  const absentNames = members.filter((m) => !presentToday.has(m.name)).map((m) => m.name)
  const present = total - absentNames.length

  const recentDates = [...new Set(log.map((e) => e.date))].sort().slice(-4)
  const rates = recentDates.map((d) => {
    // A member only counts toward a date's denominator from their 등록일자 onward —
    // dates before someone joined are not absences.
    const eligible = members.filter((m) => !m.registration_date || m.registration_date <= d).length
    const attendees = new Set(log.filter((e) => e.date === d).map((e) => e.name)).size
    return eligible ? attendees / eligible : 0
  })
  const avgRate = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : 0

  return { total, present, absent: absentNames.length, absentNames, avgRate }
}

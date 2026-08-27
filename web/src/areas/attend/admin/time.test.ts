import { describe, it, expect } from 'vitest'
import { minutesToHHMM, hhmmToMinutes } from './time'

describe('check-in window time helpers', () => {
  it('minutesToHHMM', () => {
    expect(minutesToHHMM(780)).toBe('13:00') // 1:00 PM
    expect(minutesToHHMM(900)).toBe('15:00') // 3:00 PM
    expect(minutesToHHMM(0)).toBe('00:00')
    expect(minutesToHHMM(570)).toBe('09:30')
  })
  it('hhmmToMinutes', () => {
    expect(hhmmToMinutes('13:00')).toBe(780)
    expect(hhmmToMinutes('15:00')).toBe(900)
    expect(hhmmToMinutes('09:30')).toBe(570)
  })
  it('round-trips', () => {
    for (const min of [0, 60, 780, 900, 1439]) expect(hhmmToMinutes(minutesToHHMM(min))).toBe(min)
  })
})

import { describe, it, expect } from 'vitest'
import { loadQrEncoder, modulesToPath } from './qrEncode'

describe('loadQrEncoder', () => {
  it('produces a square module grid with the QR finder patterns in place', async () => {
    const encode = await loadQrEncoder()
    const m = encode('MECARD:N:Kim;TEL:+14127030123;;')
    expect(m.length).toBeGreaterThan(0)
    expect(m.every((row) => row.length === m.length)).toBe(true)
    // 세 모서리의 파인더 패턴 — 왼쪽 위/오른쪽 위/왼쪽 아래는 검고, 오른쪽 아래는 아니다.
    const n = m.length
    expect(m[0][0]).toBe(true)
    expect(m[0][n - 1]).toBe(true)
    expect(m[n - 1][0]).toBe(true)
    expect(m[n - 1][n - 1]).toBe(false)
  })

  it('encodes Korean as UTF-8, not latin1', async () => {
    // 이름이 한글이므로 이게 틀리면 찍었을 때 이름이 깨져 나온다. 라이브러리의 기본
    // stringToBytes는 latin1(한 글자 1바이트)이다 — UTF-8이면 한글 한 글자가 3바이트이므로
    // 한글 n자는 ASCII 3n자와 같은 크기의 판에 담긴다. 짧은 글자로는 갈리지 않는다
    // (가장 작은 판이 17바이트까지 담으므로 3바이트든 9바이트든 같은 크기다) — 판이
    // 반드시 달라지는 길이로 묻는다.
    const encode = await loadQrEncoder()
    expect(encode('김'.repeat(20)).length).toBe(encode('a'.repeat(60)).length)
    expect(encode('김'.repeat(20)).length).not.toBe(encode('a'.repeat(20)).length)
  })

  it('reuses the one loaded encoder', async () => {
    expect(await loadQrEncoder()).toBe(await loadQrEncoder())
  })
})

describe('modulesToPath', () => {
  it('emits one unit square per dark module', () => {
    expect(modulesToPath([[true, false], [false, true]])).toBe('M0 0h1v1h-1zM1 1h1v1h-1z')
  })
  it('is empty when nothing is dark', () => {
    expect(modulesToPath([[false, false], [false, false]])).toBe('')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setAdminToken } from '../../../lib/api'
import { archiveSetlist, getSetlists, uploadConti } from './setlists'

function mockJson(...responses: unknown[]) {
  const spy = vi.fn()
  for (const body of responses) {
    spy.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('setlists client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    setAdminToken('jwt')
  })

  it('기본은 보관되지 않은 것만 — 보관은 지운 것이 아니다', async () => {
    const spy = mockJson({ setlists: [] })
    await getSetlists()
    expect(String(spy.mock.calls[0][0])).not.toContain('archived=1')

    const spy2 = mockJson({ setlists: [] })
    await getSetlists({ includeArchived: true, date: '2026-08-30' })
    expect(String(spy2.mock.calls[0][0])).toContain('archived=1')
    expect(String(spy2.mock.calls[0][0])).toContain('date=2026-08-30')
  })

  it('업로드는 두 걸음 — 자리를 잡고, 서명 URL로 바이트를 보낸다', async () => {
    const spy = mockJson(
      { setlistId: 's1', bucket: 'kccp-conti', path: '2026-08-30/s1/conti.pdf', uploadUrl: 'https://storage/signed', token: 't', expiresIn: 1800 },
      {},
    )
    const file = new File([new Uint8Array([1, 2, 3])], 'conti.pdf', { type: 'application/pdf' })
    const out = await uploadConti({ teamId: 't1', serviceId: 'sv1', serviceDate: '2026-08-30' }, file)

    expect(out).toEqual({ setlistId: 's1', path: '2026-08-30/s1/conti.pdf' })
    // 첫 걸음은 엣지 함수, 두 번째는 Storage로 곧장 — 바이트는 함수를 지나가지 않는다.
    expect(String(spy.mock.calls[0][0])).toContain('/api/slides/setlists')
    expect(String(spy.mock.calls[1][0])).toBe('https://storage/signed')
    expect(spy.mock.calls[1][1].method).toBe('PUT')
    expect(spy.mock.calls[1][1].body).toBe(file)
  })

  it('Storage가 거절하면 조용히 넘어가지 않는다', async () => {
    const spy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ setlistId: 's1', uploadUrl: 'https://storage/signed', path: 'p', bucket: 'b', token: 't', expiresIn: 1800 }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve(null) })
    vi.stubGlobal('fetch', spy)
    // 자리는 잡혔는데 파일이 없는 콘티가 남으면 목록에는 보이고 열면 없는 줄이 된다.
    await expect(
      uploadConti({ teamId: 't1', serviceId: 'sv1', serviceDate: '2026-08-30' }, new File([], 'c.pdf')),
    ).rejects.toThrow('HTTP 403')
  })

  it('보관은 되돌릴 수 있다', async () => {
    const spy = mockJson({ id: 's1', archived: false })
    await archiveSetlist('s1', true)
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ restore: true })
  })
})

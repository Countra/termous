import { afterEach, expect, test, vi } from 'vitest'
import type { CloudStatus } from '#common/contracts'
import { CloudClient } from './cloudClient'

afterEach(() => vi.unstubAllGlobals())

test('云状态请求在账号切换后才返回时，调用方同样获得当前账号状态', async () => {
  let respond!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
  const api = new CloudClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  const before: CloudStatus = { generation: 'before', revision: 1, binding_id: 'old-account', configured: true, authenticated: true, phase: 'ready', confirmed: true, auto_sync: true, pending: 0, conflicts: 0 }
  api.acceptStatus(before)
  const pending = api.status()
  const current = { ...before, generation: 'after', binding_id: 'new-account', revision: 2 }
  api.acceptStatus(current)
  respond(Response.json(before))
  expect(await pending).toEqual(current)
  expect(api.getStatus()).toEqual(current)
})

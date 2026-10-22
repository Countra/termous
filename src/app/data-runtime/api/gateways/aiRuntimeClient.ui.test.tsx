import { afterEach, expect, it, vi } from 'vitest'
import { AIRuntimeClient } from './aiRuntimeClient'

afterEach(() => vi.unstubAllGlobals())

it('组件状态和实际设备分别读取 Core 接口，开发环境无需安装检查记录', async () => {
  const runtime = { managed: false, state: 'development', profile: '', download_size: 0,
    device: { name: '', driver: 0, eligible: false } }
  const service = { state: 'ready', device: 'cuda' }
  const fetch = vi.fn(async (input: RequestInfo | URL) => Response.json(
    new URL(String(input)).pathname === '/api/v1/ai-service/status' ? service : runtime))
  vi.stubGlobal('fetch', fetch)
  const client = new AIRuntimeClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'test-token' })
  expect(await client.status()).toEqual({ ...runtime, service })
  expect(fetch.mock.calls.map(([input]) => String(input)).sort()).toEqual([
    'http://127.0.0.1:8122/api/v1/ai-service/runtime', 'http://127.0.0.1:8122/api/v1/ai-service/status',
  ])
})

import { afterEach, expect, it, vi } from 'vitest'
import { AIRuntimeClient } from './aiRuntimeClient'

afterEach(() => vi.unstubAllGlobals())

it('工具栏读取服务状态不执行组件检查', async () => {
  const service = { state: 'idle', device: 'cuda', instance_id: 'fixture' }
  const fetch = vi.fn().mockResolvedValue(Response.json(service))
  vi.stubGlobal('fetch', fetch)
  const client = new AIRuntimeClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'test-token' })
  expect(await client.serviceStatus()).toEqual(service)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(String(fetch.mock.calls[0]![0])).toBe('http://127.0.0.1:8122/api/v1/ai-service/status')
})

it('预热只调用本机 Core 的固定接口', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ state: 'loading' }, { status: 202 }))
  vi.stubGlobal('fetch', fetch)
  const client = new AIRuntimeClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'test-token' })
  await client.warmup()
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, options] = fetch.mock.calls[0]!
  expect(String(url)).toBe('http://127.0.0.1:8122/api/v1/ai-service/warmup')
  expect(options.method).toBe('POST')
  expect(options.headers['X-Termous-Token']).toBe('test-token')
})

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

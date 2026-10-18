import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'
import { useStorageStatus } from './useStorageStatus'

const { notification, translate } = vi.hoisted(() => ({
  notification: { warning: vi.fn(), destroy: vi.fn() },
  translate: (key: string, values?: { modules?: string; codes?: string }) => values ? `${key}:${values.modules}:${values.codes}` : key,
}))
vi.mock('antd', async (original) => ({ ...await original<typeof import('antd')>(), App: { useApp: () => ({ notification }) } }))
vi.mock('react-i18next', async (original) => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: translate }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

function runtime() {
  return createRuntimeGatewaysFromConfig({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'fixture-token' }).runtime
}

test('等待 API 就绪，再明确提示不可用模块并保留正常模块', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ databases: [
    { domain: 'core', status: 'ready', version: 51 },
    { domain: 'agent', status: 'unavailable', code: 'DB_SCHEMA_INVALID' },
  ] }))
  vi.stubGlobal('fetch', fetch)
  const client = runtime()
  const view = renderHook(({ enabled }) => useStorageStatus(client, enabled), { initialProps: { enabled: false } })
  expect(fetch).not.toHaveBeenCalled()
  view.rerender({ enabled: true })
  await waitFor(() => expect(notification.warning).toHaveBeenCalledOnce())
  expect(notification.warning).toHaveBeenCalledWith(expect.objectContaining({
    duration: 0, role: 'alert', description: 'storageStatus.unavailable:storageStatus.domains.agent:DB_SCHEMA_INVALID',
  }))
  view.unmount()
  expect(notification.destroy).toHaveBeenCalledWith('storage-unavailable')
})

test('关闭页面后迟到响应不能重新弹出故障通知', async () => {
  let finish!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
  const runtimeClient = runtime()
  const view = renderHook(() => useStorageStatus(runtimeClient, true))
  view.unmount()
  await act(async () => { finish(Response.json({ databases: [{ domain: 'agent', status: 'unavailable' }] })) })
  expect(notification.warning).not.toHaveBeenCalled()
})

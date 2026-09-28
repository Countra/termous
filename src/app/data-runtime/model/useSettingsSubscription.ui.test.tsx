import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '../api/runtimeGateways'
import { useSettingsSubscription } from './useSettingsSubscription'

afterEach(() => vi.unstubAllGlobals())

test('暂停订阅丢弃在途响应并保留已确认设置，真正切换 Core 才清空', async () => {
  vi.stubGlobal('WebSocket', class { close = vi.fn() })
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
  const client = createRuntimeGatewaysFromConfig({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'fixture-token' }).settings
  client.acceptInstance('current-core')
  client.modules.merge({ id: 'appearance', schema_version: 1, revision: 1, value: { theme: 'light' }, state: { status: 'applied' } })
  const view = renderHook(({ enabled }) => useSettingsSubscription(client, enabled), { initialProps: { enabled: true } })
  const pending = client.readModule('appearance')
  view.rerender({ enabled: false })
  expect(client.currentSettings().appearance.theme).toBe('light')
  finish(Response.json({ id: 'appearance', schema_version: 1, revision: 99, value: { theme: 'dark' }, state: { status: 'applied' } }))
  await expect(pending).rejects.toThrow('SETTINGS_REQUEST_SUPERSEDED')
  view.rerender({ enabled: true })
  expect(client.currentSettings().appearance.theme).toBe('light')
  act(() => client.acceptInstance('new-core'))
  expect(client.getModule('appearance')).toBeUndefined()
  view.unmount()
})

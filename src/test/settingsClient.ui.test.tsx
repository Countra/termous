import { afterEach, expect, test, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'
import type { SettingsSnapshot } from '#common/contracts'

afterEach(() => vi.unstubAllGlobals())

test.each(['old-core', 'current-core'])('首次收到实例事件后，只接受同一 Core 的目录响应：%s', async (responseInstance) => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
  const client = createRuntimeGatewaysFromConfig({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'fixture-token' }).settings
  const pending = client.settings()
  client.acceptInstance('current-core')
  finish(Response.json({ instance_id: responseInstance, modules: [{
    id: 'appearance', schema_version: 1, backup: 'include', apply: 'immediate',
    snapshot: { id: 'appearance', schema_version: 1, revision: 4, value: { theme: 'light' }, state: { status: 'applied' } },
  }] }))
  if (responseInstance === 'current-core') {
    expect((await pending).appearance.theme).toBe('light')
  } else {
    await expect(pending).rejects.toThrow('SETTINGS_REQUEST_SUPERSEDED')
    expect(client.getModule('appearance')).toBeUndefined()
  }
})

test('首次实例确认丢弃身份尚未确认时发出的模块读取', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
  const client = createRuntimeGatewaysFromConfig({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'fixture-token' }).settings
  const pending = client.readModule('appearance')
  client.acceptInstance('current-core')
  finish(Response.json({ id: 'appearance', schema_version: 1, revision: 99, value: { theme: 'light' }, state: { status: 'applied' } }))
  await expect(pending).rejects.toThrow('SETTINGS_REQUEST_SUPERSEDED')
  expect(client.getModule('appearance')).toBeUndefined()
})

test('连续修改连接策略保留先前确认的其他开关，补全按字段提交', async () => {
  const initial: SettingsSnapshot = {
    id: 'connection', schema_version: 1, revision: 1,
    value: { ssh_keepalive_enabled: false, forward_auto_reconnect_enabled: false, remote_desktop_auto_reconnect_enabled: true },
    state: { status: 'applied' },
  }
  const first = { ...initial, revision: 2, value: { ...initial.value, ssh_keepalive_enabled: true } }
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(initial))
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(Response.json({ ...first, revision: 3, value: { ...first.value, forward_auto_reconnect_enabled: true } }))
    .mockResolvedValueOnce(Response.json({ ...initial, id: 'completion', value: { enabled: true, ai_enabled: false, providers: { history: true } } }))
    .mockResolvedValueOnce(Response.json({ ...initial, id: 'completion', revision: 2, value: { enabled: true, ai_enabled: false, providers: { history: false } } }))
  vi.stubGlobal('fetch', fetchMock)
  const client = createRuntimeGatewaysFromConfig({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'fixture-token' }).settings
  const keepalive = client.updateConnectionSettings({ ssh_keepalive_enabled: true })
  const reconnect = client.updateConnectionSettings({ forward_auto_reconnect_enabled: true })
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  finish(Response.json(first))
  await Promise.all([keepalive, reconnect])
  const body = (index: number) => JSON.parse(fetchMock.mock.calls[index][1].body as string)
  expect(body(2)).toEqual({ expected_revision: 2, patch: { ...first.value, forward_auto_reconnect_enabled: true } })
  await client.updateCompletionSettings({ providers: { history: false } })
  expect(body(4)).toEqual({ expected_revision: 1, patch: { providers: { history: false } } })
})

test('模块同步保持其他设置引用稳定，切换 Core 后清除旧确认值', () => {
  const client = createRuntimeGatewaysFromConfig({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'fixture-token' }).settings
  client.acceptInstance('first-core')
  const initial = client.currentSettings()
  const appearance: SettingsSnapshot = { id: 'appearance', schema_version: 1, revision: 2, value: { theme: 'light' }, state: { status: 'applied' } }
  client.modules.merge(appearance)
  const changed = client.currentSettings()
  expect(changed.appearance.theme).toBe('light')
  expect(changed.terminal).toBe(initial.terminal)
  expect(changed.completion).toBe(initial.completion)
  client.modules.merge(structuredClone(appearance))
  expect(client.currentSettings()).toBe(changed)
  client.acceptInstance('next-core')
  expect(client.currentSettings().appearance.theme).toBe('dark')
})

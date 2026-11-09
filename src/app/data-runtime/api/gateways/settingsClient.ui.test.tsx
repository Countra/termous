import { afterEach, expect, test, vi } from 'vitest'
import { coreSettingsModules, screenAnalysisDefaults } from '#common/contracts'
import { decodeSettingsEvent } from '#entities/settings'
import { SettingsClient } from './settingsClient'

afterEach(() => vi.unstubAllGlobals())

function catalogue(status: 'applied' | 'unavailable' = 'applied') {
  return {
    instance_id: 'core-settings-fixture',
    modules: coreSettingsModules.map(id => {
      const schema_version = id === 'agent' || id === 'connection' || id === 'screen_analysis' ? 2 : 1
      const value = id === 'screen_analysis' ? { ...screenAnalysisDefaults } : id === 'screen_analysis_storage' ? { max_bytes: 1073741824, max_records: 500, retention_days: 7 } : id === 'desktop_clipboard' ? { enabled: true } : id === 'desktop_files' ? { mappings: [] } : id === 'language' ? { language: 'en-US' } : id === 'connection' ? { rdp_unattended_timeout_minutes: 15 } : {}
      return { id, schema_version, backup: ['language', 'appearance', 'terminal', 'completion', 'connection', 'shortcuts', 'window', 'screen_analysis', 'screen_analysis_storage'].includes(id) ? 'include' : 'exclude', apply: id === 'mount' ? 'restart' : 'immediate',
        snapshot: { id, schema_version, revision: 1, value, state: { status: id === 'desktop_files' || id === 'desktop_clipboard' ? status : 'applied' } } }
    }),
  }
}

test.each(['applied', 'unavailable'] as const)('启动通过真实设置 Gateway 接纳桌面文件模块（%s），保留原有设置', async status => {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json(catalogue(status)))
  vi.stubGlobal('fetch', fetch)
  const api = new SettingsClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  const settings = await api.settings()
  expect(settings.language).toBe('en-US')
  expect(settings.connection.rdp_unattended_timeout_minutes).toBe(15)
  expect(api.getModule('desktop_files')).toMatchObject({ id: 'desktop_files', value: { mappings: [] }, state: { status } })
  expect(api.getModule('desktop_clipboard')).toMatchObject({ id: 'desktop_clipboard', value: { enabled: true }, state: { status } })
  expect(api.getModule('screen_analysis')).toMatchObject({ schema_version: 2, value: screenAnalysisDefaults })
  expect(api.getModule('screen_analysis_storage')).toMatchObject({ schema_version: 1, value: { max_records: 500 } })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(String(fetch.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8122/api/v1/settings')
})

test('旧 Core 未提供桌面文件模块时仍正常加载设置', async () => {
  const response = catalogue()
  response.modules = response.modules.filter(module => module.id !== 'desktop_files')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response)))
  const api = new SettingsClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  expect((await api.settings()).language).toBe('en-US')
  expect(api.getModule('desktop_files')).toBeUndefined()
})

test('桌面文件变更事件、读取和更新均归 Core，写入保留版本校验', async () => {
  const snapshot = catalogue().modules.find(module => module.id === 'desktop_files')!.snapshot
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockResolvedValueOnce(Response.json({ ...snapshot, revision: 2 }))
  vi.stubGlobal('fetch', fetch)
  const api = new SettingsClient({ apiBaseUrl: 'http://127.0.0.1:8122' })
  const event = decodeSettingsEvent({ instance_id: 'core-settings-fixture', type: 'changed', module: 'desktop_files', revision: 2 })
  expect(event).toMatchObject({ type: 'changed', module: 'desktop_files' })
  expect((await api.readModule('desktop_files')).revision).toBe(1)
  const patch = { session_id: 'fixture', generation: 1, mapping_id: 'mapping', remember: true }
  expect((await api.updateModule('desktop_files', patch)).revision).toBe(2)
  expect(fetch.mock.calls.map(call => String(call[0]))).toEqual([
    'http://127.0.0.1:8122/api/v1/settings/desktop_files', 'http://127.0.0.1:8122/api/v1/settings/desktop_files',
  ])
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ expected_revision: 1, patch }) })
})

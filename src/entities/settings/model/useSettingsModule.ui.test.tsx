import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { SettingsSnapshot } from '#common/contracts'
import { useSettingsModule, type SettingsGateway } from './useSettingsModule'

test('网关移除后清除加载状态，旧请求返回不影响新网关', async () => {
  let finish!: (snapshot: SettingsSnapshot) => void
  const oldGateway: SettingsGateway = {
    getModule: () => undefined,
    readModule: vi.fn(() => new Promise<SettingsSnapshot>((resolve) => { finish = resolve })),
    updateModule: vi.fn(),
    subscribeSettings: () => () => {},
  }
  const snapshot: SettingsSnapshot = { id: 'audit', schema_version: 1, revision: 1, value: { enabled: true }, state: { status: 'applied' } }
  const currentGateway: SettingsGateway = { ...oldGateway, readModule: vi.fn(async () => snapshot) }
  const view = renderHook(({ gateway }: { gateway: SettingsGateway | null }) => useSettingsModule('audit', { gateway }), { initialProps: { gateway: oldGateway as SettingsGateway | null } })
  await waitFor(() => expect(view.result.current.busy).toBe(true))
  view.rerender({ gateway: null })
  expect(view.result.current.available).toBe(false)
  expect(view.result.current.busy).toBe(false)
  view.rerender({ gateway: currentGateway })
  await waitFor(() => expect(view.result.current.busy).toBe(false))
  await act(async () => { finish({ ...snapshot, revision: 99 }) })
  expect(view.result.current.error).toBeNull()
  await act(async () => { await view.result.current.refresh() })
  expect(currentGateway.readModule).toHaveBeenCalledTimes(2)
})

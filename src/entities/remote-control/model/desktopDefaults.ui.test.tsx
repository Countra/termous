import { expect, test, vi } from 'vitest'
import { presentationDefaults } from '@termous/remote-protocol/presentation'
import type { RemoteWindowBridge } from '#common/contracts'
import { readDesktopDefaults } from './desktopDefaults'

test('独立远控窗口从观看端桥接读取默认质量，旧端或失败时反馈回退', async () => {
  const defaults = presentationDefaults('economy')
  const read = vi.fn().mockResolvedValue({ ok: true, value: { value: defaults } })
  const bridge = { desktopQualityDefaults: read } as unknown as RemoteWindowBridge
  const loaded = await readDesktopDefaults(bridge, 'connection')
  expect(read).toHaveBeenCalledWith('connection')
  expect(loaded.defaults).toEqual(defaults)
  expect(loaded.defaults).not.toBe(defaults)
  const fallback = await readDesktopDefaults({} as RemoteWindowBridge, 'connection')
  expect(fallback.defaults).toEqual(presentationDefaults())
  expect(fallback.warning).toBeTruthy()
})

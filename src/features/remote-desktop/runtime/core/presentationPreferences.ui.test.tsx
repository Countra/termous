import { expect, test } from 'vitest'
import { presentationDefaults } from '@termous/remote-protocol/presentation'
import { DesktopPresentationPreferences } from './presentationPreferences.ts'

test('默认值固定于会话代次，重新附着恢复覆盖，新代次重新读取', async () => {
  let defaults = presentationDefaults('economy')
  const store = new DesktopPresentationPreferences(async () => ({ defaults }))
  const first = store.capture('session', 1)
  await first.ready
  defaults = presentationDefaults('balanced')
  first.preference.settings = { kind: 'pixels', updateRateLimit: 7 }
  expect(store.capture('session', 1)).toBe(first)
  expect(first.preference.defaults?.pixels.updateRateLimit).toBe(15)
  const second = store.capture('session', 2)
  await second.ready
  expect(second.preference.settings).toBeUndefined()
  expect(second.preference.defaults?.pixels.updateRateLimit).toBe(20)
  store.clear()
  expect(store.capture('session', 2)).not.toBe(second)
})

test('迟到读取只填默认值，失败提供可见反馈', async () => {
  let resolve!: (value: { defaults: ReturnType<typeof presentationDefaults> }) => void
  const store = new DesktopPresentationPreferences(() => new Promise(done => { resolve = done }))
  const first = store.capture('session', 1)
  first.preference.settings = { kind: 'pixels', updateRateLimit: 5 }
  resolve({ defaults: presentationDefaults() })
  await first.ready
  expect(first.preference.settings.updateRateLimit).toBe(5)
  const failed = new DesktopPresentationPreferences(async () => { throw new Error('read_failed') }).capture('session', 1)
  await failed.ready
  expect(failed.preference.warning).toBeTruthy()
  expect(failed.preference.defaults).toEqual(presentationDefaults())
})

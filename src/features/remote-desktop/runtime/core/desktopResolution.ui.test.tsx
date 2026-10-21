import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DesktopResolution, type DesktopResolutionState, type DesktopSize } from './desktopResolution.ts'

const original = { width: 1920, height: 1080 }
const windowSize = { width: 1280, height: 720 }
const larger = { width: 1600, height: 900 }
const instances: DesktopResolution[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => { instances.forEach(item => item.dispose()); instances.length = 0; vi.useRealTimers() })

function fixture(followWindow = false) {
  const states: DesktopResolutionState[] = []
  const requests: Array<{ size: DesktopSize; accept(): void; reject(): void }> = []
  const display = new DesktopResolution({ followWindow, normalize: size => size,
    send: size => new Promise<void>((resolve, reject) => requests.push({ size, accept: resolve, reject: () => reject(new Error('denied')) })),
    changed: state => states.push(state),
  })
  instances.push(display)
  display.updateSize(original)
  display.setAvailability(true, true, true)
  display.updateViewport(windowSize)
  return { display, requests, states, status: () => states[states.length - 1].status }
}

test('持续收帧不推迟跟随请求，回执和实际尺寸都确认后才完成', async () => {
  const f = fixture(true)
  for (let i = 0; i < 40; i++) {
    f.display.updateSize(original)
    f.display.updateViewport(windowSize)
    await vi.advanceTimersByTimeAsync(50)
  }
  expect(f.requests).toHaveLength(1)
  f.requests[0].accept()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.status()).toBe('pending')
  f.display.updateSize(windowSize)
  expect(f.status()).toBe('idle')
})

test('反复进入跟随再返回固定，恢复最初尺寸并且不重复发送', async () => {
  const f = fixture()
  for (let i = 0; i < 3; i++) {
    f.display.setFollowWindow(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(f.requests[f.requests.length - 1].size).toEqual(windowSize)
    f.display.updateSize(windowSize)
    f.requests[f.requests.length - 1].accept()
    await vi.advanceTimersByTimeAsync(0)
    f.display.setFollowWindow(false)
    await vi.advanceTimersByTimeAsync(300)
    expect(f.requests[f.requests.length - 1].size).toEqual(original)
    f.requests[f.requests.length - 1].accept()
    f.display.updateSize(original)
    await vi.advanceTimersByTimeAsync(500)
    expect(f.status()).toBe('idle')
  }
  expect(f.requests).toHaveLength(6)
})

test('在途切换仅保留最终目标，迟到画面不能覆盖固定基准', async () => {
  const f = fixture(true)
  await vi.advanceTimersByTimeAsync(300)
  f.display.updateViewport(larger)
  f.display.setFollowWindow(false)
  f.display.setFollowWindow(true)
  f.display.setFollowWindow(false)
  await vi.advanceTimersByTimeAsync(500)
  expect(f.requests).toHaveLength(1)
  f.requests[0].accept()
  f.display.updateSize(windowSize)
  await vi.advanceTimersByTimeAsync(300)
  expect(f.requests[1].size).toEqual(original)
})

test.each(['inactive', 'readonly', 'unsupported'] as const)('%s 时取消未发送请求，恢复条件后应用当前意图', async reason => {
  const f = fixture(true)
  await vi.advanceTimersByTimeAsync(100)
  f.display.setAvailability(reason !== 'inactive', reason !== 'readonly', reason !== 'unsupported')
  await vi.advanceTimersByTimeAsync(500)
  expect(f.requests).toHaveLength(0)
  f.display.setAvailability(true, true, true)
  await vi.advanceTimersByTimeAsync(300)
  expect(f.requests).toHaveLength(1)
})

test.each(['reject', 'timeout'] as const)('%s 不循环重发，显式重试才重新提交', async outcome => {
  const f = fixture(true)
  await vi.advanceTimersByTimeAsync(300)
  if (outcome === 'reject') f.requests[0].reject()
  await vi.advanceTimersByTimeAsync(10_000)
  for (let i = 0; i < 20; i++) { f.display.updateSize(original); await vi.advanceTimersByTimeAsync(100) }
  expect(f.requests).toHaveLength(1)
  expect(f.status()).toBe(outcome === 'reject' ? 'failed' : 'timeout')
  f.display.setFollowWindow(true)
  await vi.advanceTimersByTimeAsync(300)
  expect(f.requests).toHaveLength(2)
})

test.each(['inactive', 'readonly', 'unsupported'] as const)('发送微任务前变为 %s 不误报失败，恢复后继续应用目标', async reason => {
  const f = fixture(true)
  vi.advanceTimersByTime(300)
  f.display.setAvailability(reason !== 'inactive', reason !== 'readonly', reason !== 'unsupported')
  await vi.advanceTimersByTimeAsync(0)
  expect(f.requests).toHaveLength(0)
  expect(f.status()).toBe(reason === 'unsupported' ? 'unsupported' : 'waiting')
  f.display.setAvailability(true, true, true)
  await vi.advanceTimersByTimeAsync(300)
  expect(f.requests).toHaveLength(1)
  expect(f.requests[0].size).toEqual(windowSize)
})

test('新连接重新获取固定基准，销毁后的请求回执无效', async () => {
  const f = fixture(true)
  await vi.advanceTimersByTimeAsync(300)
  f.display.dispose()
  const n = fixture(true)
  f.requests[0].accept()
  await vi.advanceTimersByTimeAsync(300)
  expect(n.states[n.states.length - 1].fixed).toEqual(original)
  expect(f.requests).toHaveLength(1)
})

test('退出跟随后旧请求超时又迟到生效，仍恢复原固定尺寸', async () => {
  const f = fixture(true)
  await vi.advanceTimersByTimeAsync(300)
  f.display.setFollowWindow(false)
  await vi.advanceTimersByTimeAsync(10_000)
  f.display.updateSize(original)
  expect(f.status()).toBe('timeout')
  f.display.updateSize(windowSize)
  await vi.advanceTimersByTimeAsync(300)
  expect(f.requests[f.requests.length - 1].size).toEqual(original)
  expect(f.states[f.states.length - 1].fixed).toEqual(original)
})

test('恢复固定尺寸被拒绝后，布局变化不会隐式重试', async () => {
  const f = fixture(true)
  await vi.advanceTimersByTimeAsync(300)
  f.requests[0].accept()
  f.display.updateSize(windowSize)
  await vi.advanceTimersByTimeAsync(0)
  f.display.setFollowWindow(false)
  await vi.advanceTimersByTimeAsync(300)
  f.requests[1].reject()
  await vi.advanceTimersByTimeAsync(0)
  f.display.updateViewport(larger)
  f.display.updateSize(windowSize)
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.status()).toBe('failed')
  expect(f.requests).toHaveLength(2)
  f.display.setFollowWindow(false)
  await vi.advanceTimersByTimeAsync(300)
  expect(f.requests[2].size).toEqual(original)
})

test('旧请求尚未确认时，显式重试固定尺寸仍会发送恢复请求', async () => {
  const f = fixture(true)
  await vi.advanceTimersByTimeAsync(300)
  f.display.setFollowWindow(false)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(f.status()).toBe('timeout')
  f.display.setFollowWindow(false)
  await vi.advanceTimersByTimeAsync(300)
  expect(f.requests).toHaveLength(2)
  expect(f.requests[1].size).toEqual(original)
  f.requests[1].accept()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.status()).toBe('idle')
})

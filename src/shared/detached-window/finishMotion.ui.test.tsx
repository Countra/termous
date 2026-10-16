import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { finishDetachedMotion } from './finishMotion.ts'

let element: HTMLElement
let animations: Animation[]
const animation = (finished: Promise<unknown>, endTime = 220) => ({
  finished, playState: 'running', effect: { getComputedTiming: () => ({ endTime }) },
}) as Animation

beforeEach(() => {
  vi.useFakeTimers()
  element = document.createElement('section')
  animations = []
  vi.spyOn(element, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  Object.defineProperty(element, 'getAnimations', { value: () => animations })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('等待退出动画完成，但忽略不结束的加载指示动画', async () => {
  let finish!: () => void
  animations.push(animation(new Promise(resolve => { finish = () => resolve(undefined) })), animation(new Promise(() => undefined), Infinity))
  const done = vi.fn()
  const pending = finishDetachedMotion(element).then(done)
  await vi.advanceTimersByTimeAsync(100)
  expect(done).not.toHaveBeenCalled()
  finish()
  await pending
  expect(done).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('被遮挡导致动画停滞时有限等待，取消动画也正常结束交接', async () => {
  animations.push(animation(new Promise(() => undefined)))
  const done = vi.fn()
  const pending = finishDetachedMotion(element).then(done)
  await vi.advanceTimersByTimeAsync(399)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await pending
  expect(done).toHaveBeenCalledOnce()
  animations = [animation(Promise.reject(new Error('animation_cancelled')))]
  await finishDetachedMotion(element)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['reduced', 'hidden', 'unmounted'] as const)('%s 时跳过过渡等待', async mode => {
  animations.push(animation(new Promise(() => undefined)))
  if (mode === 'reduced') vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
  if (mode === 'hidden') vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  if (mode === 'unmounted') vi.spyOn(element, 'getClientRects').mockReturnValue([] as unknown as DOMRectList)
  await finishDetachedMotion(element)
  expect(vi.getTimerCount()).toBe(0)
})

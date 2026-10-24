import { afterEach, expect, it, vi } from 'vitest'
import { AgentPartViewport } from './agentPartViewport.ts'

afterEach(() => vi.unstubAllGlobals())

it('二百片段共享观察器，释放离屏内容并保留实测高度，卸载后清空所有登记', () => {
  let intersections!: IntersectionObserverCallback
  let sizes!: ResizeObserverCallback
  const unobserve = vi.fn(), disconnect = vi.fn(), sizeDisconnect = vi.fn()
  const construct = vi.fn()
  const root = document.createElement('div')
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) { intersections = callback; construct(options.root) }
    observe() {}
    unobserve = unobserve
    disconnect = disconnect
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { sizes = callback }
    observe() {}
    unobserve() {}
    disconnect = sizeDisconnect
  })
  const viewport = new AgentPartViewport()
  const nodes = Array.from({ length: 200 }, () => document.createElement('div'))
  const update = vi.fn()
  const release = nodes.map(node => viewport.observe(node, root, update))
  expect(construct).toHaveBeenCalledExactlyOnceWith(root)
  intersections([{ target: nodes[0], isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver)
  expect(update).toHaveBeenLastCalledWith(true, 48)
  sizes([{ target: nodes[0], borderBoxSize: [{ blockSize: 344 }] }] as unknown as ResizeObserverEntry[], {} as ResizeObserver)
  intersections([{ target: nodes[0], isIntersecting: false }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver)
  expect(update).toHaveBeenLastCalledWith(false, 344)
  release.forEach(stop => stop())
  expect(unobserve).toHaveBeenCalledTimes(200)
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(sizeDisconnect).toHaveBeenCalledTimes(1)
  update.mockClear()
  intersections([{ target: nodes[0], isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver)
  expect(update).not.toHaveBeenCalled()
})

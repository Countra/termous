import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAgentConversationScroll } from './useAgentConversationScroll.ts'

function Harness({ version = 0 }: { version?: number }) {
  const scroll = useAgentConversationScroll({ active: true, sessionKey: 'session', content: version })
  return <>
    <div data-testid="viewport" ref={scroll.viewportRef} {...scroll.scrollEvents}>
      <div data-testid="content" ref={scroll.contentRef}><button>加载较早内容</button><p>{version}</p></div>
    </div>
    <button onClick={scroll.resume}>回到最新</button>
  </>
}

afterEach(() => vi.unstubAllGlobals())

describe('滚动意图与尾部跟随', () => {
  it.each([false, true])('虚拟正文恢复高度后补齐窗口交接位置，用户主动滚动可取消恢复：%s', cancel => {
    const frames = new Map<number, FrameRequestCallback>()
    let sequence = 0, height = 100, top = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    let resized!: ResizeObserverCallback
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resized = callback }
      observe() {}
      disconnect() {}
    })
    const presentation = { conversations: { session: { top: 60, follow: false } } }
    function Restoring() {
      const scroll = useAgentConversationScroll({ active: true, sessionKey: 'session', presentation, content: 0 })
      return <div data-testid="restoring" ref={node => {
        scroll.viewportRef.current = node
        if (node) Object.defineProperties(node, {
          clientHeight: { configurable: true, value: 200 }, scrollHeight: { configurable: true, get: () => height },
          scrollTop: { configurable: true, get: () => top, set: value => { top = Math.max(0, Math.min(value, height - 200)) } },
        })
      }} {...scroll.scrollEvents}><div ref={scroll.contentRef}>待恢复的正文</div></div>
    }
    const view = render(<Restoring />)
    const viewport = view.getByTestId('restoring')
    expect(top).toBe(0)
    fireEvent.scroll(viewport)
    expect(presentation.conversations.session.top).toBe(60)
    if (cancel) fireEvent.wheel(viewport, { deltaY: -8 })
    height = 500
    act(() => resized([], {} as ResizeObserver))
    act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)) })
    expect(top).toBe(cancel ? 0 : 60)
    view.unmount()
  })

  it.each(['wheel', 'touch', 'keyboard', 'scrollbar'])('%s 在下一帧前停止跟随，小幅上滚不会被拉回', kind => {
    const frames = new Map<number, FrameRequestCallback>()
    let sequence = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const resize: ResizeObserverCallback[] = []
    const observed: Element[] = []
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize.push(callback) }
      observe(node: Element) { observed.push(node) }
      disconnect = disconnect
    })
    const view = render(<Harness />)
    const viewport = view.getByTestId('viewport')
    const scrollTo = vi.fn(() => { viewport.scrollTop = 700 })
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 700 }, scrollTo: { value: scrollTo },
    })
    const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(frame => frame(0)) })
    flush()
    scrollTo.mockClear()
    view.rerender(<Harness version={1} />)
    expect(frames.size).toBe(1)
    if (kind === 'wheel') fireEvent.wheel(viewport, { deltaY: -8 })
    if (kind === 'touch') {
      fireEvent.touchStart(viewport, { touches: [{ clientY: 100 }] })
      fireEvent.touchMove(viewport, { touches: [{ clientY: 108 }] })
    }
    if (kind === 'keyboard') fireEvent.keyDown(viewport, { key: 'ArrowUp' })
    if (kind === 'scrollbar') fireEvent.pointerDown(viewport)
    // 上滚意图先于真实位移；迟到的程序 scroll 事件不能重新开启跟随。
    fireEvent.scroll(viewport)
    act(() => resize.forEach(callback => callback([], {} as ResizeObserver)))
    flush()
    expect(scrollTo).not.toHaveBeenCalled()
    viewport.scrollTop = 692
    fireEvent.scroll(viewport)
    view.rerender(<Harness version={2} />)
    act(() => resize.forEach(callback => callback([], {} as ResizeObserver)))
    flush()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(viewport.scrollTop).toBe(692)
    expect(observed).toEqual([view.getByTestId('content')])
    viewport.scrollTop = 700
    fireEvent.scroll(viewport)
    view.rerender(<Harness version={3} />)
    flush()
    expect(scrollTo).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })
})

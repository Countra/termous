import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { AgentSessionGroup } from '#entities/agent'
import type { AgentWorkspaceSession } from './types.ts'
import { useSessionSidebarDrag, type SessionSidebarDragOptions } from './useSessionSidebarDrag.ts'

const sessions: AgentWorkspaceSession[] = [
  { id: 'ordinary', title: '普通', model_id: 'model', model_name: '模型', updated_at: '', archived: false, run_status: 'idle', group_id: 'g1' },
  { id: 'pinned', title: '置顶', model_id: 'model', model_name: '模型', updated_at: '', archived: false, run_status: 'idle', pinned: true, group_id: 'g2' },
]
const groups: AgentSessionGroup[] = ['g1', 'g2'].map((id, sort_order) => ({ id, name: id, sort_order, revision: 1, created_at: '', updated_at: '' }))
const originalElementFromPoint = document.elementFromPoint
let host: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('aside')
  host.innerHTML = '<div data-agent-sidebar-pin-drop></div><div data-list><section data-agent-session-group="g1"><div data-agent-session-header><button data-grip="g1"></button></div><div data-agent-session-id="ordinary"><button data-grip="ordinary"></button></div></section><section data-agent-session-group="g2"><div data-agent-session-header><button data-grip="g2"></button></div><div data-agent-session-id="pinned"><button data-grip="pinned"></button></div></section></div>'
  document.body.append(host)
})
afterEach(() => {
  host.remove()
  document.elementFromPoint = originalElementFromPoint
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function element(selector: string) {
  const value = host.querySelector<HTMLElement>(selector)
  if (!value) throw new Error(`缺少测试节点 ${selector}`)
  return value
}
function row(id: string) { return element(`[data-agent-session-id="${id}"]`) }
function grip(id: string) { return element(`[data-grip="${id}"]`) }
function geometry(node: HTMLElement, top: number, height: number) {
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 300, height))
}
function fixture() {
  const list = element('[data-list]')
  geometry(list, 0, 200)
  Object.defineProperties(list, { clientHeight: { value: 200 }, scrollHeight: { value: 400 } })
  geometry(row('ordinary'), 40, 40)
  geometry(row('pinned'), 100, 40)
  for (const group of groups) {
    const section = element(`[data-agent-session-group="${group.id}"]`)
    geometry(section, group.id === 'g1' ? 0 : 80, 400)
    geometry(section.querySelector<HTMLElement>('[data-agent-session-header]')!, group.id === 'g1' ? 0 : 80, 20)
  }
  const hit = vi.fn<(x: number, y: number) => Element | null>().mockReturnValue(row('pinned'))
  document.elementFromPoint = hit
  const options: SessionSidebarDragOptions = {
    sessions, groups, listRef: { current: list }, pendingIds: new Set(), disabled: false,
    execute: vi.fn(async (_key, operation) => { await operation(); return true }),
    onMoveSession: vi.fn().mockResolvedValue(undefined), onMoveToGroup: vi.fn().mockResolvedValue(undefined),
    onPin: vi.fn().mockResolvedValue(undefined), onMoveGroup: vi.fn().mockResolvedValue(undefined),
  }
  const view = renderHook((current) => useSessionSidebarDrag(current), { initialProps: options })
  return { ...view, options, hit, list }
}
function dragEvent(currentTarget: HTMLElement, y = 110): DragEvent<HTMLElement> {
  return {
    currentTarget, target: currentTarget, clientX: 100, clientY: y,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    dataTransfer: { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'none', dropEffect: 'none' },
  } as unknown as DragEvent<HTMLElement>
}
function pointerDown(currentTarget: HTMLElement, type = 'touch'): ReactPointerEvent<HTMLElement> {
  return {
    currentTarget, pointerType: type, pointerId: 7, isPrimary: true, button: 0, clientX: 100, clientY: 50,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLElement>
}
function pointerEvent(type: string, y = 110, x = 100) {
  const event = new Event(type, { cancelable: true, bubbles: true })
  Object.assign(event, { pointerId: 7, clientX: x, clientY: y })
  window.dispatchEvent(event)
  return event
}
function clickEvent(currentTarget: HTMLElement, detail = 1, target: EventTarget = currentTarget): ReactMouseEvent<HTMLElement> {
  let prevented = false
  return {
    currentTarget, target, detail, get defaultPrevented() { return prevented },
    preventDefault: () => { prevented = true }, stopPropagation: vi.fn(),
  } as unknown as ReactMouseEvent<HTMLElement>
}

describe('useSessionSidebarDrag', () => {
  it('普通与置顶行相互拖动只提交一次原子排序，不先发置顶或移组请求', async () => {
    for (const [source, target] of [[sessions[0], sessions[1]], [sessions[1], sessions[0]]]) {
      const view = fixture()
      act(() => view.result.current.rowDragProps(source).onDragStart!(dragEvent(grip(source.id))))
      const targetEvent = dragEvent(row(target.id), target.id === 'pinned' ? 105 : 45)
      act(() => view.result.current.rowDragProps(target).onDragOver!(targetEvent))
      expect(view.result.current.drop).toEqual({ kind: 'session-order', id: target.id, placement: 'before' })
      await act(async () => view.result.current.rowDragProps(target).onDrop!(targetEvent))
      expect(view.options.onMoveSession).toHaveBeenCalledExactlyOnceWith(source.id, target.id, 'before')
      expect(view.options.onPin).not.toHaveBeenCalled()
      expect(view.options.onMoveToGroup).not.toHaveBeenCalled()
      expect(view.result.current.source).toBeUndefined()
      view.unmount()
    }
  })

  it('分组拖动的影子和前后判定只使用标题，不使用展开后的整组高度', async () => {
    const view = fixture()
    const start = dragEvent(grip('g1'))
    act(() => view.result.current.sectionDragProps('g1').onDragStart!(start))
    expect(start.dataTransfer.setDragImage).toHaveBeenCalledWith(grip('g1').parentElement, 20, 14)
    const target = dragEvent(element('[data-agent-session-group="g2"]'), 95)
    act(() => view.result.current.sectionDragProps('g2').onDragOver!(target))
    expect(view.result.current.drop).toEqual({ kind: 'group-order', id: 'g2', placement: 'after' })
    await act(async () => view.result.current.sectionDragProps('g2').onDrop!(target))
    expect(view.options.onMoveGroup).toHaveBeenCalledExactlyOnceWith('g1', 'g2', 'after')
  })

  it('进入无效目标立即清除旧落点，数据或忙碌状态变化后不能提交旧排序', async () => {
    const view = fixture()
    act(() => view.result.current.rowDragProps(sessions[0]).onDragStart!(dragEvent(grip('ordinary'))))
    act(() => view.result.current.rowDragProps(sessions[1]).onDragOver!(dragEvent(row('pinned'))))
    expect(view.result.current.drop).toBeDefined()
    act(() => view.result.current.rowDragProps(sessions[0]).onDragOver!(dragEvent(row('ordinary'))))
    expect(view.result.current.drop).toBeUndefined()
    act(() => view.result.current.rowDragProps(sessions[1]).onDragOver!(dragEvent(row('pinned'))))
    view.rerender({ ...view.options, pendingIds: new Set(['pinned']) })
    expect(view.result.current.drop).toBeUndefined()
    await act(async () => view.result.current.rowDragProps(sessions[1]).onDrop!(dragEvent(row('pinned'))))
    expect(view.options.onMoveSession).not.toHaveBeenCalled()
    act(() => view.result.current.rowDragProps(sessions[0]).onDragStart!(dragEvent(grip('ordinary'))))
    view.rerender({ ...view.options, sessions: [sessions[1]] })
    expect(view.result.current.source).toBeUndefined()
  })

  it('触屏抓手满300ms才启动，松开按当前命中行提交并清理预览', async () => {
    const view = fixture()
    const handle = grip('ordinary')
    handle.setPointerCapture = vi.fn()
    handle.hasPointerCapture = vi.fn().mockReturnValue(true)
    handle.releasePointerCapture = vi.fn()
    act(() => view.result.current.handlePointerProps({ kind: 'session', id: 'ordinary' }).onPointerDown!(pointerDown(handle)))
    act(() => vi.advanceTimersByTime(299))
    expect(view.result.current.source).toBeUndefined()
    act(() => vi.advanceTimersByTime(1))
    expect(view.result.current.source).toEqual({ kind: 'session', id: 'ordinary' })
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7)
    act(() => pointerEvent('pointermove', 130))
    expect(view.result.current.preview).toMatchObject({ x: 100, y: 130 })
    expect(view.result.current.drop).toEqual({ kind: 'session-order', id: 'pinned', placement: 'after' })
    await act(async () => { pointerEvent('pointerup', 130) })
    expect(view.options.onMoveSession).toHaveBeenCalledExactlyOnceWith('ordinary', 'pinned', 'after')
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(view.result.current.preview).toBeUndefined()
    expect(view.result.current.drop).toBeUndefined()
  })

  it('长按前移动取消候选手势，鼠标pointer和普通滚动不会激活触屏拖动', () => {
    const view = fixture()
    const handle = view.result.current.handlePointerProps({ kind: 'session', id: 'ordinary' })
    act(() => handle.onPointerDown!(pointerDown(grip('ordinary'))))
    let moved: Event | undefined
    act(() => { moved = pointerEvent('pointermove', 65) })
    expect(moved?.defaultPrevented).toBe(false)
    act(() => vi.advanceTimersByTime(500))
    expect(view.result.current.source).toBeUndefined()
    act(() => handle.onPointerDown!(pointerDown(grip('ordinary'), 'mouse')))
    act(() => vi.advanceTimersByTime(500))
    expect(view.result.current.source).toBeUndefined()
    expect(view.options.onMoveSession).not.toHaveBeenCalled()
  })

  it('取消、Escape、失焦和卸载均释放长按与滚动，不会执行写操作', () => {
    for (const cancel of ['pointercancel', 'escape', 'blur', 'unmount'] as const) {
      const view = fixture()
      act(() => view.result.current.handlePointerProps({ kind: 'session', id: 'ordinary' }).onPointerDown!(pointerDown(grip('ordinary'))))
      act(() => vi.advanceTimersByTime(300))
      act(() => pointerEvent('pointermove', 195))
      if (cancel === 'unmount') view.unmount()
      else act(() => {
        if (cancel === 'pointercancel') pointerEvent(cancel)
        if (cancel === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        if (cancel === 'blur') window.dispatchEvent(new Event('blur'))
      })
      const before = view.list.scrollTop
      act(() => vi.advanceTimersByTime(1_000))
      expect(view.list.scrollTop).toBe(before)
      expect(view.options.onMoveSession).not.toHaveBeenCalled()
      if (cancel !== 'unmount') { expect(view.result.current.source).toBeUndefined(); view.unmount() }
    }
  })

  it('长列表边缘自动滚动重新定位落点，到边界和离开列表后停止', () => {
    const view = fixture()
    act(() => view.result.current.rowDragProps(sessions[0]).onDragStart!(dragEvent(grip('ordinary'))))
    act(() => view.result.current.rowDragProps(sessions[1]).onDragOver!(dragEvent(row('pinned'), 195)))
    act(() => vi.advanceTimersByTime(100))
    expect(view.list.scrollTop).toBeGreaterThan(0)
    expect(view.hit).toHaveBeenCalledWith(100, 195)
    act(() => vi.advanceTimersByTime(2_000))
    expect(view.list.scrollTop).toBe(200)
    act(() => view.result.current.listDragProps.onDragLeave!({ currentTarget: view.list, relatedTarget: document.body } as unknown as DragEvent<HTMLElement>))
    expect(view.result.current.drop).toBeUndefined()
    act(() => vi.advanceTimersByTime(500))
    expect(view.list.scrollTop).toBe(200)
  })

  it('置顶行投到同组头取消置顶，顶栏稳定投放区支持触屏置顶', async () => {
    const view = fixture()
    act(() => view.result.current.rowDragProps(sessions[1]).onDragStart!(dragEvent(grip('pinned'))))
    await act(async () => view.result.current.sectionDragProps('g2').onDrop!(dragEvent(element('[data-agent-session-group="g2"]'))))
    expect(view.options.onMoveToGroup).toHaveBeenCalledExactlyOnceWith('pinned', 'g2', true)
    act(() => view.result.current.handlePointerProps({ kind: 'session', id: 'ordinary' }).onPointerDown!(pointerDown(grip('ordinary'))))
    act(() => vi.advanceTimersByTime(300))
    view.hit.mockReturnValue(element('[data-agent-sidebar-pin-drop]'))
    await act(async () => { pointerEvent('pointerup', 5) })
    expect(view.options.onPin).toHaveBeenCalledExactlyOnceWith('ordinary', true)
    expect(view.options.onMoveSession).not.toHaveBeenCalled()
  })

  it('分组标题长按松开只抑制本手势点击，名称子节点与随后普通点击均正确处理', () => {
    const view = fixture()
    const title = grip('g1')
    const name = document.createElement('strong')
    title.append(name)
    view.hit.mockReturnValue(title)
    const source = { kind: 'group' as const, id: 'g1' }
    act(() => view.result.current.handlePointerProps(source).onPointerDown!(pointerDown(title)))
    act(() => vi.advanceTimersByTime(300))
    act(() => { pointerEvent('pointerup', 10) })
    const synthesized = clickEvent(title, 1, name)
    act(() => view.result.current.handlePointerProps(source).onClick!(synthesized))
    expect(synthesized.defaultPrevented).toBe(true)
    expect(view.options.onMoveGroup).not.toHaveBeenCalled()
    act(() => view.result.current.handlePointerProps(source).onPointerDown!(pointerDown(title, 'mouse')))
    const normal = clickEvent(title, 1, name)
    act(() => view.result.current.handlePointerProps(source).onClick!(normal))
    expect(normal.defaultPrevented).toBe(false)
    const keyboard = clickEvent(title, 0)
    act(() => view.result.current.handlePointerProps(source).onClick!(keyboard))
    expect(keyboard.defaultPrevented).toBe(false)
  })

  it('长按取消后不会吞下一次普通点击，Escape 后同手势松开仍不会误折叠', () => {
    for (const cancellation of ['pointercancel', 'escape', 'blur'] as const) {
      const view = fixture()
      const title = grip('g1')
      const source = { kind: 'group' as const, id: 'g1' }
      act(() => view.result.current.handlePointerProps(source).onPointerDown!(pointerDown(title)))
      act(() => vi.advanceTimersByTime(300))
      act(() => {
        if (cancellation === 'pointercancel') pointerEvent('pointercancel')
        if (cancellation === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        if (cancellation === 'blur') window.dispatchEvent(new Event('blur'))
      })
      if (cancellation === 'escape') {
        act(() => { pointerEvent('pointerup') })
        const synthesized = clickEvent(title)
        act(() => view.result.current.handlePointerProps(source).onClick!(synthesized))
        expect(synthesized.defaultPrevented).toBe(true)
      }
      act(() => view.result.current.handlePointerProps(source).onPointerDown!(pointerDown(title, 'mouse')))
      const normal = clickEvent(title)
      act(() => view.result.current.handlePointerProps(source).onClick!(normal))
      expect(normal.defaultPrevented).toBe(false)
      expect(view.options.onMoveGroup).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('点击抑制只针对发起按钮并在pointerup当前任务后清理，不残留到后续native拖动', () => {
    const view = fixture()
    const source = { kind: 'group' as const, id: 'g1' }
    const activate = () => {
      act(() => view.result.current.handlePointerProps(source).onPointerDown!(pointerDown(grip('g1'))))
      act(() => vi.advanceTimersByTime(300))
      view.hit.mockReturnValue(grip('g1'))
      act(() => { pointerEvent('pointerup', 10) })
    }
    activate()
    const other = clickEvent(grip('g2'))
    act(() => view.result.current.handlePointerProps({ kind: 'group', id: 'g2' }).onClick!(other))
    expect(other.defaultPrevented).toBe(false)
    activate()
    act(() => vi.advanceTimersByTime(0))
    const afterGesture = clickEvent(grip('g1'))
    act(() => view.result.current.handlePointerProps(source).onClick!(afterGesture))
    expect(afterGesture.defaultPrevented).toBe(false)
    act(() => view.result.current.sectionDragProps('g1').onDragStart!(dragEvent(grip('g1'))))
    act(() => view.result.current.sectionDragProps('g1').onDragEnd!(dragEvent(grip('g1'))))
    const afterNative = clickEvent(grip('g1'))
    act(() => view.result.current.handlePointerProps(source).onClick!(afterNative))
    expect(afterNative.defaultPrevented).toBe(false)
  })
})

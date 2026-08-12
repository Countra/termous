import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandDockResizeHandle } from '../widgets/workbench/ui/CommandDockResizeHandle'

function rectangle(height: number) {
  return {
    bottom: height,
    height,
    left: 0,
    right: 800,
    top: 0,
    width: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

function renderHandle(onHeightChange = vi.fn(), open = true) {
  const rendered = render(
    <div>
      <button type="button" data-command-dispatch-toggle="">命令台</button>
      <div data-testid="terminal-workspace" />
      <div data-testid="command-dock-slot">
        <CommandDockResizeHandle
          open={open}
          preferredHeight={262}
          onHeightChange={onHeightChange}
        />
      </div>
    </div>,
  )
  return {
    handle: screen.getByRole('separator', { hidden: !open }),
    slot: screen.getByTestId('command-dock-slot'),
    onHeightChange,
    rerender: (nextOpen: boolean) => rendered.rerender(
      <div>
        <button type="button" data-command-dispatch-toggle="">命令台</button>
        <div data-testid="terminal-workspace" />
        <div data-testid="command-dock-slot">
          <CommandDockResizeHandle
            open={nextOpen}
            preferredHeight={262}
            onHeightChange={onHeightChange}
          />
        </div>
      </div>,
    ),
  }
}

describe('命令台高度拖动条', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete document.body.dataset.termousBottomDrawerResizing
  })

  it('提供完整分隔条语义和键盘边界操作', () => {
    const { handle, onHeightChange } = renderHandle()

    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    expect(handle).toHaveAttribute('aria-valuemin', '200')
    expect(handle).toHaveAttribute('aria-valuemax', '520')
    expect(handle).toHaveAttribute('aria-valuenow', '262')

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onHeightChange).toHaveBeenLastCalledWith(270)
    expect(handle).toHaveAttribute('aria-valuenow', '270')

    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true })
    expect(onHeightChange).toHaveBeenLastCalledWith(246)

    fireEvent.keyDown(handle, { key: 'End' })
    expect(onHeightChange).toHaveBeenLastCalledWith(520)

    fireEvent.keyDown(handle, { key: 'Home' })
    expect(onHeightChange).toHaveBeenLastCalledWith(200)
  })

  it('按动画帧跟随纵向拖动并只在结束时提交高度', () => {
    let frameCallback: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback
      return 31
    })
    const { handle, slot, onHeightChange } = renderHandle()

    fireEvent.pointerDown(handle, { button: 0, clientY: 300, pointerId: 7 })
    expect(handle).toHaveFocus()
    fireEvent.pointerMove(window, { clientY: 240, pointerId: 7 })
    expect(document.body).toHaveAttribute('data-termous-bottom-drawer-resizing', 'true')
    expect(onHeightChange).not.toHaveBeenCalled()

    const pendingFrame = frameCallback as FrameRequestCallback | null
    expect(pendingFrame).not.toBeNull()
    act(() => pendingFrame?.(0))
    expect(slot.style.getPropertyValue('--terminal-command-drawer-height')).toBe('322px')

    fireEvent.pointerUp(window, { pointerId: 7 })
    expect(onHeightChange).toHaveBeenCalledOnce()
    expect(onHeightChange).toHaveBeenCalledWith(322)
    expect(document.body).not.toHaveAttribute('data-termous-bottom-drawer-resizing')
  })

  it('关闭时退出键盘顺序并忽略指针拖动', () => {
    const { handle, onHeightChange } = renderHandle(undefined, false)

    expect(handle).toHaveAttribute('aria-hidden', 'true')
    expect(handle).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.pointerDown(handle, { button: 0, clientY: 300, pointerId: 9 })
    fireEvent.pointerMove(window, { clientY: 200, pointerId: 9 })
    fireEvent.pointerUp(window, { pointerId: 9 })
    expect(onHeightChange).not.toHaveBeenCalled()
  })

  it('关闭时把分隔条焦点交还命令台入口', () => {
    const { handle, rerender } = renderHandle()
    handle.focus()
    expect(handle).toHaveFocus()

    rerender(false)

    expect(screen.getByRole('button', { name: '命令台' })).toHaveFocus()
  })

  it('拖动期间容器缩小时按最新动态上限收口且保留原偏好', () => {
    let resizeCallback: ResizeObserverCallback | null = null
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const { handle, slot, onHeightChange } = renderHandle()
    const terminalWorkspace = screen.getByTestId('terminal-workspace')
    vi.spyOn(slot, 'getBoundingClientRect').mockReturnValue(rectangle(262))
    const terminalRect = vi.spyOn(terminalWorkspace, 'getBoundingClientRect').mockReturnValue(rectangle(560))

    act(() => resizeCallback?.([], {} as ResizeObserver))
    fireEvent.pointerDown(handle, { button: 0, clientY: 300, pointerId: 11 })
    terminalRect.mockReturnValue(rectangle(100))
    act(() => resizeCallback?.([], {} as ResizeObserver))
    expect(handle).toHaveAttribute('aria-valuemax', '520')

    fireEvent.pointerUp(window, { pointerId: 11 })
    expect(handle).toHaveAttribute('aria-valuemax', '122')
    expect(slot.style.getPropertyValue('--terminal-command-drawer-height')).toBe('122px')
    expect(handle).toHaveAttribute('aria-valuenow', '122')
    expect(onHeightChange).not.toHaveBeenCalled()

    terminalRect.mockReturnValue(rectangle(560))
    act(() => resizeCallback?.([], {} as ResizeObserver))
    expect(slot.style.getPropertyValue('--terminal-command-drawer-height')).toBe('262px')
  })

  it('只响应发起拖动的指针', () => {
    let frameCallback: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback
      return 41
    })
    const { handle, onHeightChange } = renderHandle()

    fireEvent.pointerDown(handle, { button: 0, clientY: 300, pointerId: 13 })
    fireEvent.pointerMove(window, { clientY: 220, pointerId: 14 })
    fireEvent.pointerUp(window, { pointerId: 14 })
    expect(frameCallback).toBeNull()
    expect(document.body).toHaveAttribute('data-termous-bottom-drawer-resizing', 'true')

    fireEvent.pointerMove(window, { clientY: 260, pointerId: 13 })
    act(() => frameCallback?.(0))
    fireEvent.pointerUp(window, { pointerId: 13 })
    expect(onHeightChange).toHaveBeenCalledWith(302)
    expect(document.body).not.toHaveAttribute('data-termous-bottom-drawer-resizing')
  })
})

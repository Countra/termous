import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  usePersistentBooleanState,
  usePersistentJsonState,
  useRafResizablePanelWidth,
} from '#shared/hooks'

function PersistentStateHarness() {
  const [flag, setFlag] = usePersistentBooleanState('test-flag', true)
  const [count, setCount] = usePersistentJsonState(
    'test-count',
    3,
    (value) => typeof value === 'number' && Number.isFinite(value) ? value : 3,
  )

  return (
    <div>
      <button type="button" onClick={() => setFlag((current) => !current)}>
        flag:{String(flag)}
      </button>
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        count:{count}
      </button>
    </div>
  )
}

function ResizablePanelHarness() {
  const panelRef = useRef<HTMLDivElement>(null)
  const resize = useRafResizablePanelWidth({
    storageKey: 'test-panel-width',
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 320,
    side: 'left',
    targetRef: panelRef,
    cssVariableName: '--test-panel-width',
  })

  return (
    <div ref={panelRef} data-testid="panel">
      <button type="button" onPointerDown={resize.beginResize}>
        resize:{resize.width}
      </button>
    </div>
  )
}

describe('共享状态 Hook 行为合同', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.body.classList.remove('is-panel-resizing')
  })

  it('从本地存储恢复合法值，并对非法 JSON 使用默认值', () => {
    window.localStorage.setItem('test-flag', 'false')
    window.localStorage.setItem('test-count', '{invalid')

    render(<PersistentStateHarness />)

    expect(screen.getByRole('button', { name: 'flag:false' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'count:3' })).toBeInTheDocument()
    expect(window.localStorage.getItem('test-count')).toBe('3')
  })

  it('状态更新后写回原有 localStorage 键', () => {
    render(<PersistentStateHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'flag:true' }))
    fireEvent.click(screen.getByRole('button', { name: 'count:3' }))

    expect(window.localStorage.getItem('test-flag')).toBe('false')
    expect(window.localStorage.getItem('test-count')).toBe('4')
  })

  it('通过动画帧更新面板宽度，并在结束时清理拖拽状态', () => {
    let frameCallback: FrameRequestCallback | null = null
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback
      return 17
    })
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    render(<ResizablePanelHarness />)
    const handle = screen.getByRole('button', { name: 'resize:240' })
    const panel = screen.getByTestId('panel')

    fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
    fireEvent.pointerMove(window, { clientX: 170 })
    expect(document.body).toHaveClass('is-panel-resizing')
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    const pendingFrame = frameCallback as FrameRequestCallback | null
    expect(pendingFrame).not.toBeNull()
    pendingFrame?.(0)
    expect(panel.style.getPropertyValue('--test-panel-width')).toBe('310px')

    fireEvent.pointerUp(window)
    expect(document.body).not.toHaveClass('is-panel-resizing')
    expect(window.localStorage.getItem('test-panel-width')).toBe('310')
    expect(cancelAnimationFrame).not.toHaveBeenCalled()
  })
})

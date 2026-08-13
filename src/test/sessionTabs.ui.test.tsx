import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTabButton, SessionTabStrip } from '#shared/ui'

vi.mock('antd', async () => {
  const React = await import('react')
  type MockButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'type'> & {
    icon?: ReactNode
    type?: string
  }

  const Button = React.forwardRef<HTMLButtonElement, MockButtonProps>(({
    children,
    icon,
    type: buttonType,
    ...props
  }, ref) => {
    void buttonType
    return (
      <button {...props} ref={ref} type="button">
        {icon}
        {children}
      </button>
    )
  })
  Button.displayName = 'MockButton'

  return {
    Button,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

let resizeLayout: ResizeObserverCallback | null = null
let scrollToDescriptor: PropertyDescriptor | undefined

class MockResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeLayout = callback
  }

  readonly disconnect = vi.fn()
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
}

function SessionTabsHarness() {
  const [tabIds, setTabIds] = useState(['first', 'second'])
  const [activeId, setActiveId] = useState('first')

  const closeFirst = () => {
    setTabIds(['second'])
    setActiveId('second')
  }

  return (
    <SessionTabStrip
      ariaLabel="会话标签"
      activeId={activeId}
      contentKey={tabIds.join('|')}
      scrollLeftLabel="向左滚动"
      scrollRightLabel="向右滚动"
    >
      {tabIds.map((tabId) => (
        <SessionTabButton
          key={tabId}
          active={tabId === activeId}
          role="tab"
          aria-selected={tabId === activeId}
          data-session-tab-id={tabId}
          icon={<span aria-hidden="true" />}
          label={tabId === 'first' ? '第一个会话' : '第二个会话'}
          closeLabel={tabId === 'first' ? '关闭第一个会话' : '关闭第二个会话'}
          onClose={tabId === 'first' ? closeFirst : () => undefined}
          onClick={() => setActiveId(tabId)}
        />
      ))}
    </SessionTabStrip>
  )
}

describe('会话标签行为标记', () => {
  beforeEach(() => {
    resizeLayout = null
    scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(performance.now())
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (scrollToDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor)
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo
    }
  })

  it('关闭按钮在样式类名变化后仍聚焦同一标签的主按钮', () => {
    const onClose = vi.fn()
    render(
      <SessionTabButton
        active
        role="tab"
        data-session-tab-id="session-a"
        icon={<span aria-hidden="true" />}
        label="会话 A"
        closeLabel="关闭会话 A"
        onClose={onClose}
      />,
    )

    const mainButton = screen.getByRole('tab', { name: '会话 A' })
    const closeButton = screen.getByRole('button', { name: '关闭会话 A' })
    const root = mainButton.closest<HTMLElement>('[data-session-tab-root]')
    expect(root).not.toBeNull()
    expect(mainButton).toHaveAttribute('data-session-tab-main')
    expect(closeButton).toHaveAttribute('data-session-tab-close')

    root?.removeAttribute('class')
    mainButton.removeAttribute('class')
    closeButton.removeAttribute('class')
    closeButton.focus()
    fireEvent.click(closeButton)

    expect(mainButton).toHaveFocus()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭当前标签后通过数据标记把焦点恢复到新的活动标签', async () => {
    render(<SessionTabsHarness />)

    const firstMain = screen.getByRole('tab', { name: '第一个会话' })
    const firstClose = screen.getByRole('button', { name: '关闭第一个会话' })
    firstMain.closest<HTMLElement>('[data-session-tab-root]')?.removeAttribute('class')
    firstMain.removeAttribute('class')
    firstClose.removeAttribute('class')
    firstClose.focus()
    fireEvent.click(firstClose)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '第二个会话' })).toHaveFocus()
    })
  })

  it('滚动按钮失效时通过方向数据标记把焦点移到边界标签', async () => {
    render(<SessionTabsHarness />)

    const tabList = screen.getByRole('tablist')
    const viewport = tabList.parentElement
    const stage = viewport?.parentElement
    const shell = stage?.parentElement
    expect(viewport).not.toBeNull()
    expect(stage).not.toBeNull()
    expect(shell).not.toBeNull()

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 120 })
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 360 })
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, value: 120, writable: true })
    Object.defineProperty(stage, 'offsetWidth', { configurable: true, value: 120 })
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 120 })

    act(() => {
      resizeLayout?.([], {} as ResizeObserver)
    })

    const leftButton = await screen.findByRole('button', { name: '向左滚动' })
    expect(leftButton).toHaveAttribute('data-session-tab-scroll-direction', 'left')
    leftButton.className = 'renamed-style-class'
    leftButton.focus()
    viewport!.scrollLeft = 0

    act(() => {
      resizeLayout?.([], {} as ResizeObserver)
    })

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '第一个会话' })).toHaveFocus()
    })
  })
})

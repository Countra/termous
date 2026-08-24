import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FeatureSidePanel } from '../shared/ui/FeatureSidePanel'
import styles from '../shared/ui/FeatureSidePanel.module.scss'
import sidePanelStyles from '../shared/ui/SidePanelControls.module.scss'

vi.mock('antd', () => ({
  Button: ({
    icon,
    className,
    onClick,
    'aria-label': ariaLabel,
  }: {
    icon?: ReactNode
    className?: string
    onClick?: () => void
    'aria-label'?: string
  }) => (
    <button type="button" className={className} aria-label={ariaLabel} onClick={onClick}>
      {icon}
    </button>
  ),
  Tabs: ({
    activeKey,
    className,
    classNames,
    destroyOnHidden,
    items,
  }: {
    activeKey: string
    className?: string
    classNames?: { popup?: { root?: string } }
    destroyOnHidden?: boolean
    items: Array<{ key: string; children: ReactNode }>
  }) => (
    <section
      className={className}
      data-testid="feature-side-panel-tabs"
      data-popup-root={classNames?.popup?.root}
      data-destroy-on-hidden={String(destroyOnHidden)}
    >
      {items.map((item) => (
        <div key={item.key} hidden={item.key !== activeKey}>
          {item.children}
        </div>
      ))}
    </section>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

const tabs = [
  {
    key: 'overview',
    label: '概览',
    icon: <span>概览图标</span>,
    children: <div>概览内容</div>,
  },
  {
    key: 'files',
    label: '文件',
    icon: <span>文件图标</span>,
    children: <div>文件内容</div>,
  },
]

const baseProps = {
  activeKey: 'overview',
  ariaLabel: '详情侧栏',
  collapsed: false,
  collapseLabel: '收起',
  expandLabel: '展开',
  tabs,
  onActiveKeyChange: vi.fn(),
  onCollapsedChange: vi.fn(),
}

describe('FeatureSidePanel 样式与常驻合同', () => {
  it('侧栏容器、拖拽边缘与折叠按钮消费共享 Module', () => {
    const onResizePointerDown = vi.fn()
    const view = render(
      <FeatureSidePanel
        {...baseProps}
        resizing
        onResizePointerDown={onResizePointerDown}
      />,
    )

    const panel = view.container.querySelector('aside')
    const resizeEdge = panel?.querySelector('[aria-hidden="true"]')
    const toggle = screen.getByRole('button', { name: '收起' })
    const toggleZone = toggle.parentElement

    expect(panel).toHaveClass(
      styles['details-panel'],
      sidePanelStyles.panel,
      sidePanelStyles['is-resizing'],
    )
    expect(resizeEdge).toHaveClass(
      sidePanelStyles['resize-edge'],
      sidePanelStyles['resize-edge-left'],
    )
    expect(toggle).toHaveClass(
      sidePanelStyles['panel-side-toggle'],
      sidePanelStyles['panel-side-toggle-right'],
    )
    expect(toggleZone).toHaveClass(
      sidePanelStyles['panel-toggle-zone'],
      sidePanelStyles['panel-toggle-zone-right'],
    )
    expect(panel).not.toHaveClass('details-panel', 'is-resizing')
    expect(resizeEdge).not.toHaveClass('details-resize-edge')
    expect(toggle).not.toHaveClass('panel-side-toggle', 'panel-side-toggle-right')
  })

  it.each([
    {
      name: '默认类',
      popupClassName: undefined,
      expectedLegacyClasses: ['details-tabs-dropdown'],
      usesModuleStyle: true,
    },
    {
      name: '自定义替换类',
      popupClassName: 'custom-popup',
      expectedLegacyClasses: ['custom-popup'],
      usesModuleStyle: false,
    },
    {
      name: '默认类与自定义类组合',
      popupClassName: 'details-tabs-dropdown custom-popup',
      expectedLegacyClasses: ['details-tabs-dropdown', 'custom-popup'],
      usesModuleStyle: true,
    },
  ])('$name 保持 popupClassName 语义', ({
    popupClassName,
    expectedLegacyClasses,
    usesModuleStyle,
  }) => {
    render(<FeatureSidePanel {...baseProps} popupClassName={popupClassName} />)
    const popupClasses = screen
      .getByTestId('feature-side-panel-tabs')
      .getAttribute('data-popup-root')
      ?.split(/\s+/u) ?? []

    expect(popupClasses).toEqual(expect.arrayContaining(expectedLegacyClasses))
    expect(popupClasses.includes(styles['details-tabs-dropdown'])).toBe(usesModuleStyle)
  })

  it('折叠时保持活动内容挂载并使用局部隐藏类', () => {
    const view = render(<FeatureSidePanel {...baseProps} />)

    expect(screen.getByText('概览内容')).toBeInTheDocument()
    expect(screen.getByTestId('feature-side-panel-tabs')).toHaveAttribute(
      'data-destroy-on-hidden',
      'false',
    )

    view.rerender(<FeatureSidePanel {...baseProps} collapsed />)

    const contentShell = view.container.querySelector('.details-content-shell')
    expect(contentShell).toHaveAttribute('aria-hidden', 'true')
    expect(contentShell).toHaveClass(styles['details-content-shell'], styles['is-hidden'], 'is-hidden')
    expect(screen.getByText('概览内容')).toBeInTheDocument()
  })

  it('折叠轨道先切换活动项再展开侧栏', () => {
    const onActiveKeyChange = vi.fn()
    const onCollapsedChange = vi.fn()
    render(
      <FeatureSidePanel
        {...baseProps}
        collapsed
        onActiveKeyChange={onActiveKeyChange}
        onCollapsedChange={onCollapsedChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '文件' }))

    expect(onActiveKeyChange).toHaveBeenCalledWith('files')
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
    expect(onActiveKeyChange.mock.invocationCallOrder[0]).toBeLessThan(
      onCollapsedChange.mock.invocationCallOrder[0],
    )
  })

  it.each([
    { collapsed: false, label: '收起', next: true },
    { collapsed: true, label: '展开', next: false },
  ])('折叠按钮通过鼠标和键盘保持可操作：$label', async ({ collapsed, label, next }) => {
    const user = userEvent.setup()
    const onCollapsedChange = vi.fn()
    render(
      <FeatureSidePanel
        {...baseProps}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />,
    )

    const toggle = screen.getByRole('button', { name: label })
    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onCollapsedChange).toHaveBeenCalledWith(next)
  })
})

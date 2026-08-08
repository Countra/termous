import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FeatureSidePanel } from '../shared/ui/FeatureSidePanel'
import styles from '../shared/ui/FeatureSidePanel.module.scss'

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
})

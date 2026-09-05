import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextActionMenu } from './ContextActionMenu.tsx'
import { contextActionMenuPopupClassName } from './contextActionMenuStyles.ts'

afterEach(cleanup)

describe('ContextActionMenu', () => {
  it('独立子菜单 Portal 继承共享与调用方样式，并保留叶节点点击合同', async () => {
    const onClick = vi.fn()
    render(<ContextActionMenu popupClassName="caller-menu" onClick={onClick} items={[
      { key: 'rename', label: 'Rename' },
      { key: 'move', label: 'Move', children: [{ key: 'current', label: 'Current group', disabled: true }, { key: 'target', label: 'Target group' }] },
    ]}><button>Conversation</button></ContextActionMenu>)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Conversation' }))
    const mainPopup = (await screen.findByRole('menuitem', { name: 'Rename' })).closest('.ant-dropdown')!
    await userEvent.hover(screen.getByRole('menuitem', { name: /^Move/ }))
    const target = await screen.findByRole('menuitem', { name: 'Target group' })
    const submenuPopup = target.closest('.ant-dropdown-menu-submenu-popup')!
    expect(submenuPopup).toHaveClass(contextActionMenuPopupClassName, 'caller-menu')
    expect(mainPopup.contains(submenuPopup)).toBe(false)
    expect(screen.getByRole('menuitem', { name: 'Current group' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(target)
    expect(onClick).toHaveBeenCalledOnce()
    expect(onClick.mock.calls[0]?.[0]).toMatchObject({ key: 'target' })
  })

  it('禁用或空菜单不打开右键浮层', () => {
    const view = render(<ContextActionMenu disabled items={[{ key: 'one', label: 'Action' }]}><button>Conversation</button></ContextActionMenu>)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Conversation' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    view.rerender(<ContextActionMenu items={[]}><button>Conversation</button></ContextActionMenu>)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Conversation' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

import type { ReactElement } from 'react'
import { Dropdown, type MenuProps } from 'antd'
import { contextActionMenuPopupClassName } from './contextActionMenuStyles'

interface ContextActionMenuProps {
  children: ReactElement
  items: MenuProps['items']
  onClick?: MenuProps['onClick']
  disabled?: boolean
  popupClassName?: string
}

export function ContextActionMenu({
  children,
  items,
  onClick,
  disabled = false,
  popupClassName,
}: ContextActionMenuProps) {
  const hasItems = Array.isArray(items) && items.length > 0
  // Menu 的 rootClassName 会传到独立子菜单 Portal，Dropdown 的浮层类只覆盖主菜单。
  const menuClassName = [contextActionMenuPopupClassName, popupClassName].filter(Boolean).join(' ')

  return (
    <Dropdown
      trigger={!disabled && hasItems ? ['contextMenu'] : []}
      classNames={{ root: menuClassName }}
      menu={{ items, onClick, rootClassName: menuClassName }}
      disabled={disabled || !hasItems}
    >
      {children}
    </Dropdown>
  )
}

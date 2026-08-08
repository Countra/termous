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

  return (
    <Dropdown
      trigger={!disabled && hasItems ? ['contextMenu'] : []}
      classNames={{ root: [contextActionMenuPopupClassName, popupClassName].filter(Boolean).join(' ') }}
      menu={{ items, onClick }}
      disabled={disabled || !hasItems}
    >
      {children}
    </Dropdown>
  )
}

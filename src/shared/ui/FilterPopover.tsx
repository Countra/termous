import { Popover, type PopoverProps } from 'antd'
import type { ReactElement, ReactNode } from 'react'
import styles from './FilterPopover.module.scss'

export interface FilterPopoverProps extends Omit<
  PopoverProps,
  'arrow' | 'children' | 'classNames' | 'content' | 'overlayClassName' | 'rootClassName' | 'trigger'
> {
  children: ReactElement
  content: ReactNode
  popupClassName?: string
}

export function FilterPopover({
  children,
  content,
  placement = 'bottomRight',
  popupClassName,
  ...popoverProps
}: FilterPopoverProps) {
  const rootClassName = [styles.root, popupClassName].filter(Boolean).join(' ')

  return (
    <Popover
      {...popoverProps}
      arrow={false}
      trigger="click"
      placement={placement}
      content={content}
      classNames={{
        root: rootClassName,
        container: styles.surface,
      }}
    >
      {children}
    </Popover>
  )
}

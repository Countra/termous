import { Button, Tooltip, type ButtonProps } from 'antd'
import { Plus } from 'lucide-react'
import { forwardRef } from 'react'
import styles from './SessionTabs.module.scss'

interface SessionNewTabButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'title' | 'type'> {
  label: string
  active?: boolean
  busy?: boolean
}

export const SessionNewTabButton = forwardRef<HTMLButtonElement, SessionNewTabButtonProps>(
  ({
    label,
    active = false,
    busy = false,
    className,
    disabled,
    ...props
  }, ref) => (
    <Tooltip
      title={active ? null : label}
      placement="bottom"
      arrow={false}
      mouseEnterDelay={0.35}
      mouseLeaveDelay={0}
      classNames={{ root: `termous-tooltip ${styles['session-tab-tooltip']}` }}
      destroyOnHidden
    >
      <Button
        {...props}
        ref={ref}
        type="text"
        className={[styles['session-new-tab-button'], active ? styles['is-open'] : '', className].filter(Boolean).join(' ')}
        aria-label={label}
        aria-busy={busy}
        disabled={disabled}
        icon={<Plus size={16} strokeWidth={2.2} />}
      />
    </Tooltip>
  ),
)

SessionNewTabButton.displayName = 'SessionNewTabButton'

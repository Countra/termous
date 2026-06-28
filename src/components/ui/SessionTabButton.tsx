import { Button, type ButtonProps } from 'antd'
import { forwardRef, type ReactNode } from 'react'

interface SessionTabButtonProps extends Omit<ButtonProps, 'children' | 'type'> {
  active?: boolean
  empty?: boolean
  icon: ReactNode
  label: ReactNode
  status?: string
}

export const SessionTabButton = forwardRef<HTMLButtonElement, SessionTabButtonProps>(
  ({ active = false, empty = false, className, icon, label, status, ...props }, ref) => {
    const classes = ['session-tab-button', active ? 'is-active' : '', empty ? 'is-empty' : '', className]
      .filter(Boolean)
      .join(' ')
    return (
      <Button {...props} ref={ref} type="text" className={classes} icon={icon}>
        <span className="session-tab-content">
          {status ? <span className={`session-dot is-${status}`} /> : null}
          <span className="session-tab-label">{label}</span>
        </span>
      </Button>
    )
  },
)

SessionTabButton.displayName = 'SessionTabButton'

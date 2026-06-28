import { Button, type ButtonProps } from 'antd'
import { X } from 'lucide-react'
import { forwardRef, type MouseEvent, type ReactNode } from 'react'

interface SessionTabButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'type'> {
  active?: boolean
  empty?: boolean
  icon: ReactNode
  label: ReactNode
  status?: string
  closeLabel?: string
  closeDisabled?: boolean
  onClose?: () => void
}

export const SessionTabButton = forwardRef<HTMLButtonElement, SessionTabButtonProps>(
  ({ active = false, empty = false, className, icon, label, status, closeLabel, closeDisabled, onClose, disabled, ...props }, ref) => {
    const classes = ['session-tab-button', active ? 'is-active' : '', empty ? 'is-empty' : '', className]
      .filter(Boolean)
      .join(' ')
    const closable = Boolean(onClose && !empty)

    const handleCloseMouseDown = (event: MouseEvent<HTMLSpanElement>) => {
      event.preventDefault()
      event.stopPropagation()
    }

    const handleClose = (event: MouseEvent<HTMLSpanElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!disabled && !closeDisabled) {
        onClose?.()
      }
    }

    return (
      <Button {...props} ref={ref} type="text" className={classes} disabled={disabled} icon={icon}>
        <span className="session-tab-content">
          {status ? <span className={`session-dot is-${status}`} /> : null}
          <span className="session-tab-label">{label}</span>
        </span>
        {closable ? (
          <span
            className={`session-tab-close ${disabled || closeDisabled ? 'is-disabled' : ''}`}
            role="button"
            aria-label={closeLabel}
            aria-disabled={disabled || closeDisabled}
            title={closeLabel}
            onMouseDown={handleCloseMouseDown}
            onClick={handleClose}
          >
            <X size={13} strokeWidth={2.2} />
          </span>
        ) : null}
      </Button>
    )
  },
)

SessionTabButton.displayName = 'SessionTabButton'

import { Button, Tooltip, type ButtonProps } from 'antd'
import { Pin, X } from 'lucide-react'
import { forwardRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react'

interface SessionTabButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'title' | 'type'> {
  active?: boolean
  empty?: boolean
  icon: ReactNode
  label: ReactNode
  status?: string
  statusLabel?: string
  accentColor?: string
  pinned?: boolean
  pinLabel?: string
  closeLabel?: string
  closeDisabled?: boolean
  tooltipTitle?: ReactNode
  onClose?: () => void
}

const sessionTabTooltipClassNames = { root: 'termous-tooltip session-tab-tooltip' }

export const SessionTabButton = forwardRef<HTMLButtonElement, SessionTabButtonProps>(
  ({
    active = false,
    empty = false,
    className,
    icon,
    label,
    status,
    statusLabel,
    accentColor,
    pinned,
    pinLabel,
    closeLabel,
    closeDisabled,
    tooltipTitle,
    onClose,
    disabled,
    style,
    tabIndex,
    ...props
  }, ref) => {
    const classes = [
      'session-tab-button',
      active ? 'is-active' : '',
      empty ? 'is-empty' : '',
      accentColor ? 'has-accent' : '',
      pinned ? 'is-pinned' : '',
      disabled ? 'is-disabled' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')
    const closable = Boolean(onClose && !empty)
    const resolvedTitle = tooltipTitle ?? (typeof label === 'string' ? label : undefined)
    const tabStyle = accentColor
      ? ({ ...style, '--session-tab-accent': accentColor } as CSSProperties)
      : style

    const handleCloseMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
    }

    const handleClose = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!disabled && !closeDisabled) {
        onClose?.()
      }
    }

    const leading = (
      <span className="session-tab-leading" aria-hidden="true">
        {icon}
        {status ? <span className={`session-dot is-${status}`} aria-hidden="true" /> : null}
      </span>
    )

    if (empty) {
      return (
        <span className={classes} style={tabStyle} role="status">
          <span className="session-tab-empty-content">
            {leading}
            <span className="session-tab-label">{label}</span>
          </span>
        </span>
      )
    }

    return (
      <span className={classes} style={tabStyle}>
        <Tooltip
          title={resolvedTitle}
          placement="bottom"
          arrow={false}
          mouseEnterDelay={0.35}
          mouseLeaveDelay={0}
          classNames={sessionTabTooltipClassNames}
          destroyOnHidden
        >
          <Button
            {...props}
            ref={ref}
            type="text"
            className="session-tab-main"
            disabled={disabled}
            tabIndex={tabIndex ?? (active ? 0 : -1)}
          >
            <span className="session-tab-content">
              {leading}
              <span className="session-tab-label">{label}</span>
              {statusLabel ? <span className="session-tab-status-label">，{statusLabel}</span> : null}
              {pinned ? (
                <span className="session-tab-pin" aria-label={pinLabel}>
                  <Pin size={11} strokeWidth={2.2} aria-hidden="true" />
                </span>
              ) : null}
            </span>
          </Button>
        </Tooltip>
        {closable ? (
          <Tooltip
            title={disabled || closeDisabled ? null : closeLabel}
            placement="bottom"
            arrow={false}
            mouseEnterDelay={0.35}
            mouseLeaveDelay={0}
            classNames={sessionTabTooltipClassNames}
            destroyOnHidden
          >
            <button
              type="button"
              className="session-tab-close"
              aria-label={closeLabel}
              disabled={disabled || closeDisabled}
              tabIndex={active ? 0 : -1}
              onMouseDown={handleCloseMouseDown}
              onClick={handleClose}
            >
              <X size={13} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </span>
    )
  },
)

SessionTabButton.displayName = 'SessionTabButton'

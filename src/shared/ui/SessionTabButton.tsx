import { Button, Tooltip, type ButtonProps } from 'antd'
import { LoaderCircle, Pin, X } from 'lucide-react'
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
  closing?: boolean
  closingLabel?: string
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
    closing = false,
    closingLabel,
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
      closing ? 'is-closing' : '',
      disabled ? 'is-disabled' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')
    const closable = Boolean(onClose && !empty)
    const baseTitle = tooltipTitle ?? (typeof label === 'string' ? label : undefined)
    const resolvedTitle = closing && closingLabel
      ? <>{baseTitle}{baseTitle ? ' · ' : ''}{closingLabel}</>
      : baseTitle
    const resolvedStatus = closing ? 'closing' : status
    const resolvedStatusLabel = closing ? closingLabel : statusLabel
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
      if (!disabled && !closeDisabled && !closing) {
        event.currentTarget
          .closest('[data-session-tab-root]')
          ?.querySelector<HTMLButtonElement>('[data-session-tab-main]')
          ?.focus({ preventScroll: true })
        onClose?.()
      }
    }

    const leading = (
      <span className="session-tab-leading" aria-hidden="true">
        {icon}
        {resolvedStatus ? (
          <span
            className={`session-dot is-${resolvedStatus.replace(/_/g, '-')}`}
            aria-hidden="true"
          />
        ) : null}
      </span>
    )

    if (empty) {
      return (
        <span className={classes} style={tabStyle} role="status" data-session-tab-root="">
          <span className="session-tab-empty-content">
            {leading}
            <span className="session-tab-label">{label}</span>
          </span>
        </span>
      )
    }

    return (
      <span className={classes} style={tabStyle} data-session-tab-root="">
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
            data-session-tab-main=""
            disabled={disabled}
            aria-busy={closing || undefined}
            aria-disabled={disabled || closing || undefined}
            tabIndex={tabIndex ?? (active ? 0 : -1)}
          >
            <span className="session-tab-content">
              {leading}
              <span className="session-tab-label">{label}</span>
              {resolvedStatusLabel ? <span className="session-tab-status-label">，{resolvedStatusLabel}</span> : null}
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
            title={disabled || closeDisabled || closing ? null : closeLabel}
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
              data-session-tab-close=""
              aria-label={closing ? closingLabel : closeLabel}
              aria-disabled={disabled || closeDisabled || closing}
              disabled={disabled || closeDisabled || closing}
              tabIndex={active && !closing ? 0 : -1}
              onMouseDown={handleCloseMouseDown}
              onClick={handleClose}
            >
              {closing ? (
                <LoaderCircle className="session-tab-closing-spinner" size={13} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <X size={13} strokeWidth={2.2} aria-hidden="true" />
              )}
            </button>
          </Tooltip>
        ) : null}
      </span>
    )
  },
)

SessionTabButton.displayName = 'SessionTabButton'

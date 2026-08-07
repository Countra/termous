import { Network, RadioTower, Route, type LucideIcon } from 'lucide-react'
import { Segmented } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ForwardMode } from '#entities/forward'

interface ForwardModeSelectorProps {
  value?: ForwardMode
  disabled?: boolean
  compact?: boolean
  onChange?: (value: ForwardMode) => void
}

export function ForwardModeSelector({ value, disabled, compact = false, onChange }: ForwardModeSelectorProps) {
  const { t } = useTranslation()

  return (
    <Segmented
      block
      className={`forward-mode-selector${compact ? ' is-compact' : ''}`}
      value={value}
      disabled={disabled}
      onChange={(nextValue) => onChange?.(nextValue as ForwardMode)}
      options={forwardModes.map((mode) => {
        const Icon = forwardModeIcon(mode)
        return {
          value: mode,
          icon: <Icon size={compact ? 13 : 14} aria-hidden="true" />,
          label: t(`forwards.modeName.${mode}`),
          tooltip: modeTooltip(mode, t),
        }
      })}
    />
  )
}

export function ForwardModeBadge({ mode, compact = false }: { mode: ForwardMode; compact?: boolean }) {
  const { t } = useTranslation()
  const Icon = forwardModeIcon(mode)

  return (
    <span className={`forward-mode-badge is-${mode}${compact ? ' is-compact' : ''}`}>
      <Icon size={compact ? 12 : 14} aria-hidden="true" />
      {t(`forwards.modeName.${mode}`)}
    </span>
  )
}

function forwardModeIcon(mode: ForwardMode): LucideIcon {
  if (mode === 'remote') {
    return RadioTower
  }
  if (mode === 'dynamic') {
    return Network
  }
  return Route
}

const forwardModes: ForwardMode[] = ['local', 'remote', 'dynamic']

function modeTooltip(mode: ForwardMode, t: (key: string) => string) {
  if (mode === 'remote') {
    return `${t('forwards.route.remoteListen')} → ${t('forwards.route.localTarget')}`
  }
  if (mode === 'dynamic') {
    return t('forwards.dynamicHint')
  }
  return `${t('forwards.route.localListen')} → ${t('forwards.route.remoteTarget')}`
}

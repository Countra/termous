import { KeyRound, ShieldCheck } from 'lucide-react'
import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AuthMethod } from '../model/types.ts'

interface AuthMethodBadgeProps {
  method: AuthMethod
  compact?: boolean
}

export function AuthMethodBadge({ method, compact = false }: AuthMethodBadgeProps) {
  const { t } = useTranslation()
  const label = t(`hosts.auth.${method}`)
  const Icon = method === 'private_key' ? ShieldCheck : KeyRound

  const badge = (
    <span className={`host-auth-badge ${compact ? 'is-compact' : ''}`} aria-label={`${t('hosts.authMethod')}：${label}`}>
      <span className="host-auth-badge-icon">
        <Icon size={12} aria-hidden="true" />
      </span>
      {!compact ? <span className="host-auth-badge-label">{label}</span> : null}
    </span>
  )

  if (!compact) {
    return badge
  }

  return <Tooltip title={label}>{badge}</Tooltip>
}

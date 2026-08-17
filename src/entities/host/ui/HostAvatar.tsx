import { Server } from 'lucide-react'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Host } from '../model/types.ts'
import styles from './HostAvatar.module.scss'

interface HostAvatarProps {
  host?: Pick<Host, 'icon_id' | 'name'>
  getIconUrl?: (iconId: string) => string
  className?: string
  size?: number
  iconSize?: number
  decorative?: boolean
  alt?: string
  loading?: 'eager' | 'lazy'
  fallbackIcon?: ReactNode
  compact?: boolean
}

export function HostAvatar({
  host,
  getIconUrl,
  className = '',
  size,
  iconSize,
  decorative = true,
  alt,
  loading,
  fallbackIcon,
  compact = false,
}: HostAvatarProps) {
  const iconId = host?.icon_id?.trim() ?? ''
  const [failedSrc, setFailedSrc] = useState('')
  const iconSrc = useMemo(
    () => iconId && getIconUrl ? getIconUrl(iconId) : '',
    [getIconUrl, iconId],
  )
  const src = iconSrc === failedSrc ? '' : iconSrc
  const style = size ? ({ '--host-avatar-size': `${size}px` } as CSSProperties) : undefined
  const label = alt ?? host?.name ?? ''

  return (
    <span
      className={`${styles['host-avatar']} host-avatar ${
        src ? `${styles['has-custom-icon']} has-custom-icon` : 'is-default-icon'
      } ${compact ? styles['is-compact'] : ''} ${className}`.trim()}
      style={style}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {src ? (
        <img
          src={src}
          alt={decorative ? '' : label}
          draggable={false}
          loading={loading}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        fallbackIcon ?? (
          <Server size={iconSize ?? Math.max(14, Math.round((size ?? 30) * 0.52))} aria-hidden="true" />
        )
      )}
    </span>
  )
}

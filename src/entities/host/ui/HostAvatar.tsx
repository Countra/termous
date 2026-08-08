import { Server } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
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
}

export function HostAvatar({
  host,
  getIconUrl,
  className = '',
  size,
  iconSize,
  decorative = true,
  alt,
}: HostAvatarProps) {
  const iconId = host?.icon_id?.trim() ?? ''
  const [failedIconId, setFailedIconId] = useState('')
  const src = useMemo(() => {
    if (!iconId || iconId === failedIconId || !getIconUrl) {
      return ''
    }
    return getIconUrl(iconId)
  }, [failedIconId, getIconUrl, iconId])
  const style = size ? ({ '--host-avatar-size': `${size}px` } as CSSProperties) : undefined
  const label = alt ?? host?.name ?? ''

  return (
    <span
      className={`${styles['host-avatar']} host-avatar ${src ? 'has-custom-icon' : 'is-default-icon'} ${className}`.trim()}
      style={style}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {src ? (
        <img
          src={src}
          alt={decorative ? '' : label}
          draggable={false}
          onError={() => setFailedIconId(iconId)}
        />
      ) : (
        <Server size={iconSize ?? Math.max(14, Math.round((size ?? 30) * 0.52))} aria-hidden="true" />
      )}
    </span>
  )
}

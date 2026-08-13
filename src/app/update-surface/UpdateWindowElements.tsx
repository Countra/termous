import {
  Download,
  RefreshCw,
  X,
} from 'lucide-react'
import type { UpdateWindowPrimaryAction } from '#entities/update'
import styles from './UpdateWindowRoot.module.scss'

export function UpdateWindowVersionBlock({
  isTarget = false,
  label,
  version,
}: {
  isTarget?: boolean
  label: string
  version: string
}) {
  return (
    <span
      className={[
        styles['update-window-version-block'],
        isTarget ? styles['is-target'] : '',
      ].filter(Boolean).join(' ')}
    >
      <small>{label}</small>
      <strong>{version ? `v${version}` : '-'}</strong>
    </span>
  )
}

export function UpdateWindowPrimaryActionIcon({
  action,
}: {
  action: UpdateWindowPrimaryAction
}) {
  if (action === 'cancel') {
    return <X size={15} />
  }
  if (action === 'install' || action === 'download') {
    return <Download size={15} />
  }
  return <RefreshCw size={15} />
}

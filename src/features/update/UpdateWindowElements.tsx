import {
  Download,
  RefreshCw,
  X,
} from 'lucide-react'
import type { UpdateWindowPrimaryAction } from './updateWindowUiState'

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
    <span className={`update-window-version-block${isTarget ? ' is-target' : ''}`}>
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

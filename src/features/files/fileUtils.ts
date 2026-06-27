import type { RemoteFileEntry, TransferStatus, TransferTask } from '../../types/domain'

export function parentPath(path: string) {
  const cleaned = normalizeRemotePath(path)
  if (cleaned === '/') {
    return '/'
  }
  const parts = cleaned.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

export function joinPath(base: string, name: string) {
  const left = normalizeRemotePath(base)
  const right = name.replace(/\\/g, '/').replace(/^\/+/, '')
  return normalizeRemotePath(`${left === '/' ? '' : left}/${right}`)
}

export function normalizeRemotePath(value: string) {
  const segments: string[] = []
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    const clean = segment.trim()
    if (!clean || clean === '.') {
      continue
    }
    if (clean === '..') {
      segments.pop()
      continue
    }
    segments.push(clean)
  }
  return segments.length ? `/${segments.join('/')}` : '/'
}

export function pathBase(path: string) {
  const cleaned = normalizeRemotePath(path)
  if (cleaned === '/') {
    return '/'
  }
  return cleaned.split('/').filter(Boolean).at(-1) ?? cleaned
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}

export function formatDate(value?: string) {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  return date.toLocaleString()
}

export function formatSeconds(value?: number) {
  if (!value || value <= 0) {
    return '-'
  }
  if (value < 60) {
    return `${Math.ceil(value)}s`
  }
  const minutes = Math.floor(value / 60)
  const seconds = Math.ceil(value % 60)
  return `${minutes}m ${seconds}s`
}

export function fileSortValue(file: RemoteFileEntry) {
  return `${file.kind === 'directory' ? '0' : '1'}-${file.name.toLowerCase()}`
}

export function transferStatusClass(status: TransferStatus) {
  return `is-${status.replace(/_/g, '-')}`
}

export function transferProgress(task: TransferTask) {
  if (task.status === 'completed') {
    return 100
  }
  return Math.max(0, Math.min(100, Math.round(task.progress_percent || 0)))
}

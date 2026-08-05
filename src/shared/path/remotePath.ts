import { requireRemotePosixPath } from './remotePosixPath.ts'

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
  const right = name.replace(/^\/+/, '')
  return normalizeRemotePath(`${left === '/' ? '' : left}/${right}`)
}

export function normalizeRemotePath(value: string) {
  return requireRemotePosixPath(value)
}

export function pathBase(path: string) {
  const cleaned = normalizeRemotePath(path)
  if (cleaned === '/') {
    return '/'
  }
  const segments = cleaned.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? cleaned
}

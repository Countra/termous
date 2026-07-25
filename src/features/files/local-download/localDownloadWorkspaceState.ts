import type { LocalPathMapping, LocalTreeEntry } from '../../../types/domain'
import type { LocalDownloadTarget } from './types'

export type LocalDirectoryStatus =
  | 'idle'
  | 'loading'
  | 'navigating'
  | 'refreshing'
  | 'failed'

export type LocalDirectoryRequestKind = 'load' | 'navigate' | 'refresh'

export interface LocalDirectoryRetry {
  path: string
  kind: LocalDirectoryRequestKind
}

export interface LocalDirectoryViewState {
  mappingId: string
  rootPath: string
  committedPath: string
  pendingPath: string | null
  entries: LocalTreeEntry[]
  status: LocalDirectoryStatus
  hasLoaded: boolean
  requestSequence: number
  error: string
  retry: LocalDirectoryRetry | null
}

export interface LocalDirectoryRequest {
  state: LocalDirectoryViewState
  requestSequence: number
  path: string
  kind: LocalDirectoryRequestKind
}

export interface LocalPathBreadcrumb {
  label: string
  path: string
}

export interface LocalDownloadRefreshTarget {
  mappingId?: string
  targetPath: string
}

export function createLocalDirectoryViewState(mapping: LocalPathMapping): LocalDirectoryViewState {
  return {
    mappingId: mapping.id,
    rootPath: mapping.path,
    committedPath: mapping.path,
    pendingPath: null,
    entries: [],
    status: 'idle',
    hasLoaded: false,
    requestSequence: 0,
    error: '',
    retry: null,
  }
}

export function syncLocalDirectoryViewRoot(
  state: LocalDirectoryViewState,
  mapping: LocalPathMapping,
): LocalDirectoryViewState {
  if (
    state.mappingId === mapping.id
    && localPathEquals(state.rootPath, mapping.path)
    && isLocalPathWithin(state.committedPath, mapping.path)
  ) {
    return state
  }
  return createLocalDirectoryViewState(mapping)
}

export function beginLocalDirectoryRequest(
  state: LocalDirectoryViewState,
  path: string,
  kind: LocalDirectoryRequestKind,
): LocalDirectoryRequest {
  const targetPath = isLocalPathWithin(path, state.rootPath) ? path : state.rootPath
  const requestSequence = state.requestSequence + 1
  const status: LocalDirectoryStatus = kind === 'refresh'
    ? 'refreshing'
    : state.hasLoaded
      ? 'navigating'
      : 'loading'
  return {
    requestSequence,
    path: targetPath,
    kind,
    state: {
      ...state,
      pendingPath: targetPath,
      status,
      requestSequence,
      error: '',
      retry: null,
    },
  }
}

export function completeLocalDirectoryRequest(
  state: LocalDirectoryViewState,
  requestSequence: number,
  path: string,
  entries: LocalTreeEntry[],
): LocalDirectoryViewState {
  if (state.requestSequence !== requestSequence || state.pendingPath !== path) {
    return state
  }
  return {
    ...state,
    committedPath: path,
    pendingPath: null,
    entries: localDownloadDirectories(entries),
    status: 'idle',
    hasLoaded: true,
    error: '',
    retry: null,
  }
}

export function failLocalDirectoryRequest(
  state: LocalDirectoryViewState,
  requestSequence: number,
  path: string,
  kind: LocalDirectoryRequestKind,
  error: string,
): LocalDirectoryViewState {
  if (state.requestSequence !== requestSequence || state.pendingPath !== path) {
    return state
  }
  return {
    ...state,
    pendingPath: null,
    status: 'failed',
    error,
    retry: { path, kind },
  }
}

export function cancelLocalDirectoryRequest(
  state: LocalDirectoryViewState,
): LocalDirectoryViewState {
  if (!state.pendingPath && !isLocalDirectoryBusy(state.status)) {
    return state
  }
  return {
    ...state,
    pendingPath: null,
    status: 'idle',
    requestSequence: state.requestSequence + 1,
    error: '',
    retry: null,
  }
}

export function isLocalDirectoryBusy(status: LocalDirectoryStatus) {
  return status === 'loading' || status === 'navigating' || status === 'refreshing'
}

export function localDownloadDirectories(entries: readonly LocalTreeEntry[]) {
  return entries
    .filter(isAccessibleLocalDirectory)
    .sort((left, right) => left.name.localeCompare(
      right.name,
      undefined,
      { numeric: true, sensitivity: 'base' },
    ))
}

export function isAccessibleLocalDirectory(entry: LocalTreeEntry) {
  return entry.kind === 'directory' && entry.is_accessible !== false
}

export function isSafeLocalDownloadTarget(
  mapping: Pick<LocalPathMapping, 'available' | 'path'>,
  requestedPath: string,
  stat: LocalTreeEntry,
) {
  return mapping.available
    && isLocalPathWithin(requestedPath, mapping.path)
    && isAccessibleLocalDirectory(stat)
    && isLocalPathWithin(stat.path, mapping.path)
}

export function findLocalPathMapping(
  mappings: readonly LocalPathMapping[],
  targetPath: string,
) {
  return [...mappings]
    .filter((mapping) => isLocalPathWithin(targetPath, mapping.path))
    .sort((left, right) => normalizeLocalPath(right.path).length - normalizeLocalPath(left.path).length)[0] ?? null
}

export function resolveLocalDownloadRefreshMapping(
  mappings: readonly LocalPathMapping[],
  request: LocalDownloadRefreshTarget,
) {
  if (!request.mappingId) {
    return findLocalPathMapping(mappings, request.targetPath)
  }
  return mappings.find((mapping) => (
    mapping.id === request.mappingId
    && isLocalPathWithin(request.targetPath, mapping.path)
  )) ?? null
}

export function resolveLocalDownloadSelectedMapping(
  mappings: readonly LocalPathMapping[],
  selectedMappingId: string,
  preferredMappingId?: string,
) {
  const preferred = preferredMappingId
    ? mappings.find((mapping) => mapping.id === preferredMappingId)
    : null
  const selected = selectedMappingId
    ? mappings.find((mapping) => mapping.id === selectedMappingId)
    : null
  return preferred
    ?? selected
    ?? mappings.find((mapping) => mapping.available)
    ?? mappings[0]
    ?? null
}

export function resolveLocalDownloadQuickTarget(
  mappings: readonly LocalPathMapping[],
  currentTarget: LocalDownloadTarget | null,
): LocalDownloadTarget | null {
  const currentMapping = currentTarget
    ? mappings.find((mapping) => mapping.id === currentTarget.mappingId)
    : null
  const mapping = currentMapping ?? mappings[0] ?? null
  if (!mapping) {
    return null
  }
  const canKeepCurrentPath = Boolean(
    currentMapping
    && currentTarget
    && currentTarget.mappingPath === mapping.path
    && isLocalPathWithin(currentTarget.path, mapping.path),
  )
  return {
    mappingId: mapping.id,
    mappingName: mapping.name,
    mappingPath: mapping.path,
    path: canKeepCurrentPath && currentTarget ? currentTarget.path : mapping.path,
    available: mapping.available,
  }
}

export function localPathBreadcrumbs(
  mapping: LocalPathMapping,
  currentPath: string,
): LocalPathBreadcrumb[] {
  const relativeParts = localPathRelativeParts(currentPath, mapping.path)
  const breadcrumbs: LocalPathBreadcrumb[] = [{
    label: mapping.name,
    path: mapping.path,
  }]
  relativeParts.forEach((part, index) => {
    breadcrumbs.push({
      label: part,
      path: joinLocalPath(mapping.path, relativeParts.slice(0, index + 1)),
    })
  })
  return breadcrumbs
}

export function localPathParent(path: string, rootPath: string) {
  const parts = localPathRelativeParts(path, rootPath)
  if (parts.length <= 1) {
    return rootPath
  }
  return joinLocalPath(rootPath, parts.slice(0, -1))
}

export function localPathRelativeLabel(path: string, rootPath: string) {
  const parts = localPathRelativeParts(path, rootPath)
  return parts.length > 0 ? parts.join('/') : ''
}

export function localPathDisplayName(path: string) {
  const normalized = normalizeLocalPath(path)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

export function localPathEquals(left: string, right: string) {
  const normalizedLeft = normalizeLocalPath(left)
  const normalizedRight = normalizeLocalPath(right)
  if (isWindowsLocalPath(normalizedLeft) || isWindowsLocalPath(normalizedRight)) {
    return normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US')
  }
  return normalizedLeft === normalizedRight
}

export function isLocalPathWithin(path: string, rootPath: string) {
  const normalizedPath = normalizeLocalPath(path)
  const normalizedRoot = normalizeLocalPath(rootPath)
  const comparablePath = compareLocalPath(normalizedPath, normalizedRoot)
  const comparableRoot = compareLocalPath(normalizedRoot, normalizedRoot)
  if (comparablePath === comparableRoot) {
    return true
  }
  if (comparableRoot === '/') {
    return comparablePath.startsWith('/')
  }
  const boundary = comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`
  return comparablePath.startsWith(boundary)
}

export function normalizeLocalPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed) {
    return ''
  }
  const isUnc = trimmed.startsWith('\\\\') || trimmed.startsWith('//')
  let normalized = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (isUnc) {
    normalized = `/${normalized}`
  }
  if (normalized === '/') {
    return normalized
  }
  if (/^[A-Za-z]:\/?$/.test(normalized)) {
    return `${normalized.slice(0, 2)}/`
  }
  return normalized.replace(/\/+$/, '')
}

function localPathRelativeParts(path: string, rootPath: string) {
  if (!isLocalPathWithin(path, rootPath)) {
    return []
  }
  const normalizedPath = normalizeLocalPath(path)
  const normalizedRoot = normalizeLocalPath(rootPath)
  if (localPathEquals(normalizedPath, normalizedRoot)) {
    return []
  }
  return normalizedPath.slice(normalizedRoot.length).split('/').filter(Boolean)
}

function joinLocalPath(rootPath: string, parts: readonly string[]) {
  if (parts.length === 0) {
    return rootPath
  }
  const separator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/'
  const suffix = parts.join(separator)
  const trimmedRoot = rootPath.replace(/[\\/]+$/, '')
  return `${trimmedRoot}${separator}${suffix}`
}

function compareLocalPath(path: string, rootPath: string) {
  return isWindowsLocalPath(rootPath) ? path.toLocaleLowerCase('en-US') : path
}

function isWindowsLocalPath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('//')
}

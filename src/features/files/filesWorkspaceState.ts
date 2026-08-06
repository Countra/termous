import type {
  FileSession,
  RemoteDirectoryListing,
  RemoteFileEntry,
} from '#entities/file'
import { normalizeRemotePath } from '#shared/path'

export const filesWorkspaceLayoutStorageKey = 'termous.ui.files.workspace'

export type FilesWorkspaceDirectoryStatus =
  | 'idle'
  | 'initial_loading'
  | 'navigating'
  | 'refreshing'
  | 'failed'
  | 'offline'
  | 'recovering'
  | 'closing'

export type FilesWorkspaceDirectoryRequestKind = 'navigate' | 'refresh'

export type FilesWorkspaceHistoryMode = 'push' | 'replace' | 'traverse'

export type FilesWorkspaceSortKey = 'name' | 'size' | 'modifiedAt'

export type FilesWorkspaceSortDirection = 'ascending' | 'descending'

export interface FilesWorkspaceSortState {
  key: FilesWorkspaceSortKey | null
  direction: FilesWorkspaceSortDirection | null
}

interface FilesWorkspaceDirectoryRequest {
  kind: FilesWorkspaceDirectoryRequestKind
  requestSequence: number
  historyMode: FilesWorkspaceHistoryMode
  historyIndex: number | null
}

export interface FilesWorkspaceFailedDirectoryRequest {
  path: string
  kind: FilesWorkspaceDirectoryRequestKind
  historyMode: FilesWorkspaceHistoryMode
  historyIndex: number | null
}

/**
 * 独立文件工作区中一个文件会话的全部视图状态。
 *
 * 远端路径、目录内容和选择均只保存在内存中；布局偏好使用单独的持久化模型，
 * 避免把远端敏感信息写入 localStorage。
 */
export interface RemoteDirectoryViewState {
  committedPath: string
  pendingPath: string | null
  listing: RemoteDirectoryListing | null
  focusedPath: string | null
  selectedPaths: string[]
  anchorPath: string | null
  history: string[]
  historyIndex: number
  scrollTop: number
  sortState: FilesWorkspaceSortState
  directoryStatus: FilesWorkspaceDirectoryStatus
  requestSequence: number
  error: string
  lastLoadedAt: number | null
  listingConnectionGeneration: number | null
  activeRequest: FilesWorkspaceDirectoryRequest | null
  failedRequest: FilesWorkspaceFailedDirectoryRequest | null
}

/**
 * 目录结果可以写入所属会话缓存，但只有仍属于当前活动连接时才能驱动当前页面行为。
 */
export function isActiveFilesWorkspaceDirectoryResult(
  requestSession: Pick<FileSession, 'id' | 'connection_generation'>,
  activeSessionId: string,
  currentSession: Pick<FileSession, 'id' | 'status' | 'connection_generation'> | undefined,
) {
  return currentSession?.id === requestSession.id
    && activeSessionId === requestSession.id
    && currentSession.status === 'connected'
    && (currentSession.connection_generation ?? 0)
      === (requestSession.connection_generation ?? 0)
}

export type FilesWorkspaceRuntimeState = Record<string, RemoteDirectoryViewState>

export interface FilesWorkspaceDirectoryRequestResult {
  state: RemoteDirectoryViewState
  requestSequence: number
}

export interface FilesWorkspaceAutomaticDirectoryRequest {
  path: string
  kind: 'initial' | 'refresh'
}

export interface FilesWorkspaceNavigationOptions {
  historyMode?: FilesWorkspaceHistoryMode
  historyIndex?: number
}

export interface FilesWorkspaceSelectionModifiers {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  contextMenu?: boolean
}

export interface FilesWorkspaceLayoutPreferences {
  bookmarkRailExpanded: boolean
  sidePanelWidth: number
  bottomDrawerHeight: number
  columnWidths: {
    name: number
    size: number
    modifiedAt: number
    permissions: number
  }
}

export const defaultFilesWorkspaceSortState: FilesWorkspaceSortState = {
  key: null,
  direction: null,
}

export const filesWorkspaceColumnWidthBounds = {
  name: { min: 180, max: 720 },
  size: { min: 72, max: 180 },
  modifiedAt: { min: 116, max: 260 },
  permissions: { min: 82, max: 180 },
} as const

export const filesWorkspaceSidePanelWidthBounds = {
  min: 300,
  max: 440,
} as const

export const filesWorkspaceBottomDrawerHeightBounds = {
  min: 260,
  max: 420,
} as const

export const defaultFilesWorkspaceLayoutPreferences: FilesWorkspaceLayoutPreferences = {
  bookmarkRailExpanded: true,
  sidePanelWidth: 352,
  bottomDrawerHeight: 260,
  columnWidths: {
    name: 300,
    size: 84,
    modifiedAt: 140,
    permissions: 92,
  },
}

/**
 * 恢复事务尚未完成时，即使服务端已先报告 connected，也必须等待事务对账后再加载目录。
 * 这能避免恢复状态在同一提交中取消刚启动的首个目录请求。
 */
export function canStartFilesWorkspaceDirectoryLoad(
  fileSessionStatus: string | undefined,
  recoveryPending: boolean,
) {
  return fileSessionStatus === 'connected' && !recoveryPending
}

export function createRemoteDirectoryViewState(
  initialPath = '/',
): RemoteDirectoryViewState {
  const path = normalizeRemotePath(initialPath)
  return {
    committedPath: path,
    pendingPath: null,
    listing: null,
    focusedPath: null,
    selectedPaths: [],
    anchorPath: null,
    history: [path],
    historyIndex: 0,
    scrollTop: 0,
    sortState: { ...defaultFilesWorkspaceSortState },
    directoryStatus: 'idle',
    requestSequence: 0,
    error: '',
    lastLoadedAt: null,
    listingConnectionGeneration: null,
    activeRequest: null,
    failedRequest: null,
  }
}

/**
 * 读取会话缓存。未建立缓存时返回一个全新的初始值，但不会偷偷修改 Map。
 */
export function getFilesWorkspaceSessionState(
  states: FilesWorkspaceRuntimeState,
  fileSessionId: string,
  initialPath = '/',
) {
  return states[fileSessionId] ?? createRemoteDirectoryViewState(initialPath)
}

export function setFilesWorkspaceSessionState(
  states: FilesWorkspaceRuntimeState,
  fileSessionId: string,
  state: RemoteDirectoryViewState,
): FilesWorkspaceRuntimeState {
  if (states[fileSessionId] === state) {
    return states
  }
  return {
    ...states,
    [fileSessionId]: state,
  }
}

/**
 * 文件会话关闭后立即移除其内存缓存，避免路径和文件名跨会话残留。
 */
export function removeFilesWorkspaceSessionState(
  states: FilesWorkspaceRuntimeState,
  fileSessionId: string,
): FilesWorkspaceRuntimeState {
  if (!Object.prototype.hasOwnProperty.call(states, fileSessionId)) {
    return states
  }
  const next = { ...states }
  delete next[fileSessionId]
  return next
}

export function retainFilesWorkspaceSessionStates(
  states: FilesWorkspaceRuntimeState,
  activeFileSessionIds: ReadonlySet<string>,
): FilesWorkspaceRuntimeState {
  const entries = Object.entries(states)
    .filter(([fileSessionId]) => activeFileSessionIds.has(fileSessionId))
  if (entries.length === Object.keys(states).length) {
    return states
  }
  return Object.fromEntries(entries)
}

/**
 * 页面挂载时只为没有明确失败事务的会话安排自动加载。
 * 失败目标必须留给用户显式重试，避免后台缓存刷新悄悄覆盖原请求。
 */
export function resolveFilesWorkspaceAutomaticDirectoryRequest(
  state: RemoteDirectoryViewState,
  initialPath: string,
  now: number,
  cacheMaxAgeMs: number,
  cacheDirty: boolean,
  connectionGeneration?: number,
): FilesWorkspaceAutomaticDirectoryRequest | null {
  if (state.directoryStatus === 'failed' && state.failedRequest !== null) {
    return null
  }
  if (state.listing === null) {
    return {
      path: normalizeRemotePath(initialPath),
      kind: 'initial',
    }
  }
  const cacheFresh = state.lastLoadedAt !== null
    && now - state.lastLoadedAt <= cacheMaxAgeMs
  const cacheBelongsToCurrentConnection = connectionGeneration === undefined
    || state.listingConnectionGeneration === connectionGeneration
  if (cacheFresh && !cacheDirty && cacheBelongsToCurrentConnection) {
    return null
  }
  return {
    path: state.committedPath,
    kind: 'refresh',
  }
}

export function beginFilesWorkspaceNavigation(
  state: RemoteDirectoryViewState,
  targetPath: string,
  options: FilesWorkspaceNavigationOptions = {},
): FilesWorkspaceDirectoryRequestResult {
  return beginFilesWorkspaceDirectoryRequest(
    state,
    'navigate',
    targetPath,
    options,
  )
}

export function beginFilesWorkspaceRefresh(
  state: RemoteDirectoryViewState,
): FilesWorkspaceDirectoryRequestResult {
  return beginFilesWorkspaceDirectoryRequest(
    state,
    'refresh',
    state.committedPath,
    { historyMode: 'replace' },
  )
}

function beginFilesWorkspaceDirectoryRequest(
  state: RemoteDirectoryViewState,
  kind: FilesWorkspaceDirectoryRequestKind,
  targetPath: string,
  options: FilesWorkspaceNavigationOptions,
): FilesWorkspaceDirectoryRequestResult {
  const normalizedTarget = normalizeRemotePath(targetPath)
  const requestSequence = state.requestSequence + 1
  const historyIndex = options.historyMode === 'traverse'
    ? normalizeHistoryIndex(state, options.historyIndex)
    : null
  const directoryStatus = state.listing === null
    ? 'initial_loading'
    : kind === 'refresh'
      ? 'refreshing'
      : 'navigating'

  return {
    requestSequence,
    state: {
      ...state,
      pendingPath: normalizedTarget,
      directoryStatus,
      requestSequence,
      error: '',
      failedRequest: null,
      activeRequest: {
        kind,
        requestSequence,
        historyMode: options.historyMode ?? 'push',
        historyIndex,
      },
    },
  }
}

/**
 * 只有当前请求序号可以提交结果。迟到响应保持原对象引用，便于调用方跳过渲染。
 */
export function completeFilesWorkspaceDirectoryRequest(
  state: RemoteDirectoryViewState,
  requestSequence: number,
  listing: RemoteDirectoryListing,
  loadedAt: number,
  connectionGeneration: number | null = state.listingConnectionGeneration,
): RemoteDirectoryViewState {
  if (!isCurrentDirectoryRequest(state, requestSequence)) {
    return state
  }

  const committedPath = normalizeRemotePath(listing.path)
  const normalizedListing: RemoteDirectoryListing = {
    ...listing,
    path: committedPath,
    parent_path: normalizeRemotePath(listing.parent_path),
    entries: listing.entries ?? [],
  }
  const activeRequest = state.activeRequest
  if (activeRequest.kind === 'refresh') {
    const availablePaths = new Set(normalizedListing.entries.map((entry) => entry.path))
    return {
      ...state,
      committedPath,
      pendingPath: null,
      listing: normalizedListing,
      focusedPath: keepAvailablePath(state.focusedPath, availablePaths),
      selectedPaths: state.selectedPaths.filter((path) => availablePaths.has(path)),
      anchorPath: keepAvailablePath(state.anchorPath, availablePaths),
      directoryStatus: 'idle',
      error: '',
      lastLoadedAt: loadedAt,
      listingConnectionGeneration: connectionGeneration,
      activeRequest: null,
      failedRequest: null,
    }
  }

  const historyState = commitHistory(
    state,
    committedPath,
    activeRequest.historyMode,
    activeRequest.historyIndex,
  )
  return {
    ...state,
    ...historyState,
    committedPath,
    pendingPath: null,
    listing: normalizedListing,
    focusedPath: null,
    selectedPaths: [],
    anchorPath: null,
    scrollTop: 0,
    directoryStatus: 'idle',
    error: '',
    lastLoadedAt: loadedAt,
    listingConnectionGeneration: connectionGeneration,
    activeRequest: null,
    failedRequest: null,
  }
}

/**
 * 失败只结束匹配的请求；已成功显示的目录、历史、选择和滚动位置保持不变。
 */
export function failFilesWorkspaceDirectoryRequest(
  state: RemoteDirectoryViewState,
  requestSequence: number,
  error: string,
): RemoteDirectoryViewState {
  if (!isCurrentDirectoryRequest(state, requestSequence)) {
    return state
  }
  const activeRequest = state.activeRequest
  const failedRequest = state.pendingPath === null || activeRequest === null
    ? null
    : {
        path: state.pendingPath,
        kind: activeRequest.kind,
        historyMode: activeRequest.historyMode,
        historyIndex: activeRequest.historyIndex,
      }
  return {
    ...state,
    pendingPath: null,
    directoryStatus: 'failed',
    error,
    activeRequest: null,
    failedRequest,
  }
}

/**
 * 主动取消会递增序号，让网络层中已经无法中断的旧响应自然失效。
 */
export function cancelFilesWorkspaceDirectoryRequest(
  state: RemoteDirectoryViewState,
): RemoteDirectoryViewState {
  if (state.activeRequest === null) {
    return state
  }
  return {
    ...state,
    pendingPath: null,
    directoryStatus: 'idle',
    requestSequence: state.requestSequence + 1,
    error: '',
    activeRequest: null,
  }
}

export function getFilesWorkspaceHistoryTarget(
  state: RemoteDirectoryViewState,
  direction: 'back' | 'forward',
): { path: string; historyIndex: number } | null {
  const historyIndex = state.historyIndex + (direction === 'back' ? -1 : 1)
  const path = state.history[historyIndex]
  return path === undefined ? null : { path, historyIndex }
}

export function beginFilesWorkspaceHistoryNavigation(
  state: RemoteDirectoryViewState,
  historyIndex: number,
): FilesWorkspaceDirectoryRequestResult | null {
  const targetPath = state.history[historyIndex]
  if (targetPath === undefined || historyIndex === state.historyIndex) {
    return null
  }
  return beginFilesWorkspaceNavigation(state, targetPath, {
    historyMode: 'traverse',
    historyIndex,
  })
}

export function setFilesWorkspaceScrollTop(
  state: RemoteDirectoryViewState,
  scrollTop: number,
): RemoteDirectoryViewState {
  const normalized = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  return normalized === state.scrollTop
    ? state
    : { ...state, scrollTop: normalized }
}

export function setFilesWorkspaceSortState(
  state: RemoteDirectoryViewState,
  sortState: FilesWorkspaceSortState,
): RemoteDirectoryViewState {
  if (
    state.sortState.key === sortState.key
    && state.sortState.direction === sortState.direction
  ) {
    return state
  }
  return {
    ...state,
    sortState: { ...sortState },
  }
}

export function resolveFilesWorkspaceSortState(
  key: FilesWorkspaceSortKey,
  order: 'ascend' | 'descend' | null | undefined,
): FilesWorkspaceSortState {
  if (!order) {
    return { ...defaultFilesWorkspaceSortState }
  }
  return {
    key,
    direction: order === 'ascend' ? 'ascending' : 'descending',
  }
}

/**
 * 未选择排序时保留服务端原始顺序；用户排序后目录优先，同类条目再按字段稳定排序。
 */
export function sortFilesWorkspaceEntries(
  entries: readonly RemoteFileEntry[],
  sortState: FilesWorkspaceSortState,
) {
  if (sortState.key === null || sortState.direction === null) {
    return [...entries]
  }
  const sortKey = sortState.key
  const direction = sortState.direction === 'ascending' ? 1 : -1
  return [...entries].sort((left, right) => {
    const kindOrder = Number(left.kind !== 'directory') - Number(right.kind !== 'directory')
    if (kindOrder !== 0) {
      return kindOrder
    }
    const fieldOrder = compareFileEntryField(left, right, sortKey)
    if (fieldOrder !== 0) {
      return fieldOrder * direction
    }
    return compareText(left.name, right.name)
  })
}

/**
 * 文件列表选择模型：
 * - 普通点击替换选择；
 * - Ctrl/Meta 切换单项；
 * - Shift 从锚点选择连续范围，Ctrl/Meta+Shift 合并范围；
 * - 右键已选项保留整组，右键未选项切换为单选。
 */
export function applyFilesWorkspaceSelection(
  state: RemoteDirectoryViewState,
  orderedPaths: readonly string[],
  targetPath: string,
  modifiers: FilesWorkspaceSelectionModifiers = {},
): RemoteDirectoryViewState {
  if (!orderedPaths.includes(targetPath)) {
    return state
  }
  if (modifiers.contextMenu) {
    if (state.selectedPaths.includes(targetPath)) {
      return state.focusedPath === targetPath
        ? state
        : { ...state, focusedPath: targetPath }
    }
    return {
      ...state,
      focusedPath: targetPath,
      selectedPaths: [targetPath],
      anchorPath: targetPath,
    }
  }

  const additive = Boolean(modifiers.ctrlKey || modifiers.metaKey)
  if (modifiers.shiftKey) {
    const anchorPath = selectionAnchor(state, orderedPaths, targetPath)
    const range = selectionRange(orderedPaths, anchorPath, targetPath)
    return {
      ...state,
      focusedPath: targetPath,
      selectedPaths: additive
        ? orderedSelectionUnion(orderedPaths, state.selectedPaths, range)
        : range,
      anchorPath,
    }
  }

  if (additive) {
    const selected = new Set(state.selectedPaths)
    if (selected.has(targetPath)) {
      selected.delete(targetPath)
    } else {
      selected.add(targetPath)
    }
    return {
      ...state,
      focusedPath: targetPath,
      selectedPaths: orderedPaths.filter((path) => selected.has(path)),
      anchorPath: targetPath,
    }
  }

  return {
    ...state,
    focusedPath: targetPath,
    selectedPaths: [targetPath],
    anchorPath: targetPath,
  }
}

/**
 * Escape 清空操作选择，但保留键盘焦点，便于继续用方向键浏览。
 */
export function clearFilesWorkspaceSelection(
  state: RemoteDirectoryViewState,
): RemoteDirectoryViewState {
  if (state.selectedPaths.length === 0 && state.anchorPath === null) {
    return state
  }
  return {
    ...state,
    selectedPaths: [],
    anchorPath: null,
  }
}

export function setFilesWorkspaceDirectoryStatus(
  state: RemoteDirectoryViewState,
  directoryStatus: Extract<
    FilesWorkspaceDirectoryStatus,
    'offline' | 'recovering' | 'closing'
  >,
  error = '',
): RemoteDirectoryViewState {
  return {
    ...state,
    pendingPath: null,
    directoryStatus,
    requestSequence: state.activeRequest === null
      ? state.requestSequence
      : state.requestSequence + 1,
    error,
    activeRequest: null,
  }
}

/**
 * 仅解析非敏感 UI 偏好。非法 JSON、未知字段和越界尺寸都会安全回落。
 */
export function parseFilesWorkspaceLayoutPreferences(
  serialized: string | null | undefined,
): FilesWorkspaceLayoutPreferences {
  if (!serialized) {
    return cloneDefaultLayoutPreferences()
  }
  try {
    const value: unknown = JSON.parse(serialized)
    if (!isRecord(value)) {
      return cloneDefaultLayoutPreferences()
    }
    const columnWidths = isRecord(value.columnWidths) ? value.columnWidths : {}
    const parsedColumnWidths = {
      name: boundedNumberOrDefault(
        columnWidths.name,
        filesWorkspaceColumnWidthBounds.name.min,
        filesWorkspaceColumnWidthBounds.name.max,
        defaultFilesWorkspaceLayoutPreferences.columnWidths.name,
      ),
      size: boundedNumberOrDefault(
        columnWidths.size,
        filesWorkspaceColumnWidthBounds.size.min,
        filesWorkspaceColumnWidthBounds.size.max,
        defaultFilesWorkspaceLayoutPreferences.columnWidths.size,
      ),
      modifiedAt: boundedNumberOrDefault(
        columnWidths.modifiedAt,
        filesWorkspaceColumnWidthBounds.modifiedAt.min,
        filesWorkspaceColumnWidthBounds.modifiedAt.max,
        defaultFilesWorkspaceLayoutPreferences.columnWidths.modifiedAt,
      ),
      permissions: boundedNumberOrDefault(
        columnWidths.permissions,
        filesWorkspaceColumnWidthBounds.permissions.min,
        filesWorkspaceColumnWidthBounds.permissions.max,
        defaultFilesWorkspaceLayoutPreferences.columnWidths.permissions,
      ),
    }
    const usesPreviousDefaultWidths = (
      parsedColumnWidths.name === 420
      && parsedColumnWidths.size === 120
      && parsedColumnWidths.modifiedAt === 180
      && parsedColumnWidths.permissions === 120
    )
    const defaultSidePanelWidth = defaultFilesWorkspaceLayoutPreferences.sidePanelWidth
    const currentSidePanelWidth = (
      typeof value.sidePanelWidth === 'number' && Number.isFinite(value.sidePanelWidth)
        ? value.sidePanelWidth
        : undefined
    )
    const legacyInspectorWidth = (
      typeof value.inspectorWidth === 'number' && Number.isFinite(value.inspectorWidth)
        ? value.inspectorWidth
        : undefined
    )
    const legacyBookmarkWidth = (
      typeof value.bookmarkSidebarWidth === 'number' && Number.isFinite(value.bookmarkSidebarWidth)
        ? value.bookmarkSidebarWidth
        : undefined
    )
    // 旧偏好曾分别保存两套宽度；优先迁移实际定制值，避免默认值覆盖用户设置。
    const legacySidePanelWidth = (
      legacyBookmarkWidth !== undefined && legacyBookmarkWidth !== defaultSidePanelWidth
        ? legacyBookmarkWidth
        : legacyInspectorWidth !== undefined && legacyInspectorWidth !== defaultSidePanelWidth
          ? legacyInspectorWidth
          : legacyBookmarkWidth ?? legacyInspectorWidth
    )
    return {
      bookmarkRailExpanded: typeof value.bookmarkRailExpanded === 'boolean'
        ? value.bookmarkRailExpanded
        : defaultFilesWorkspaceLayoutPreferences.bookmarkRailExpanded,
      sidePanelWidth: boundedNumberOrDefault(
        currentSidePanelWidth ?? legacySidePanelWidth,
        filesWorkspaceSidePanelWidthBounds.min,
        filesWorkspaceSidePanelWidthBounds.max,
        defaultSidePanelWidth,
      ),
      bottomDrawerHeight: boundedNumberOrDefault(
        value.bottomDrawerHeight ?? value.transferDockHeight,
        filesWorkspaceBottomDrawerHeightBounds.min,
        filesWorkspaceBottomDrawerHeightBounds.max,
        defaultFilesWorkspaceLayoutPreferences.bottomDrawerHeight,
      ),
      // 开发期旧默认值不属于用户定制，直接收敛到更紧凑的新默认宽度。
      columnWidths: usesPreviousDefaultWidths
        ? { ...defaultFilesWorkspaceLayoutPreferences.columnWidths }
        : parsedColumnWidths,
    }
  } catch {
    return cloneDefaultLayoutPreferences()
  }
}

export function serializeFilesWorkspaceLayoutPreferences(
  preferences: FilesWorkspaceLayoutPreferences,
) {
  return JSON.stringify(parseFilesWorkspaceLayoutPreferences(JSON.stringify(preferences)))
}

function isCurrentDirectoryRequest(
  state: RemoteDirectoryViewState,
  requestSequence: number,
): state is RemoteDirectoryViewState & {
  activeRequest: FilesWorkspaceDirectoryRequest
} {
  return (
    requestSequence === state.requestSequence
    && state.activeRequest?.requestSequence === requestSequence
  )
}

function normalizeHistoryIndex(
  state: RemoteDirectoryViewState,
  requestedIndex: number | undefined,
) {
  if (
    requestedIndex === undefined
    || !Number.isInteger(requestedIndex)
    || requestedIndex < 0
    || requestedIndex >= state.history.length
  ) {
    return null
  }
  return requestedIndex
}

function commitHistory(
  state: RemoteDirectoryViewState,
  path: string,
  mode: FilesWorkspaceHistoryMode,
  requestedIndex: number | null,
): Pick<RemoteDirectoryViewState, 'history' | 'historyIndex'> {
  if (mode === 'traverse' && requestedIndex !== null) {
    const history = [...state.history]
    history[requestedIndex] = path
    return { history, historyIndex: requestedIndex }
  }
  if (mode === 'replace') {
    const history = [...state.history]
    history[state.historyIndex] = path
    return { history, historyIndex: state.historyIndex }
  }
  if (path === state.committedPath) {
    return { history: state.history, historyIndex: state.historyIndex }
  }
  const history = [
    ...state.history.slice(0, state.historyIndex + 1),
    path,
  ]
  return { history, historyIndex: history.length - 1 }
}

function keepAvailablePath(
  path: string | null,
  availablePaths: ReadonlySet<string>,
) {
  return path !== null && availablePaths.has(path) ? path : null
}

function selectionAnchor(
  state: RemoteDirectoryViewState,
  orderedPaths: readonly string[],
  fallback: string,
) {
  if (state.anchorPath && orderedPaths.includes(state.anchorPath)) {
    return state.anchorPath
  }
  if (state.focusedPath && orderedPaths.includes(state.focusedPath)) {
    return state.focusedPath
  }
  return fallback
}

function selectionRange(
  orderedPaths: readonly string[],
  anchorPath: string,
  targetPath: string,
) {
  const anchorIndex = orderedPaths.indexOf(anchorPath)
  const targetIndex = orderedPaths.indexOf(targetPath)
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return orderedPaths.slice(start, end + 1)
}

function orderedSelectionUnion(
  orderedPaths: readonly string[],
  current: readonly string[],
  added: readonly string[],
) {
  const selected = new Set([...current, ...added])
  return orderedPaths.filter((path) => selected.has(path))
}

function compareFileEntryField(
  left: RemoteFileEntry,
  right: RemoteFileEntry,
  key: FilesWorkspaceSortKey,
) {
  if (key === 'size') {
    return left.size - right.size
  }
  if (key === 'modifiedAt') {
    return dateValue(left.modified_at) - dateValue(right.modified_at)
  }
  return compareText(left.name, right.name)
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function dateValue(value: string | undefined) {
  if (!value) {
    return 0
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function cloneDefaultLayoutPreferences(): FilesWorkspaceLayoutPreferences {
  return {
    ...defaultFilesWorkspaceLayoutPreferences,
    columnWidths: {
      ...defaultFilesWorkspaceLayoutPreferences.columnWidths,
    },
  }
}

function boundedNumberOrDefault(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import { App as AntdApp, Input, Modal } from 'antd'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  usePersistentBooleanState,
  usePersistentJsonState,
  useRafResizablePanelWidth,
} from '#shared/hooks'
import { normalizeRemotePosixPath } from '#shared/path'
import {
  createEmptyTerminalSearchResult,
  useTerminalRuntime,
  type TerminalSearchDirection,
  type TerminalSplitWorkspaceHandle,
} from '#features/terminal'
import {
  CommandDispatchDock,
  isCommandDispatchTaskTerminal,
  useCommandDispatchRuntime,
} from '#features/command-dispatch'
import type { AppTheme as ThemeMode } from '#common/contracts'
import type { CodeSnippet } from '#entities/snippet'
import type { ForwardInstance, ForwardStartRequest } from '#entities/forward'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'
import type {
  FileBookmark,
  FileBookmarkInput,
  FileSession,
  FileSessionClosureState,
} from '#entities/file'
import { commandDockHeightLimits, parseCommandDockHeight } from '../model/commandDockHeight'
import type { FileGateway } from '#features/files'
import {
  buildSnippetTags,
  filterSnippets,
  type SnippetCatalogFilter,
} from '#features/snippets'
import { analyzeSnippetRisk, extractSnippetVariables, renderSnippetCommand } from '#entities/snippet'
import { ForwardSessionPanel } from '#features/forwards'
import { AliasPanel, type AliasGateway } from '#features/alias'
import { DockerPanel, type DockerGateway } from '#features/docker'
import { FirewallPanel, type FirewallGateway } from '#features/firewall'
import {
  ProcessPanel,
  SystemMonitorPanel,
  type ObservabilityGateway,
} from '#features/observability'
import { ServicePanel, type ServiceGateway } from '#features/service'
import { CrontabPanel, type CrontabGateway } from '#features/crontab'
import {
  WorkbenchFilesPanel,
  type WorkbenchFilesPathNavigationIntent,
} from '#features/workbench-files'
import {
  canRetrySessionInventory,
  getAutomaticSessionInventoryDemand,
  getSessionInventoryVisibleScope,
  isSessionInventoryRequestCurrent,
  type SessionInventoryRequestIdentity,
} from '../model/sessionInventoryDemand'
import {
  areSessionTabPreferenceMapsEqual,
  compactSessionTabPreference,
  normalizeSessionTabTitle,
  parseSessionTabPreferences,
  pruneSessionTabPreferences,
  sortSessionsForTabs,
  type SessionTabPreference,
  type SessionTabPreferenceMap,
} from '../model/sessionTabPreferences'
import snippetStyles from './SnippetWorkbench.module.scss'
import pageStyles from './WorkbenchPage.module.scss'
import { parseDetailsTabKey, type DetailsTabKey } from '../model/workbenchDetails'
import { formatWorkbenchTime } from '../model/workbenchFormatters'
import type {
  WorkbenchFilesView,
  WorkbenchHostView,
  WorkbenchSessionView,
  WorkbenchSnippetView,
} from '../model/workbenchViewModels'
import type {
  WorkbenchTerminalSearchState,
  WorkbenchTerminalTabDragState,
} from '../model/workbenchTerminalTypes'
import { WorkbenchConnectionOverview } from './WorkbenchConnectionOverview'
import { WorkbenchDetailsPanel } from './WorkbenchDetailsPanel'
import {
  WorkbenchSessionTabs,
  type SessionTabMenuAction,
} from './WorkbenchSessionTabs'
import {
  SnippetRiskDialog,
  SnippetVariablePrompt,
  WorkbenchSnippetPanel,
} from './WorkbenchSnippetPanel'
import { WorkbenchSystemInfoPanel } from './WorkbenchSystemInfoPanel'
import { WorkbenchTerminalPanel } from './WorkbenchTerminalPanel'
import { termousNotificationClassName } from '#shared/ui'

const workbenchDetailsPanelWidth = {
  default: 300,
  min: 260,
  max: 420,
}

type TerminalSearchState = WorkbenchTerminalSearchState

interface PendingTerminalSearchRequest {
  sessionId: string
  sourceSessionId: string | null
  initialQuery: string
}

type TerminalTabDragState = WorkbenchTerminalTabDragState

interface SessionInventoryRequest extends SessionInventoryRequestIdentity {
  controller: AbortController
  baselineSignature: string
}

interface SessionInventoryRequestView {
  sessionId: string
  loading: boolean
  error: string
  baselineSignature: string
}

export interface WorkbenchPageProps {
  fileGateway: FileGateway
  observabilityGateway: ObservabilityGateway
  serviceGateway: ServiceGateway
  crontabGateway: CrontabGateway
  dockerGateway: DockerGateway
  firewallGateway: FirewallGateway
  aliasGateway: AliasGateway
  getHostIconUrl: (iconId: string) => string
  hostView: WorkbenchHostView
  sessionView: WorkbenchSessionView
  filesView: WorkbenchFilesView
  forwards: ForwardInstance[]
  snippetView: WorkbenchSnippetView
  fileSessionClosures: Readonly<Record<string, FileSessionClosureState>>
  theme: ThemeMode
  active: boolean
  selectedHostId: string
  activeSession: Session | null
  actionBusy: boolean
  onOpenConnectionLauncher: () => void
  onConnect: (hostId: string) => Promise<void>
  onSelectSession: (sessionId: string) => void
  onDisconnect: (sessionId: string) => Promise<boolean>
  onRefreshInventory: (sessionId: string, force: boolean, signal?: AbortSignal) => Promise<Session>
  onOpenFiles: (session: Session) => Promise<void>
  onManageBookmarks: (session: Session) => Promise<void>
  onConnectFileSession: (
    hostId: string,
    sourceSessionId?: string,
    initialPath?: string,
    replacedFileSessionId?: string,
  ) => Promise<FileSession>
  onReconnectFileSession: (fileSessionId: string) => Promise<FileSession>
  onUpdateFileSession: (fileSession: FileSession) => void
  onCreateFileBookmark: (input: FileBookmarkInput) => Promise<FileBookmark>
  onUpdateFileBookmark: (
    id: string,
    input: FileBookmarkInput,
  ) => Promise<FileBookmark>
  onSnippetUsed: (snippetId: string) => Promise<void>
  onToggleSnippetFavorite: (snippet: CodeSnippet) => Promise<void>
  onStartForward: (input: ForwardStartRequest) => Promise<ForwardInstance>
  onRestartForward: (id: string) => Promise<void>
  onStopForward: (id: string) => Promise<void>
}

export function WorkbenchPage({
  fileGateway,
  observabilityGateway,
  serviceGateway,
  crontabGateway,
  dockerGateway,
  firewallGateway,
  aliasGateway,
  getHostIconUrl,
  hostView,
  sessionView,
  filesView,
  forwards,
  snippetView,
  fileSessionClosures,
  theme,
  active,
  selectedHostId,
  activeSession,
  actionBusy,
  onOpenConnectionLauncher,
  onConnect,
  onSelectSession,
  onDisconnect,
  onRefreshInventory,
  onOpenFiles,
  onManageBookmarks,
  onConnectFileSession,
  onReconnectFileSession,
  onUpdateFileSession,
  onCreateFileBookmark,
  onUpdateFileBookmark,
  onSnippetUsed,
  onToggleSnippetFavorite,
  onStartForward,
  onRestartForward,
  onStopForward,
}: WorkbenchPageProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const { searchActive, clearActiveSearch, focusSession, sendTextToSession } = useTerminalRuntime()
  const commandDispatchRuntime = useCommandDispatchRuntime()
  const [commandDockOpen, setCommandDockOpen] = usePersistentBooleanState(
    'termous.ui.workbench.commandDispatchDockOpen.v1',
    false,
  )
  const [commandDockHeight, setCommandDockHeight] = usePersistentJsonState<number>(
    'termous.ui.workbench.commandDispatchDockHeight.v1',
    commandDockHeightLimits.default,
    parseCommandDockHeight,
  )
  const [detailsCollapsed, setDetailsCollapsed] = usePersistentBooleanState(
    'termous.ui.workbench.detailsCollapsed.v1',
    false,
  )
  const workbenchGridRef = useRef<HTMLElement>(null)
  const expandDetailsPanel = useCallback(() => setDetailsCollapsed(false), [setDetailsCollapsed])
  const detailsPanelResize = useRafResizablePanelWidth({
    storageKey: 'termous.ui.workbench.detailsPanelWidth.v1',
    defaultWidth: workbenchDetailsPanelWidth.default,
    minWidth: workbenchDetailsPanelWidth.min,
    maxWidth: workbenchDetailsPanelWidth.max,
    side: 'right',
    targetRef: workbenchGridRef,
    cssVariableName: '--workbench-details-width',
    onExpand: expandDetailsPanel,
  })
  const [detailsActiveTab, setDetailsActiveTab] = usePersistentJsonState<DetailsTabKey>(
    'termous.ui.workbench.detailsActiveTab.v1',
    'overview',
    parseDetailsTabKey,
  )
  const workbenchGridStyle = {
    '--workbench-details-width': `${detailsPanelResize.width}px`,
  } as CSSProperties
  const terminalSplitRef = useRef<TerminalSplitWorkspaceHandle>(null)
  const closingSessionIdsRef = useRef(new Set<string>())
  const previousSessionStatusRef = useRef(new Map<string, Session['status']>())
  const terminalTabDragRef = useRef<TerminalTabDragState | null>(null)
  const inventoryRequestRef = useRef<SessionInventoryRequest | null>(null)
  const inventoryRequestRevisionRef = useRef(0)
  const inventoryVisibleSessionIdRef = useRef('')
  const inventoryVisibleSignatureRef = useRef('')
  const refreshInventoryRef = useRef(onRefreshInventory)
  const translateRef = useRef(t)
  const suppressNextTabClickRef = useRef(false)
  const recentConnectionTimersRef = useRef(new Map<string, number>())
  const [recentlyConnectedSessionIds, setRecentlyConnectedSessionIds] = useState<Set<string>>(() => new Set())
  const [closingSessionIds, setClosingSessionIds] = useState<Set<string>>(() => new Set())
  const [pendingSearchRequest, setPendingSearchRequest] = useState<PendingTerminalSearchRequest | null>(null)
  const [filesPathNavigationIntent, setFilesPathNavigationIntent] =
    useState<WorkbenchFilesPathNavigationIntent | null>(null)
  const nextFilesPathNavigationRequestIdRef = useRef(0)
  const activatedFilesPathNavigationRequestIdRef = useRef<number | null>(null)
  const [terminalTabDrag, setTerminalTabDrag] = useState<TerminalTabDragState | null>(null)
  const [snippetFilter, setSnippetFilter] = useState<SnippetCatalogFilter>('all')
  const [snippetQuery, setSnippetQuery] = useState('')
  const [snippetSelectedTags, setSnippetSelectedTags] = useState<string[]>([])
  const [snippetSelectedGroupId, setSnippetSelectedGroupId] = useState('')
  const [collapsedSnippetGroups, setCollapsedSnippetGroups] = useState<Set<string>>(() => new Set())
  const [terminalSearch, setTerminalSearchState] = useState<TerminalSearchState>({
    open: false,
    sessionId: null,
    query: '',
    caseSensitive: false,
    regex: false,
    result: createEmptyTerminalSearchResult(),
  })
  const terminalSearchRef = useRef(terminalSearch)
  const commitTerminalSearch = useCallback((next: TerminalSearchState) => {
    terminalSearchRef.current = next
    setTerminalSearchState(next)
  }, [])
  const [sessionTabPreferences, setSessionTabPreferences] = usePersistentJsonState<SessionTabPreferenceMap>(
    'termous.ui.workbench.sessionTabPreferences.v1',
    {},
    parseSessionTabPreferences,
  )
  const [durationNow, setDurationNow] = useState(() => Date.now())
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [colorSessionId, setColorSessionId] = useState<string | null>(null)
  const [quickConnectOpen, setQuickConnectOpen] = useState(false)
  const [quickConnectQuery, setQuickConnectQuery] = useState('')
  const [inventoryRequestView, setInventoryRequestView] = useState<SessionInventoryRequestView>({
    sessionId: '',
    loading: false,
    error: '',
    baselineSignature: '',
  })
  const selectedHost = hostView.hosts.find((host) => host.id === selectedHostId) ?? hostView.hosts[0]
  const activeSessionId = activeSession?.id
  const inventoryVisibleSessionId = getSessionInventoryVisibleScope(activeSession, detailsActiveTab, detailsCollapsed)
  const automaticInventorySessionId = getAutomaticSessionInventoryDemand(activeSession, detailsActiveTab, detailsCollapsed)

  useEffect(() => {
    if (active) {
      return
    }
    setQuickConnectOpen(false)
    setQuickConnectQuery('')
  }, [active])
  const activeInventorySignature = sessionInventoryViewSignature(activeSession)
  inventoryVisibleSessionIdRef.current = inventoryVisibleSessionId
  inventoryVisibleSignatureRef.current = activeInventorySignature
  refreshInventoryRef.current = onRefreshInventory
  translateRef.current = t
  const currentInventoryRequestView = inventoryRequestView.sessionId === activeSessionId
    ? inventoryRequestView
    : { sessionId: activeSessionId ?? '', loading: false, error: '', baselineSignature: '' }
  const activeSessionClosing = Boolean(activeSessionId && closingSessionIds.has(activeSessionId))
  const sessionStatus = String(activeSession?.status ?? 'disconnected')
  const sessionBadgeStatus = activeSessionClosing ? 'connecting' : normalizeSessionBadgeStatus(sessionStatus)
  const sessionStatusLabel = activeSessionClosing ? t('workbench.closingSession') : t(`status.${sessionStatus}`)
  const showRecentConnectionProgress = Boolean(activeSessionId && recentlyConnectedSessionIds.has(activeSessionId))
  const hasConnectionProgress = Boolean(
    activeSession &&
      activeSession.status !== 'disconnected' &&
      (activeSession.status !== 'connected' || showRecentConnectionProgress),
  )
  const [terminalSize, setTerminalSize] = useState({ cols: activeSession?.pty_cols ?? 120, rows: activeSession?.pty_rows ?? 32 })
  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    setTerminalSize({ cols, rows })
  }, [])
  const sessionHost = activeSession?.host_id ? hostView.hosts.find((host) => host.id === activeSession.host_id) : undefined
  const visibleSessions = useMemo(
    () => sortSessionsForTabs(sessionView.sessions, sessionTabPreferences),
    [sessionTabPreferences, sessionView.sessions],
  )
  const aliasSessionIds = useMemo(
    () => sessionView.sessions
      .filter((session) => session.kind === 'ssh')
      .map((session) => session.id),
    [sessionView.sessions],
  )
  const activeSessionIndex = activeSession ? visibleSessions.findIndex((session) => session.id === activeSession.id) : -1
  const sessionPositionLabel =
    activeSessionIndex >= 0 ? `${activeSessionIndex + 1} / ${visibleSessions.length}` : '0'
  const sessionStateLabel = activeSessionClosing
    ? t('workbench.closingSession')
    : activeSession?.proxy_id && activeSession.phase === 'dialing'
      ? t(activeSession.jump_host_id
        ? 'connection.proxyDialingJumpHost'
        : 'connection.proxyDialingTarget')
    : activeSession?.phase
      ? t(`connection.phase.${activeSession.phase}`)
      : t(`status.${sessionStatus}`)
  const targetLabel =
    activeSession?.kind === 'local'
      ? t('workbench.localTerminal')
      : sessionHost
        ? `${sessionHost.username}@${sessionHost.address}:${sessionHost.port}`
        : t('workbench.noHost')
  const startedAt = activeSession?.started_at ? formatWorkbenchTime(activeSession.started_at) : t('fields.none')
  const sessionDuration = formatSessionDuration(activeSession, durationNow, t('fields.none'))
  const terminalThemeMode = sessionView.terminalSettings.theme_mode === 'follow_app'
    ? theme
    : sessionView.terminalSettings.theme_mode
  const workbenchFilesData = useMemo(() => ({
    hosts: hostView.hosts,
    sessions: sessionView.sessions,
    terminalSettings: sessionView.terminalSettings,
    fileBookmarkGroups: filesView.fileBookmarkGroups,
    fileBookmarks: filesView.fileBookmarks,
    fileSessions: filesView.fileSessions,
  }), [
    filesView.fileBookmarkGroups,
    filesView.fileBookmarks,
    filesView.fileSessions,
    hostView.hosts,
    sessionView.sessions,
    sessionView.terminalSettings,
  ])
  const canSendSnippet = Boolean(activeSession?.kind === 'ssh' && activeSession.status === 'connected')
  const snippetTags = useMemo(() => buildSnippetTags(snippetView.snippets), [snippetView.snippets])
  const filteredSnippets = useMemo(
    () => filterSnippets(snippetView.snippets, {
      filter: snippetFilter,
      query: snippetQuery,
      selectedTags: snippetSelectedTags,
      groupId: snippetSelectedGroupId,
    }),
    [snippetFilter, snippetQuery, snippetSelectedGroupId, snippetSelectedTags, snippetView.snippets],
  )
  const groupedFilteredSnippets = useMemo(() => {
    const snippetsByGroup = new Map(snippetView.snippetGroups.map((group) => [group.id, [] as CodeSnippet[]]))
    const ungrouped: CodeSnippet[] = []
    filteredSnippets.forEach((snippet) => {
      const groupSnippets = snippetsByGroup.get(snippet.group_id)
      if (groupSnippets) {
        groupSnippets.push(snippet)
      } else {
        ungrouped.push(snippet)
      }
    })
    return [
      ...snippetView.snippetGroups.map((group) => ({
        id: group.id,
        name: group.name,
        snippets: snippetsByGroup.get(group.id) ?? [],
      })),
      { id: '__ungrouped__', name: t('snippets.ungrouped'), snippets: ungrouped },
    ].filter((group) => group.snippets.length > 0)
  }, [filteredSnippets, snippetView.snippetGroups, t])
  const toggleSnippetGroup = useCallback((groupId: string) => {
    setCollapsedSnippetGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])
  const requestSessionInventory = useCallback(async (sessionId: string, force: boolean) => {
    inventoryRequestRef.current?.controller.abort()
    const request: SessionInventoryRequest = {
      sessionId,
      revision: inventoryRequestRevisionRef.current + 1,
      controller: new AbortController(),
      baselineSignature: inventoryVisibleSignatureRef.current,
    }
    inventoryRequestRevisionRef.current = request.revision
    inventoryRequestRef.current = request
    setInventoryRequestView({
      sessionId,
      loading: true,
      error: '',
      baselineSignature: request.baselineSignature,
    })
    try {
      await refreshInventoryRef.current(sessionId, force, request.controller.signal)
      if (isSessionInventoryRequestCurrent(
        request,
        inventoryRequestRef.current,
        inventoryVisibleSessionIdRef.current,
        request.controller.signal.aborted,
      )) {
        setInventoryRequestView({ sessionId, loading: false, error: '', baselineSignature: '' })
      }
    } catch (error) {
      if (
        !shouldIgnoreInventoryRequestError(error) &&
        isSessionInventoryRequestCurrent(
          request,
          inventoryRequestRef.current,
          inventoryVisibleSessionIdRef.current,
          request.controller.signal.aborted,
        )
      ) {
        setInventoryRequestView({
          sessionId,
          loading: false,
          error: error instanceof Error ? error.message : translateRef.current('workbench.systemInfo.requestFailed'),
          baselineSignature: request.baselineSignature,
        })
      }
    } finally {
      if (inventoryRequestRef.current === request) {
        inventoryRequestRef.current = null
      }
    }
  }, [])
  useEffect(() => {
    const request = inventoryRequestRef.current
    if (request && request.sessionId !== inventoryVisibleSessionId) {
      request.controller.abort()
      inventoryRequestRef.current = null
    }
    setInventoryRequestView((current) => {
      if (!inventoryVisibleSessionId) {
        return current.sessionId || current.loading || current.error
          ? { sessionId: '', loading: false, error: '', baselineSignature: '' }
          : current
      }
      return current.sessionId === inventoryVisibleSessionId
        ? current
        : { sessionId: inventoryVisibleSessionId, loading: false, error: '', baselineSignature: '' }
    })
  }, [inventoryVisibleSessionId])
  useEffect(() => {
    setInventoryRequestView((current) => {
      if (
        !current.error ||
        current.sessionId !== activeSessionId ||
        current.baselineSignature === activeInventorySignature
      ) {
        return current
      }
      return { ...current, error: '', baselineSignature: '' }
    })
  }, [activeInventorySignature, activeSessionId])
  useEffect(() => {
    if (!automaticInventorySessionId) {
      return undefined
    }
    const timer = window.setTimeout(() => {
      const current = inventoryRequestRef.current
      if (current?.sessionId === automaticInventorySessionId) {
        return
      }
      void requestSessionInventory(automaticInventorySessionId, false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [automaticInventorySessionId, requestSessionInventory])
  useEffect(() => () => {
    inventoryRequestRef.current?.controller.abort()
    inventoryRequestRef.current = null
  }, [])
  useEffect(() => {
    if (!snippetSelectedGroupId || snippetSelectedGroupId === '__ungrouped__') return
    if (!snippetView.snippetGroups.some((group) => group.id === snippetSelectedGroupId)) {
      setSnippetSelectedGroupId('')
    }
  }, [snippetSelectedGroupId, snippetView.snippetGroups])
  const resolveSessionTitle = useCallback(
    (session: Session) => sessionTabPreferences[session.id]?.title ?? sessionTitle(session, hostView.hosts, t),
    [hostView.hosts, sessionTabPreferences, t],
  )
  const jumpToCommandSession = useCallback((sessionId: string) => {
    onSelectSession(sessionId)
    window.requestAnimationFrame(() => focusSession(sessionId))
  }, [focusSession, onSelectSession])
  const commandTaskActive = Boolean(
    commandDispatchRuntime.state.task
    && !isCommandDispatchTaskTerminal(commandDispatchRuntime.state.task.status),
  )
  const updateSessionTabPreference = useCallback(
    (sessionId: string, updater: (preference: SessionTabPreference) => SessionTabPreference) => {
      setSessionTabPreferences((current) => {
        const nextPreference = compactSessionTabPreference(updater(current[sessionId] ?? {}))
        const next = { ...current }
        if (nextPreference) {
          next[sessionId] = nextPreference
        } else {
          delete next[sessionId]
        }
        return areSessionTabPreferenceMapsEqual(current, next) ? current : next
      })
    },
    [setSessionTabPreferences],
  )
  const openRenameSession = useCallback(
    (session: Session) => {
      setRenamingSessionId(session.id)
      setRenameValue(resolveSessionTitle(session))
    },
    [resolveSessionTitle],
  )
  const saveSessionRename = useCallback(() => {
    if (!renamingSessionId) {
      return
    }
    const title = normalizeSessionTabTitle(renameValue)
    updateSessionTabPreference(renamingSessionId, (preference) => ({ ...preference, title: title || undefined }))
    setRenamingSessionId(null)
    setRenameValue('')
  }, [renameValue, renamingSessionId, updateSessionTabPreference])
  const toggleSessionPinned = useCallback(
    (sessionId: string) => {
      updateSessionTabPreference(sessionId, (preference) => (
        preference.pinned
          ? { ...preference, pinned: false, pinnedAt: undefined }
          : { ...preference, pinned: true, pinnedAt: Date.now() }
      ))
    },
    [updateSessionTabPreference],
  )
  const setSessionTabColor = useCallback(
    (sessionId: string, color: string, options?: { keepOpen?: boolean }) => {
      updateSessionTabPreference(sessionId, (preference) => ({ ...preference, color }))
      if (!options?.keepOpen) {
        setColorSessionId(null)
      }
    },
    [updateSessionTabPreference],
  )
  const resetSessionTabColor = useCallback(
    (sessionId: string) => {
      updateSessionTabPreference(sessionId, (preference) => ({ ...preference, color: undefined }))
      setColorSessionId(null)
    },
    [updateSessionTabPreference],
  )
  const resetSessionTabPreference = useCallback(
    (sessionId: string) => {
      setSessionTabPreferences((current) => {
        if (!current[sessionId]) {
          return current
        }
        const next = { ...current }
        delete next[sessionId]
        return next
      })
      if (renamingSessionId === sessionId) {
        setRenamingSessionId(null)
        setRenameValue('')
      }
      if (colorSessionId === sessionId) {
        setColorSessionId(null)
      }
    },
    [colorSessionId, renamingSessionId, setSessionTabPreferences],
  )

  const splitSessionFromMenu = useCallback(
    (sessionId: string) => {
      const result = terminalSplitRef.current?.splitSessionFromMenu(sessionId) ?? 'missing-session'
      if (result === 'limit') {
        notification.warning({
          title: t('workbench.split.limitTitle'),
          description: t('workbench.split.limitDescription'),
          duration: 3,
          role: 'status',
          className: termousNotificationClassName,
        })
      } else if (result === 'not-enough-sessions') {
        notification.warning({
          title: t('workbench.split.notEnoughSessions'),
          duration: 3,
          role: 'status',
          className: termousNotificationClassName,
        })
      } else if (result === 'missing-session') {
        notification.warning({
          title: t('workbench.split.sessionUnavailable'),
          duration: 3,
          role: 'status',
          className: termousNotificationClassName,
        })
      }
    },
    [notification, t],
  )

  const duplicateSessionFromMenu = useCallback(
    async (session: Session) => {
      if (actionBusy || session.kind !== 'ssh' || !session.host_id) {
        return
      }
      await onConnect(session.host_id)
    },
    [actionBusy, onConnect],
  )
  const connectQuickHost = useCallback(
    async (hostId: string) => {
      if (actionBusy) {
        return
      }
      setQuickConnectOpen(false)
      setQuickConnectQuery('')
      await onConnect(hostId)
    },
    [actionBusy, onConnect],
  )
  useEffect(() => {
    const sessionIds = sessionView.sessions.map((session) => session.id)
    setSessionTabPreferences((current) => {
      const pruned = pruneSessionTabPreferences(current, sessionIds)
      return areSessionTabPreferenceMapsEqual(current, pruned) ? current : pruned
    })
    if (colorSessionId && !sessionIds.includes(colorSessionId)) {
      setColorSessionId(null)
    }
    if (renamingSessionId && !sessionIds.includes(renamingSessionId)) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
  }, [colorSessionId, renamingSessionId, sessionView.sessions, setSessionTabPreferences])

  const closeTerminalSearch = useCallback(() => {
    const current = terminalSearchRef.current
    const sessionId = current.sessionId ?? activeSession?.id
    clearActiveSearch(sessionId)
    setPendingSearchRequest(null)
    commitTerminalSearch({
      ...current,
      open: false,
      sessionId: null,
      query: '',
      result: createEmptyTerminalSearchResult(),
    })
    if (sessionId) {
      window.setTimeout(() => {
        if (!terminalSearchRef.current.open) {
          focusSession(sessionId)
        }
      }, 0)
    }
  }, [activeSession?.id, clearActiveSearch, commitTerminalSearch, focusSession])

  const openTerminalSearch = useCallback((sessionId: string, initialQuery = '') => {
    const current = terminalSearchRef.current
    if (current.sessionId && current.sessionId !== sessionId) {
      clearActiveSearch(current.sessionId)
    }
    if (!initialQuery) {
      clearActiveSearch(sessionId)
    }
    const result = initialQuery
      ? searchActive(
          initialQuery,
          { caseSensitive: current.caseSensitive, regex: current.regex },
          'next',
          sessionId,
        )
      : createEmptyTerminalSearchResult()
    commitTerminalSearch({
      ...current,
      open: true,
      sessionId,
      query: initialQuery,
      result,
    })
  }, [clearActiveSearch, commitTerminalSearch, searchActive])

  const requestSessionSearch = useCallback(
    (sessionId: string, initialQuery = '') => {
      if (activeSession?.id !== sessionId) {
        setPendingSearchRequest({
          sessionId,
          sourceSessionId: activeSession?.id ?? null,
          initialQuery,
        })
        onSelectSession(sessionId)
        return
      }
      openTerminalSearch(sessionId, initialQuery)
    },
    [activeSession?.id, onSelectSession, openTerminalSearch],
  )
  const handleSessionTabMenuAction = useCallback(
    (action: SessionTabMenuAction, session: Session) => {
      if (action === 'search') {
        requestSessionSearch(session.id)
      } else if (action === 'duplicate') {
        void duplicateSessionFromMenu(session)
      } else if (action === 'split') {
        splitSessionFromMenu(session.id)
      } else if (action === 'rename') {
        openRenameSession(session)
      } else if (action === 'pin') {
        toggleSessionPinned(session.id)
      } else if (action === 'color') {
        setColorSessionId(session.id)
      } else if (action === 'reset') {
        resetSessionTabPreference(session.id)
      }
    },
    [
      duplicateSessionFromMenu,
      openRenameSession,
      requestSessionSearch,
      resetSessionTabPreference,
      splitSessionFromMenu,
      toggleSessionPinned,
    ],
  )

  const openPathInWorkbenchFiles = useCallback((session: Session, path: string) => {
    const normalizedPath = normalizeRemotePosixPath(path)
    if (
      !normalizedPath
      || session.kind !== 'ssh'
      || session.status !== 'connected'
      || !session.host_id
    ) {
      return
    }
    nextFilesPathNavigationRequestIdRef.current += 1
    setFilesPathNavigationIntent({
      requestId: nextFilesPathNavigationRequestIdRef.current,
      sourceSessionId: session.id,
      path: normalizedPath,
    })
    setDetailsActiveTab('files')
    setDetailsCollapsed(false)
    if (activeSession?.id !== session.id) {
      onSelectSession(session.id)
    }
  }, [
    activeSession?.id,
    onSelectSession,
    setDetailsActiveTab,
    setDetailsCollapsed,
  ])

  const runSearch = useCallback(
    (direction: TerminalSearchDirection) => {
      const current = terminalSearchRef.current
      if (!current.open || !current.query || current.sessionId !== activeSession?.id) {
        return
      }
      const result = searchActive(
        current.query,
        { caseSensitive: current.caseSensitive, regex: current.regex },
        direction,
        current.sessionId ?? activeSession.id,
      )
      commitTerminalSearch({ ...current, result })
    },
    [activeSession?.id, commitTerminalSearch, searchActive],
  )

  const updateSearchQuery = useCallback(
    (query: string) => {
      const current = terminalSearchRef.current
      if (query === current.query) {
        return
      }
      const next = { ...current, query }
      if (!current.open || current.sessionId !== activeSession?.id) {
        commitTerminalSearch(next)
        return
      }
      if (!query) {
        clearActiveSearch(current.sessionId ?? undefined)
        commitTerminalSearch({ ...next, result: createEmptyTerminalSearchResult() })
        return
      }
      const result = searchActive(
        query,
        { caseSensitive: current.caseSensitive, regex: current.regex },
        'next',
        current.sessionId ?? undefined,
      )
      commitTerminalSearch({ ...next, result })
    },
    [activeSession?.id, clearActiveSearch, commitTerminalSearch, searchActive],
  )

  const toggleSearchCase = useCallback(() => {
    const current = terminalSearchRef.current
    const next = { ...current, caseSensitive: !current.caseSensitive }
    if (!next.open || !next.query || next.sessionId !== activeSession?.id) {
      commitTerminalSearch(next)
      return
    }
    const result = searchActive(
      next.query,
      { caseSensitive: next.caseSensitive, regex: next.regex },
      'next',
      next.sessionId ?? undefined,
    )
    commitTerminalSearch({ ...next, result })
  }, [activeSession?.id, commitTerminalSearch, searchActive])

  const toggleSearchRegex = useCallback(() => {
    const current = terminalSearchRef.current
    const next = { ...current, regex: !current.regex }
    if (!next.open || !next.query || next.sessionId !== activeSession?.id) {
      commitTerminalSearch(next)
      return
    }
    const result = searchActive(
      next.query,
      { caseSensitive: next.caseSensitive, regex: next.regex },
      'next',
      next.sessionId ?? undefined,
    )
    commitTerminalSearch({ ...next, result })
  }, [activeSession?.id, commitTerminalSearch, searchActive])

  const updateTerminalTabDrag = useCallback((next: TerminalTabDragState | null) => {
    terminalTabDragRef.current = next
    setTerminalTabDrag(next)
  }, [])

  const beginTerminalTabDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, sessionId: string) => {
      if (event.button !== 0 || actionBusy || (event.target as Element).closest('[data-session-tab-close]')) {
        return
      }
      const start = { x: event.clientX, y: event.clientY }
      updateTerminalTabDrag({ sessionId, start, point: start, dragging: false })

      const cleanup = () => {
        delete document.body.dataset.terminalTabDragging
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('keydown', handleKeyDown)
        updateTerminalTabDrag(null)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const current = terminalTabDragRef.current
        if (!current) {
          return
        }
        const point = { x: moveEvent.clientX, y: moveEvent.clientY }
        const moved = Math.abs(point.x - current.start.x) > 8 || Math.abs(point.y - current.start.y) > 8
        const dragging = current.dragging || moved
        if (dragging) {
          moveEvent.preventDefault()
          document.body.dataset.terminalTabDragging = 'true'
        }
        updateTerminalTabDrag({ ...current, point, dragging })
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        const current = terminalTabDragRef.current
        if (current?.dragging) {
          upEvent.preventDefault()
          suppressNextTabClickRef.current = true
          terminalSplitRef.current?.dropSessionAt({ x: upEvent.clientX, y: upEvent.clientY }, current.sessionId)
          window.setTimeout(() => {
            suppressNextTabClickRef.current = false
          }, 0)
        }
        cleanup()
      }

      const handleKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === 'Escape') {
          cleanup()
        }
      }

      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', handlePointerUp, { once: true })
      window.addEventListener('keydown', handleKeyDown)
    },
    [actionBusy, updateTerminalTabDrag],
  )

  const closeSessionTab = useCallback(
    async (sessionId: string) => {
      if (actionBusy || closingSessionIdsRef.current.has(sessionId)) {
        return false
      }
      closingSessionIdsRef.current.add(sessionId)
      // 文件事件流和目录请求必须先停，再删除后端会话，避免关闭期间重新访问已释放资源。
      flushSync(() => {
        setClosingSessionIds(new Set(closingSessionIdsRef.current))
      })
      if (terminalSearch.sessionId === sessionId) {
        closeTerminalSearch()
      }
      if (colorSessionId === sessionId) {
        setColorSessionId(null)
      }
      try {
        return await onDisconnect(sessionId)
      } finally {
        closingSessionIdsRef.current.delete(sessionId)
        setClosingSessionIds(new Set(closingSessionIdsRef.current))
      }
    },
    [actionBusy, closeTerminalSearch, colorSessionId, onDisconnect, terminalSearch.sessionId],
  )

  const closeSessionFromTab = useCallback(
    (event: MouseEvent<HTMLElement>, sessionId: string) => {
      if (event.button !== 1) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void closeSessionTab(sessionId)
    },
    [closeSessionTab],
  )

  const resolveSnippetCommand = useCallback(
    async (snippet: CodeSnippet) => {
      const variables = extractSnippetVariables(snippet.command)
      if (variables.length === 0) {
        return snippet.command
      }
      const values = Object.fromEntries(variables.map((variable) => [variable, '']))
      return new Promise<string | null>((resolve) => {
        modal.confirm({
          title: t('snippets.variablesTitle'),
          okText: t('app.confirm'),
          cancelText: t('app.cancel'),
          centered: true,
          className: 'termous-modal',
          rootClassName: snippetStyles['snippet-dialog-root'],
          content: (
            <SnippetVariablePrompt
              variables={variables}
              onChange={(name, value) => {
                values[name] = value
              }}
            />
          ),
          onOk: () => {
            resolve(renderSnippetCommand(snippet.command, values))
          },
          onCancel: () => resolve(null),
        })
      })
    },
    [modal, t],
  )

  const confirmRiskySnippet = useCallback(
    async (snippet: CodeSnippet, command: string) => {
      const risk = analyzeSnippetRisk(command)
      if (!risk.risky) {
        return true
      }
      return new Promise<boolean>((resolve) => {
        modal.confirm({
          title: t('snippets.riskConfirmTitle'),
          okText: t('snippets.sendAnyway'),
          cancelText: t('app.cancel'),
          okButtonProps: { danger: true },
          centered: true,
          className: 'termous-modal',
          rootClassName: snippetStyles['snippet-dialog-root'],
          content: <SnippetRiskDialog snippet={snippet} reasons={risk.reasons} />,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
    },
    [modal, t],
  )

  const sendSnippet = useCallback(
    async (snippet: CodeSnippet, execute: boolean) => {
      if (!activeSession?.id || !canSendSnippet) {
        notification.warning({
          title: t('snippets.noActiveSession'),
          duration: 3,
          role: 'status',
          className: termousNotificationClassName,
        })
        return
      }
      const command = await resolveSnippetCommand(snippet)
      if (!command) {
        return
      }
      if (execute && !(await confirmRiskySnippet(snippet, command))) {
        return
      }
      const result = sendTextToSession(activeSession.id, command, { execute })
      if (result !== 'sent') {
        notification.error({
          title: t('snippets.sendFailed'),
          description: t(`snippets.sendResult.${result}`),
          duration: 4,
          role: 'alert',
          className: termousNotificationClassName,
        })
        return
      }
      await onSnippetUsed(snippet.id)
      notification.success({
        title: execute ? t('snippets.sent') : t('snippets.inserted'),
        duration: 2,
        role: 'status',
        className: termousNotificationClassName,
      })
    },
    [
      activeSession?.id,
      canSendSnippet,
      confirmRiskySnippet,
      notification,
      onSnippetUsed,
      resolveSnippetCommand,
      sendTextToSession,
      t,
    ],
  )

  const reconnectActiveSession = useCallback(async () => {
    if (!activeSession?.host_id || actionBusy) {
      return
    }
    const previousSessionId = activeSession.id
    const hostId = activeSession.host_id
    if (!await closeSessionTab(previousSessionId)) {
      return
    }
    await onConnect(hostId)
  }, [actionBusy, activeSession?.host_id, activeSession?.id, closeSessionTab, onConnect])

  const reconnectSession = useCallback(
    async (session: Session) => {
      if (!session.host_id || actionBusy) {
        return
      }
      if (!await closeSessionTab(session.id)) {
        return
      }
      await onConnect(session.host_id)
    },
    [actionBusy, closeSessionTab, onConnect],
  )

  useEffect(() => {
    if (activeSession) {
      setTerminalSize({ cols: activeSession.pty_cols, rows: activeSession.pty_rows })
    }
  }, [activeSession])

  useEffect(() => {
    const currentSessionIds = new Set(sessionView.sessions.map((session) => session.id))
    const clearReadyState = (sessionId: string) => {
      const timer = recentConnectionTimersRef.current.get(sessionId)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        recentConnectionTimersRef.current.delete(sessionId)
      }
      setRecentlyConnectedSessionIds((current) => {
        if (!current.has(sessionId)) {
          return current
        }
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
    }

    for (const session of sessionView.sessions) {
      const previousStatus = previousSessionStatusRef.current.get(session.id)
      previousSessionStatusRef.current.set(session.id, session.status)
      if (session.status === 'disconnected' || session.status === 'failed') {
        clearReadyState(session.id)
        continue
      }
      if (previousStatus !== 'connecting' || session.status !== 'connected') {
        continue
      }

      const existingTimer = recentConnectionTimersRef.current.get(session.id)
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer)
      }
      setRecentlyConnectedSessionIds((current) => {
        const next = new Set(current)
        next.add(session.id)
        return next
      })
      const timer = window.setTimeout(() => {
        recentConnectionTimersRef.current.delete(session.id)
        setRecentlyConnectedSessionIds((current) => {
          if (!current.has(session.id)) {
            return current
          }
          const next = new Set(current)
          next.delete(session.id)
          return next
        })
      }, 900)
      recentConnectionTimersRef.current.set(session.id, timer)
    }

    for (const sessionId of Array.from(previousSessionStatusRef.current.keys())) {
      if (!currentSessionIds.has(sessionId)) {
        previousSessionStatusRef.current.delete(sessionId)
        clearReadyState(sessionId)
      }
    }
  }, [sessionView.sessions])

  useEffect(() => {
    const timers = recentConnectionTimersRef.current
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  useEffect(() => {
    if (!pendingSearchRequest) {
      return
    }
    if (!sessionView.sessions.some((session) => session.id === pendingSearchRequest.sessionId)) {
      setPendingSearchRequest(null)
      return
    }
    const activeSessionId = activeSession?.id ?? null
    if (activeSessionId === pendingSearchRequest.sessionId) {
      openTerminalSearch(pendingSearchRequest.sessionId, pendingSearchRequest.initialQuery)
      setPendingSearchRequest(null)
      return
    }
    if (activeSessionId !== pendingSearchRequest.sourceSessionId) {
      setPendingSearchRequest(null)
    }
  }, [activeSession?.id, openTerminalSearch, pendingSearchRequest, sessionView.sessions])

  useEffect(() => {
    if (!filesPathNavigationIntent) {
      activatedFilesPathNavigationRequestIdRef.current = null
      return
    }
    const sourceSession = sessionView.sessions.find(
      (session) => session.id === filesPathNavigationIntent.sourceSessionId,
    )
    if (
      !sourceSession
      || sourceSession.kind !== 'ssh'
      || sourceSession.status !== 'connected'
    ) {
      setFilesPathNavigationIntent(null)
    }
  }, [filesPathNavigationIntent, sessionView.sessions])

  useEffect(() => {
    if (!filesPathNavigationIntent) {
      activatedFilesPathNavigationRequestIdRef.current = null
      return
    }
    if (
      activatedFilesPathNavigationRequestIdRef.current !== null
      && activatedFilesPathNavigationRequestIdRef.current !== filesPathNavigationIntent.requestId
    ) {
      activatedFilesPathNavigationRequestIdRef.current = null
    }
    const targetContextActive = Boolean(
      active
      && activeSession?.id === filesPathNavigationIntent.sourceSessionId
      && detailsActiveTab === 'files'
      && !detailsCollapsed
    )
    if (targetContextActive) {
      activatedFilesPathNavigationRequestIdRef.current = filesPathNavigationIntent.requestId
      return
    }
    if (activatedFilesPathNavigationRequestIdRef.current === filesPathNavigationIntent.requestId) {
      activatedFilesPathNavigationRequestIdRef.current = null
      setFilesPathNavigationIntent(null)
    }
  }, [
    active,
    activeSession?.id,
    detailsActiveTab,
    detailsCollapsed,
    filesPathNavigationIntent,
  ])

  useEffect(() => {
    if (!terminalSearch.open || !terminalSearch.sessionId || pendingSearchRequest) {
      return
    }
    if (activeSession?.id && terminalSearch.sessionId !== activeSession.id) {
      closeTerminalSearch()
    }
  }, [activeSession?.id, closeTerminalSearch, pendingSearchRequest, terminalSearch.open, terminalSearch.sessionId])

  useEffect(() => {
    if (activeSession?.status !== 'connected') {
      return undefined
    }
    setDurationNow(Date.now())
    const timer = window.setInterval(() => setDurationNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeSession?.id, activeSession?.status])

  return (
    <>
      <section
        ref={workbenchGridRef}
        className={[
          pageStyles['page-grid'],
          pageStyles['workbench-grid'],
          detailsCollapsed ? pageStyles['is-details-collapsed'] : '',
        ].filter(Boolean).join(' ')}
        style={workbenchGridStyle}
      >
        <WorkbenchTerminalPanel
          commandDock={(
            <CommandDispatchDock
              sessions={sessionView.sessions}
              hosts={hostView.hosts}
              activeSession={activeSession}
              terminalSettings={sessionView.terminalSettings}
              theme={theme}
              resolveSessionTitle={resolveSessionTitle}
              onJumpToSession={jumpToCommandSession}
            />
          )}
          commandDockOpen={commandDockOpen}
          commandDockHeight={commandDockHeight}
          commandTaskActive={commandTaskActive}
          commandTargetCount={commandDispatchRuntime.state.task?.total_targets ?? 0}
          sessionTabs={(
            <WorkbenchSessionTabs
              sessions={visibleSessions}
              hosts={hostView.hosts}
              activeSessionId={activeSession?.id}
              actionBusy={actionBusy}
              preferences={sessionTabPreferences}
              closingSessionIds={closingSessionIds}
              colorSessionId={colorSessionId}
              draggingSessionId={terminalTabDrag?.dragging ? terminalTabDrag.sessionId : null}
              quickConnectOpen={quickConnectOpen}
              quickConnectQuery={quickConnectQuery}
              suppressNextClickRef={suppressNextTabClickRef}
              getHostIconUrl={getHostIconUrl}
              resolveTitle={resolveSessionTitle}
              onQuickConnectOpenChange={setQuickConnectOpen}
              onQuickConnectQueryChange={setQuickConnectQuery}
              onQuickConnect={connectQuickHost}
              onMenuAction={handleSessionTabMenuAction}
              onColorPopoverOpenChange={(sessionId, open) => {
                if (!open && colorSessionId === sessionId) {
                  setColorSessionId(null)
                }
              }}
              onColorSelect={setSessionTabColor}
              onColorReset={resetSessionTabColor}
              onSelectSession={onSelectSession}
              onBeginDrag={beginTerminalTabDrag}
              onAuxClose={closeSessionFromTab}
              onClose={closeSessionTab}
            />
          )}
          sessions={visibleSessions}
          activeSession={activeSession}
          workspaceActive={active}
          themeMode={terminalThemeMode}
          terminalSplitRef={terminalSplitRef}
          sessionBadgeStatus={sessionBadgeStatus}
          sessionStatusLabel={sessionStatusLabel}
          hasConnectionProgress={hasConnectionProgress}
          showRecentConnectionProgress={showRecentConnectionProgress}
          selectedHostAvailable={Boolean(selectedHost)}
          actionBusy={actionBusy}
          dragSessionId={terminalTabDrag?.dragging ? terminalTabDrag.sessionId : null}
          dragPoint={terminalTabDrag?.dragging ? terminalTabDrag.point : null}
          search={terminalSearch}
          sessionPositionLabel={sessionPositionLabel}
          targetLabel={targetLabel}
          sessionStateLabel={sessionStateLabel}
          startedAt={startedAt}
          sessionDuration={sessionDuration}
          terminalSize={terminalSize}
          onOpenConnectionLauncher={onOpenConnectionLauncher}
          onSearchQueryChange={updateSearchQuery}
          onSearchPrevious={() => runSearch('previous')}
          onSearchNext={() => runSearch('next')}
          onToggleSearchCase={toggleSearchCase}
          onToggleSearchRegex={toggleSearchRegex}
          onCloseSearch={closeTerminalSearch}
          onSelectSession={onSelectSession}
          onResize={handleTerminalResize}
          onReconnectSession={reconnectSession}
          onSearchSession={requestSessionSearch}
          onOpenFilesAtPath={openPathInWorkbenchFiles}
          onCloseSession={closeSessionTab}
          onCommandDockHeightChange={setCommandDockHeight}
          onToggleCommandDock={() => setCommandDockOpen((current) => !current)}
        />

      <WorkbenchDetailsPanel
        activeKey={detailsActiveTab}
        collapsed={detailsCollapsed}
        resizing={detailsPanelResize.resizing}
        onActiveKeyChange={setDetailsActiveTab}
        onCollapsedChange={setDetailsCollapsed}
        onResizePointerDown={detailsPanelResize.beginResize}
        panels={{
          overview: (
              <WorkbenchConnectionOverview
                data={hostView}
                session={activeSession}
                actionBusy={actionBusy}
                sessionClosing={activeSessionClosing}
                sessionBadgeStatus={sessionBadgeStatus}
                sessionStatusLabel={sessionStatusLabel}
                sessionStateLabel={sessionStateLabel}
                getHostIconUrl={getHostIconUrl}
                onOpenFiles={onOpenFiles}
                onReconnect={reconnectActiveSession}
                onClose={closeSessionTab}
              />
          ),
          files: (
              <WorkbenchFilesPanel
                api={fileGateway}
                data={workbenchFilesData}
                fileSessionClosures={fileSessionClosures}
                session={activeSession}
                enabled={active && detailsActiveTab === 'files' && !detailsCollapsed}
                actionBusy={actionBusy}
                closingSessionIds={closingSessionIds}
                theme={theme}
                onOpenFull={onOpenFiles}
                onManageBookmarks={onManageBookmarks}
                onConnectFileSession={onConnectFileSession}
                onReconnectSession={reconnectSession}
                onReconnectFileSession={onReconnectFileSession}
                onUpdateFileSession={onUpdateFileSession}
                onCreateFileBookmark={onCreateFileBookmark}
                onUpdateFileBookmark={onUpdateFileBookmark}
                pathNavigationIntent={filesPathNavigationIntent}
                onConsumePathNavigationIntent={(requestId) => {
                  setFilesPathNavigationIntent((current) => (
                    current?.requestId === requestId ? null : current
                  ))
                }}
              />
          ),
          system: (
              <WorkbenchSystemInfoPanel
                session={activeSession}
                t={t}
                requesting={currentInventoryRequestView.loading}
                requestError={currentInventoryRequestView.error}
                onRetry={() => {
                  if (activeSessionId && (
                    canRetrySessionInventory(activeSession) || currentInventoryRequestView.error
                  )) {
                    void requestSessionInventory(activeSessionId, true)
                  }
                }}
              />
          ),
          monitor: (
              <SystemMonitorPanel
                api={observabilityGateway}
                session={activeSession}
                enabled={active && detailsActiveTab === 'monitor' && !detailsCollapsed}
                theme={theme}
                inventoryRequesting={currentInventoryRequestView.loading}
                inventoryRequestError={currentInventoryRequestView.error}
                onRetryInventory={() => {
                  if (activeSessionId && (
                    canRetrySessionInventory(activeSession) || currentInventoryRequestView.error
                  )) {
                    void requestSessionInventory(activeSessionId, true)
                  }
                }}
              />
          ),
          processes: <ProcessPanel api={observabilityGateway} session={activeSession} enabled={active && detailsActiveTab === 'processes' && !detailsCollapsed} />,
          services: <ServicePanel api={serviceGateway} session={activeSession} enabled={active && detailsActiveTab === 'services' && !detailsCollapsed} />,
          crontab: <CrontabPanel api={crontabGateway} session={activeSession} enabled={active && detailsActiveTab === 'crontab' && !detailsCollapsed} theme={theme} />,
          docker: <DockerPanel api={dockerGateway} session={activeSession} enabled={active && detailsActiveTab === 'docker' && !detailsCollapsed} />,
          firewall: (
              <FirewallPanel
                api={firewallGateway}
                session={activeSession}
                host={sessionHost}
                enabled={active && detailsActiveTab === 'firewall' && !detailsCollapsed}
              />
          ),
          forwards: (
              <ForwardSessionPanel
                session={activeSession}
                host={sessionHost}
                forwards={forwards}
                enabled={active && detailsActiveTab === 'forwards' && !detailsCollapsed}
                actionBusy={actionBusy}
                onStartForward={onStartForward}
                onRestartForward={onRestartForward}
                onStopForward={onStopForward}
              />
          ),
          aliases: (
              <AliasPanel
                api={aliasGateway}
                getHostIconUrl={getHostIconUrl}
                session={activeSession}
                sessionIds={aliasSessionIds}
                hosts={hostView.hosts}
                groups={hostView.groups}
                credentials={hostView.credentials}
                reachability={hostView.hostReachability}
                enabled={active && detailsActiveTab === 'aliases' && !detailsCollapsed}
                reconnectDisabled={actionBusy}
                onReconnectSession={reconnectSession}
              />
          ),
          snippets: (
              <WorkbenchSnippetPanel
                filter={snippetFilter}
                query={snippetQuery}
                selectedTags={snippetSelectedTags}
                groups={snippetView.snippetGroups}
                selectedGroupId={snippetSelectedGroupId}
                availableTags={snippetTags}
                filteredSnippets={filteredSnippets}
                totalCount={snippetView.snippets.length}
                groupedSnippets={groupedFilteredSnippets}
                collapsedGroupIds={collapsedSnippetGroups}
                actionBusy={actionBusy}
                canSendSnippet={canSendSnippet}
                onFilterChange={setSnippetFilter}
                onQueryChange={setSnippetQuery}
                onSelectedTagsChange={setSnippetSelectedTags}
                onSelectedGroupChange={setSnippetSelectedGroupId}
                onClear={() => {
                  setSnippetFilter('all')
                  setSnippetQuery('')
                  setSnippetSelectedTags([])
                  setSnippetSelectedGroupId('')
                }}
                onToggleGroup={toggleSnippetGroup}
                onToggleFavorite={onToggleSnippetFavorite}
                onSendSnippet={sendSnippet}
              />
          ),
        }}
      />
      </section>
      <Modal
        open={Boolean(renamingSessionId)}
        title={t('terminal.tabMenu.renameTitle')}
        okText={t('app.confirm')}
        cancelText={t('app.cancel')}
        centered
        className="termous-modal"
        onOk={saveSessionRename}
        onCancel={() => {
          setRenamingSessionId(null)
          setRenameValue('')
        }}
      >
        <Input
          id="workbench-session-rename"
          name="workbench-session-rename"
          value={renameValue}
          maxLength={80}
          autoFocus
          placeholder={t('terminal.tabMenu.renamePlaceholder')}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={saveSessionRename}
        />
      </Modal>
    </>
  )
}

function sessionTitle(session: Session, hosts: Host[], t: (key: string) => string) {
  if (session.kind === 'local') {
    return `${t('workbench.localTerminal')} ${shortId(session.id)}`
  }
  const host = session.host_id ? hosts.find((item) => item.id === session.host_id) : undefined
  return host?.name ?? shortId(session.id)
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8) : id
}

function formatSessionDuration(session: Session | null, now: number, fallback: string) {
  if (!session) {
    return fallback
  }
  const start = Date.parse(session.connected_at ?? session.started_at)
  if (Number.isNaN(start)) {
    return fallback
  }
  const end = session.status === 'connected' ? now : Date.parse(session.ended_at ?? session.connected_at ?? session.started_at)
  if (Number.isNaN(end) || end < start) {
    return fallback
  }
  const totalSeconds = Math.floor((end - start) / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const clock = `${padDurationPart(hours)}:${padDurationPart(minutes)}:${padDurationPart(seconds)}`
  return days > 0 ? `${days}d ${clock}` : clock
}

function normalizeSessionBadgeStatus(status: string): 'connecting' | 'connected' | 'disconnected' | 'failed' {
  if (status === 'waiting_host_trust') {
    return 'connecting'
  }
  if (status === 'connecting' || status === 'connected' || status === 'failed') {
    return status
  }
  return 'disconnected'
}

function padDurationPart(value: number) {
  return String(value).padStart(2, '0')
}

function shouldIgnoreInventoryRequestError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = (error as { code?: string }).code
  return code === 'REQUEST_ABORTED' || code === 'REQUEST_SUPERSEDED'
}

function sessionInventoryViewSignature(session: Session | null) {
  return [
    session?.inventory_status ?? 'idle',
    session?.inventory_message ?? '',
    session?.linux_system_info?.collected_at ?? '',
  ].join('\u0000')
}

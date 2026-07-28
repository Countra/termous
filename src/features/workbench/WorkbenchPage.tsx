import {
  Activity,
  Boxes,
  Cable,
  ChevronDown,
  ChevronRight,
  Code2,
  Clock3,
  CopyPlus,
  Cpu,
  HardDrive,
  Layers,
  Monitor,
  Network as NetworkIcon,
  FolderOpen,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Power,
  Play,
  RotateCcw,
  Search,
  Send,
  Server,
  Shield,
  SquareTerminal,
  Star,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { App as AntdApp, Button, Dropdown, Input, Modal, Popover, Skeleton, Tooltip, type MenuProps } from 'antd'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { HostAvatar } from '../../components/hosts/HostAvatar'
import { SessionQuickConnect } from '../../components/hosts/SessionQuickConnect'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { FeatureSidePanel } from '../../components/ui/FeatureSidePanel'
import { SessionTabButton } from '../../components/ui/SessionTabButton'
import { SessionTabStrip } from '../../components/ui/SessionTabStrip'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { usePersistentBooleanState } from '../../hooks/usePersistentBooleanState'
import { usePersistentJsonState } from '../../hooks/usePersistentJsonState'
import { useRafResizablePanelWidth } from '../../hooks/useRafResizablePanelWidth'
import { ConnectionProgress } from '../terminal/ConnectionProgress'
import { TerminalSearchPanel } from '../terminal/TerminalSearchPanel'
import { TerminalSplitWorkspace, type TerminalDragPoint, type TerminalSplitWorkspaceHandle } from '../terminal/TerminalSplitWorkspace'
import { useTerminalRuntime } from '../terminal/terminalRuntimeContext'
import type { TerminalSearchDirection, TerminalSearchResult } from '../terminal/terminalRuntimeContext'
import type { AppData, CodeSnippet, FileBookmark, FileBookmarkInput, FileSession, ForwardInstance, ForwardStartRequest, Host, Session, ThemeMode } from '../../types/domain'
import type { FileSessionClosureState } from '../files/fileSessionRecovery'
import { SnippetFilterBar, SnippetList } from '../snippets/SnippetCatalog'
import {
  buildSnippetTags,
  filterSnippets,
  type SnippetCatalogFilter,
} from '../snippets/snippetCatalogUtils'
import { analyzeSnippetRisk, extractSnippetVariables, renderSnippetCommand } from '../snippets/snippetUtils'
import { ForwardSessionPanel } from '../forwards/ForwardSessionPanel'
import { FirewallPanel } from './FirewallPanel'
import { SessionTabColorPanel } from './SessionTabColorPanel'
import { DockerPanel } from './DockerPanel'
import { ProcessPanel } from './ProcessPanel'
import { ServicePanel } from './ServicePanel'
import { SystemMonitorPanel } from './SystemMonitorPanel'
import { WorkbenchEmptyState } from './WorkbenchEmptyState'
import { WorkbenchFilesPanel } from './WorkbenchFilesPanel'
import {
  canRetrySessionInventory,
  getAutomaticSessionInventoryDemand,
  getSessionInventoryVisibleScope,
  isSessionInventoryRequestCurrent,
  type SessionInventoryRequestIdentity,
} from './sessionInventoryDemand'
import {
  areSessionTabPreferenceMapsEqual,
  compactSessionTabPreference,
  normalizeSessionTabTitle,
  parseSessionTabPreferences,
  pruneSessionTabPreferences,
  sortSessionsForTabs,
  type SessionTabPreference,
  type SessionTabPreferenceMap,
} from './sessionTabPreferences'

type DetailsTabKey = 'overview' | 'files' | 'system' | 'monitor' | 'processes' | 'services' | 'docker' | 'firewall' | 'forwards' | 'snippets'

const workbenchDetailsPanelWidth = {
  default: 300,
  min: 260,
  max: 420,
}

interface TerminalSearchState {
  open: boolean
  sessionId: string | null
  query: string
  caseSensitive: boolean
  regex: boolean
  result: TerminalSearchResult
}

interface TerminalTabDragState {
  sessionId: string
  start: TerminalDragPoint
  point: TerminalDragPoint
  dragging: boolean
}

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

interface WorkbenchPageProps {
  api: TermousApi
  data: AppData
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
  onStopForward: (id: string) => Promise<void>
}

export function WorkbenchPage({
  api,
  data,
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
  onStopForward,
}: WorkbenchPageProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const { searchActive, clearActiveSearch, sendTextToSession } = useTerminalRuntime()
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
  const [pendingSearchSessionId, setPendingSearchSessionId] = useState<string | null>(null)
  const [terminalTabDrag, setTerminalTabDrag] = useState<TerminalTabDragState | null>(null)
  const [snippetFilter, setSnippetFilter] = useState<SnippetCatalogFilter>('all')
  const [snippetQuery, setSnippetQuery] = useState('')
  const [snippetSelectedTags, setSnippetSelectedTags] = useState<string[]>([])
  const [snippetSelectedGroupId, setSnippetSelectedGroupId] = useState('')
  const [collapsedSnippetGroups, setCollapsedSnippetGroups] = useState<Set<string>>(() => new Set())
  const [terminalSearch, setTerminalSearch] = useState<TerminalSearchState>({
    open: false,
    sessionId: null,
    query: '',
    caseSensitive: false,
    regex: false,
    result: emptyTerminalSearchResult(),
  })
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
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
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
  const sessionHost = activeSession?.host_id ? data.hosts.find((host) => host.id === activeSession.host_id) : undefined
  const detailHost = activeSession?.kind === 'ssh' ? sessionHost : undefined
  const detailCredential = data.credentials.find((item) => item.id === detailHost?.credential_id)
  const detailGroup = data.groups.find((group) => group.id === detailHost?.group_id)
  const detailJumpHost = data.hosts.find((host) => host.id === detailHost?.jump_host_id)
  const detailProxy = data.proxies.find((proxy) => (
    proxy.id === activeSession?.proxy_id
  ))
  const detailTags = detailHost?.tags ?? []
  const detailCredentialLabel = detailCredential
    ? `${detailCredential.name} (${t(`vault.typeName.${detailCredential.type}`)})`
    : t('fields.none')
  const visibleSessions = useMemo(
    () => sortSessionsForTabs(data.sessions, sessionTabPreferences),
    [data.sessions, sessionTabPreferences],
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
  const startedAt = activeSession?.started_at ? formatTime(activeSession.started_at) : t('fields.none')
  const sessionDuration = formatSessionDuration(activeSession, durationNow, t('fields.none'))
  const terminalThemeMode = data.settings.terminal.theme_mode === 'follow_app' ? theme : data.settings.terminal.theme_mode
  const activeSessionEnded = activeSession?.status === 'disconnected' || activeSession?.status === 'failed'
  const canOpenFiles = Boolean(activeSession?.kind === 'ssh' && activeSession.status === 'connected' && activeSession.host_id)
  const canSendSnippet = Boolean(activeSession?.kind === 'ssh' && activeSession.status === 'connected')
  const canReconnectSession = Boolean(activeSession?.kind === 'ssh' && activeSession.host_id && activeSessionEnded)
  const snippetTags = useMemo(() => buildSnippetTags(data.snippets), [data.snippets])
  const filteredSnippets = useMemo(
    () => filterSnippets(data.snippets, {
      filter: snippetFilter,
      query: snippetQuery,
      selectedTags: snippetSelectedTags,
      groupId: snippetSelectedGroupId,
    }),
    [data.snippets, snippetFilter, snippetQuery, snippetSelectedGroupId, snippetSelectedTags],
  )
  const groupedFilteredSnippets = useMemo(() => {
    const snippetsByGroup = new Map(data.snippetGroups.map((group) => [group.id, [] as CodeSnippet[]]))
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
      ...data.snippetGroups.map((group) => ({
        id: group.id,
        name: group.name,
        snippets: snippetsByGroup.get(group.id) ?? [],
      })),
      { id: '__ungrouped__', name: t('snippets.ungrouped'), snippets: ungrouped },
    ].filter((group) => group.snippets.length > 0)
  }, [data.snippetGroups, filteredSnippets, t])
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
    if (!data.snippetGroups.some((group) => group.id === snippetSelectedGroupId)) {
      setSnippetSelectedGroupId('')
    }
  }, [data.snippetGroups, snippetSelectedGroupId])
  const resolveSessionTitle = useCallback(
    (session: Session) => sessionTabPreferences[session.id]?.title ?? sessionTitle(session, data.hosts, t),
    [data.hosts, sessionTabPreferences, t],
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
          className: 'termous-notification',
        })
      } else if (result === 'not-enough-sessions') {
        notification.warning({
          title: t('workbench.split.notEnoughSessions'),
          duration: 3,
          role: 'status',
          className: 'termous-notification',
        })
      } else if (result === 'missing-session') {
        notification.warning({
          title: t('workbench.split.sessionUnavailable'),
          duration: 3,
          role: 'status',
          className: 'termous-notification',
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
  const buildSessionTabMenuItems = useCallback(
    (session: Session): MenuProps['items'] => {
      const preference = sessionTabPreferences[session.id]
      const pinned = Boolean(preference?.pinned)
      const canDuplicateSession = session.kind === 'ssh' && Boolean(session.host_id)
      return [
        {
          key: 'search',
          label: <TerminalTabMenuItem icon={<Search size={15} />} title={t('terminal.search')} />,
        },
        {
          key: 'duplicate',
          disabled: !canDuplicateSession || actionBusy,
          label: <TerminalTabMenuItem icon={<CopyPlus size={15} />} title={t('terminal.tabMenu.duplicate')} />,
        },
        {
          key: 'split',
          label: <TerminalTabMenuItem icon={<Layers size={15} />} title={t('terminal.tabMenu.split')} />,
        },
        {
          key: 'rename',
          label: <TerminalTabMenuItem icon={<Pencil size={15} />} title={t('terminal.tabMenu.rename')} />,
        },
        {
          key: 'pin',
          label: (
            <TerminalTabMenuItem
              icon={pinned ? <PinOff size={15} /> : <Pin size={15} />}
              title={pinned ? t('terminal.tabMenu.unpin') : t('terminal.tabMenu.pin')}
            />
          ),
        },
        {
          key: 'color',
          label: <TerminalTabMenuItem icon={<Palette size={15} />} title={t('terminal.tabMenu.color')} />,
        },
        {
          key: 'reset',
          disabled: !preference,
          label: <TerminalTabMenuItem icon={<RotateCcw size={15} />} title={t('terminal.tabMenu.reset')} />,
        },
      ]
    },
    [actionBusy, sessionTabPreferences, t],
  )

  useEffect(() => {
    const sessionIds = data.sessions.map((session) => session.id)
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
  }, [colorSessionId, data.sessions, renamingSessionId, setSessionTabPreferences])

  const closeTerminalSearch = useCallback(() => {
    clearActiveSearch(terminalSearch.sessionId ?? activeSession?.id)
    setPendingSearchSessionId(null)
    setTerminalSearch((current) => ({
      ...current,
      open: false,
      sessionId: null,
      query: '',
      result: emptyTerminalSearchResult(),
    }))
  }, [activeSession?.id, clearActiveSearch, terminalSearch.sessionId])

  const openTerminalSearch = useCallback((sessionId: string) => {
    setTerminalSearch((current) => ({
      ...current,
      open: true,
      sessionId,
      result: emptyTerminalSearchResult(),
    }))
  }, [])

  const requestSessionSearch = useCallback(
    (sessionId: string) => {
      if (activeSession?.id !== sessionId) {
        setPendingSearchSessionId(sessionId)
        onSelectSession(sessionId)
        return
      }
      openTerminalSearch(sessionId)
    },
    [activeSession?.id, onSelectSession, openTerminalSearch],
  )

  const runSearch = useCallback(
    (direction: TerminalSearchDirection) => {
      setTerminalSearch((current) => {
        if (!current.open || !current.query || current.sessionId !== activeSession?.id) {
          return current
        }
        const result = searchActive(
          current.query,
          { caseSensitive: current.caseSensitive, regex: current.regex },
          direction,
          current.sessionId ?? activeSession.id,
        )
        return { ...current, result }
      })
    },
    [activeSession?.id, searchActive],
  )

  const updateSearchQuery = useCallback(
    (query: string) => {
      setTerminalSearch((current) => {
        if (query === current.query) {
          return current
        }
        const next = { ...current, query }
        if (!current.open || current.sessionId !== activeSession?.id) {
          return next
        }
        if (!query) {
          clearActiveSearch(current.sessionId ?? undefined)
          return { ...next, result: emptyTerminalSearchResult() }
        }
        const result = searchActive(
          query,
          { caseSensitive: current.caseSensitive, regex: current.regex },
          'next',
          current.sessionId ?? undefined,
        )
        return { ...next, result }
      })
    },
    [activeSession?.id, clearActiveSearch, searchActive],
  )

  const toggleSearchCase = useCallback(() => {
    setTerminalSearch((current) => {
      const next = { ...current, caseSensitive: !current.caseSensitive }
      if (!next.open || !next.query || next.sessionId !== activeSession?.id) {
        return next
      }
      const result = searchActive(
        next.query,
        { caseSensitive: next.caseSensitive, regex: next.regex },
        'next',
        next.sessionId ?? undefined,
      )
      return { ...next, result }
    })
  }, [activeSession?.id, searchActive])

  const toggleSearchRegex = useCallback(() => {
    setTerminalSearch((current) => {
      const next = { ...current, regex: !current.regex }
      if (!next.open || !next.query || next.sessionId !== activeSession?.id) {
        return next
      }
      const result = searchActive(
        next.query,
        { caseSensitive: next.caseSensitive, regex: next.regex },
        'next',
        next.sessionId ?? undefined,
      )
      return { ...next, result }
    })
  }, [activeSession?.id, searchActive])

  const updateTerminalTabDrag = useCallback((next: TerminalTabDragState | null) => {
    terminalTabDragRef.current = next
    setTerminalTabDrag(next)
  }, [])

  const beginTerminalTabDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, sessionId: string) => {
      if (event.button !== 0 || actionBusy || (event.target as Element).closest('.session-tab-close')) {
        return
      }
      const start = { x: event.clientX, y: event.clientY }
      updateTerminalTabDrag({ sessionId, start, point: start, dragging: false })

      const cleanup = () => {
        document.body.classList.remove('is-terminal-tab-dragging')
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
          document.body.classList.add('is-terminal-tab-dragging')
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
          className: 'termous-notification',
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
          className: 'termous-notification',
        })
        return
      }
      await onSnippetUsed(snippet.id)
      notification.success({
        title: execute ? t('snippets.sent') : t('snippets.inserted'),
        duration: 2,
        role: 'status',
        className: 'termous-notification',
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
    const currentSessionIds = new Set(data.sessions.map((session) => session.id))
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

    for (const session of data.sessions) {
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
  }, [data.sessions])

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
    if (!pendingSearchSessionId || activeSession?.id !== pendingSearchSessionId) {
      return
    }
    openTerminalSearch(pendingSearchSessionId)
    setPendingSearchSessionId(null)
  }, [activeSession?.id, openTerminalSearch, pendingSearchSessionId])

  useEffect(() => {
    if (!terminalSearch.open || !terminalSearch.sessionId || pendingSearchSessionId) {
      return
    }
    if (activeSession?.id && terminalSearch.sessionId !== activeSession.id) {
      closeTerminalSearch()
    }
  }, [activeSession?.id, closeTerminalSearch, pendingSearchSessionId, terminalSearch.open, terminalSearch.sessionId])

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
        className={`page-grid workbench-grid ${detailsCollapsed ? 'is-details-collapsed' : ''}`}
        style={workbenchGridStyle}
      >
        <div className="terminal-workspace">
          <div className="terminal-card">
            <div className="terminal-toolbar">
              <SessionTabStrip
                ariaLabel={t('workbench.terminal')}
                activeId={activeSession?.id}
                contentKey={visibleSessions.map((session) => session.id).join('|')}
                scrollLeftLabel={t('workbench.scrollTabsLeft')}
                scrollRightLabel={t('workbench.scrollTabsRight')}
                tabsClassName="terminal-tabs"
                trailing={(
                  <SessionQuickConnect
                    hosts={data.hosts}
                    actionBusy={actionBusy}
                    triggerLabel={t('workbench.quickConnect.trigger')}
                    open={quickConnectOpen}
                    query={quickConnectQuery}
                    onOpenChange={setQuickConnectOpen}
                    onQueryChange={setQuickConnectQuery}
                    onConnect={connectQuickHost}
                    getHostIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
                  />
                )}
              >
                {visibleSessions.length === 0 ? (
                  <SessionTabButton empty icon={<SquareTerminal size={18} />} label={t('workbench.noSession')} />
                ) : (
                  visibleSessions.map((session) => {
                    const preference = sessionTabPreferences[session.id]
                    const title = resolveSessionTitle(session)
                    const sessionClosing = closingSessionIds.has(session.id)
                    return (
                      <Dropdown
                        key={session.id}
                        disabled={sessionClosing}
                        trigger={['contextMenu']}
                        classNames={{ root: 'terminal-tab-dropdown' }}
                        menu={{
                          items: buildSessionTabMenuItems(session),
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation()
                            if (key === 'search') {
                              requestSessionSearch(session.id)
                            } else if (key === 'duplicate') {
                              void duplicateSessionFromMenu(session)
                            } else if (key === 'split') {
                              splitSessionFromMenu(session.id)
                            } else if (key === 'rename') {
                              openRenameSession(session)
                            } else if (key === 'pin') {
                              toggleSessionPinned(session.id)
                            } else if (key === 'color') {
                              setColorSessionId(session.id)
                            } else if (key === 'reset') {
                              resetSessionTabPreference(session.id)
                            }
                          },
                        }}
                      >
                        <span className="session-tab-trigger">
                          <Popover
                            open={colorSessionId === session.id}
                            placement="bottomLeft"
                            arrow={false}
                            trigger="click"
                            classNames={{ root: 'session-tab-color-popover' }}
                            onOpenChange={(open) => {
                              if (!open && colorSessionId === session.id) {
                                setColorSessionId(null)
                              }
                            }}
                            content={(
                              <SessionTabColorPanel
                                color={preference?.color}
                                onSelect={(color, options) => setSessionTabColor(session.id, color, options)}
                                onReset={() => resetSessionTabColor(session.id)}
                              />
                            )}
                          >
                            <SessionTabButton
                              active={session.id === activeSession?.id}
                              role="tab"
                              aria-selected={session.id === activeSession?.id}
                              data-session-tab-id={session.id}
                              className={
                                terminalTabDrag?.dragging && terminalTabDrag.sessionId === session.id ? 'is-dragging' : undefined
                              }
                              onClick={(event) => {
                                if (sessionClosing || suppressNextTabClickRef.current) {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  return
                                }
                                onSelectSession(session.id)
                              }}
                              onMouseDown={(event) => {
                                if (event.button === 1) {
                                  event.preventDefault()
                                }
                              }}
                              onPointerDown={(event) => {
                                if (!sessionClosing) {
                                  beginTerminalTabDrag(event, session.id)
                                }
                              }}
                              onAuxClick={(event) => closeSessionFromTab(event, session.id)}
                              icon={<SquareTerminal size={18} />}
                              label={title}
                              status={session.status}
                              statusLabel={t(`status.${session.status}`)}
                              closing={sessionClosing}
                              closingLabel={t('workbench.closingSession')}
                              pinned={preference?.pinned}
                              pinLabel={t('terminal.tabMenu.pinned')}
                              accentColor={preference?.color}
                              closeLabel={`${t('app.close')} ${title}`}
                              closeDisabled={actionBusy && !sessionClosing}
                              onClose={() => void closeSessionTab(session.id)}
                            />
                          </Popover>
                        </span>
                      </Dropdown>
                    )
                  })
                )}
              </SessionTabStrip>
              <StatusBadge status={sessionBadgeStatus} label={sessionStatusLabel} />
            </div>
          <div className={`terminal-progress-slot ${hasConnectionProgress ? 'is-active' : ''}`}>
            <ConnectionProgress session={activeSession} showReady={showRecentConnectionProgress} />
          </div>
          <TerminalSplitWorkspace
            ref={terminalSplitRef}
            sessions={visibleSessions}
            activeSession={activeSession}
            themeMode={terminalThemeMode}
            placeholder={selectedHost ? t('workbench.terminalReady') : t('workbench.terminalHint')}
            emptyState={visibleSessions.length === 0 ? (
              <WorkbenchEmptyState
                className="terminal-empty-connect"
                icon={<SquareTerminal size={20} aria-hidden="true" />}
                title={t('workbench.emptyTerminalTitle')}
                description={t('workbench.emptyTerminalHint')}
                action={(
                  <ConnectionActionButton
                    className="terminal-empty-connect-button"
                    icon={<Cable size={16} aria-hidden="true" />}
                    disabled={actionBusy}
                    onClick={onOpenConnectionLauncher}
                  >
                    {t('workbench.connectHost')}
                  </ConnectionActionButton>
                )}
              />
            ) : undefined}
            actionBusy={actionBusy}
            dragSessionId={terminalTabDrag?.dragging ? terminalTabDrag.sessionId : null}
            dragPoint={terminalTabDrag?.dragging ? terminalTabDrag.point : null}
            searchPanel={
              terminalSearch.open && terminalSearch.sessionId === activeSession?.id ? (
                <TerminalSearchPanel
                  value={terminalSearch.query}
                  caseSensitive={terminalSearch.caseSensitive}
                  regex={terminalSearch.regex}
                  result={terminalSearch.result}
                  onChange={updateSearchQuery}
                  onPrevious={() => runSearch('previous')}
                  onNext={() => runSearch('next')}
                  onToggleCase={toggleSearchCase}
                  onToggleRegex={toggleSearchRegex}
                  onClose={closeTerminalSearch}
                />
              ) : null
            }
            onSelectSession={onSelectSession}
            onResize={handleTerminalResize}
            onReconnectSession={(session) => void reconnectSession(session)}
            onCloseSession={(session) => void closeSessionTab(session.id)}
          />
          <div className="terminal-statusbar">
            <StatusItem className="is-session-position" label={t('workbench.sessionCount')} value={sessionPositionLabel} />
            <StatusItem label={t('workbench.target')} value={targetLabel} />
            <StatusItem label={t('workbench.sessionState')} value={sessionStateLabel} />
            <StatusItem label={t('workbench.startedAt')} value={startedAt} />
            <StatusItem label={t('workbench.duration')} value={sessionDuration} />
            <StatusItem label={t('workbench.terminalSize')} value={`${terminalSize.cols} x ${terminalSize.rows}`} />
          </div>
        </div>
      </div>

      <FeatureSidePanel<DetailsTabKey>
        activeKey={detailsActiveTab}
        ariaLabel={t('workbench.currentConnection')}
        collapsed={detailsCollapsed}
        collapseLabel={t('app.collapse')}
        expandLabel={t('app.expand')}
        resizing={detailsPanelResize.resizing}
        onActiveKeyChange={setDetailsActiveTab}
        onCollapsedChange={setDetailsCollapsed}
        onResizePointerDown={detailsPanelResize.beginResize}
        tabs={[
          {
            key: 'overview',
            label: t('workbench.detailsTabs.overview'),
            icon: <Server size={17} aria-hidden="true" />,
            children: detailHost ? (
              <div className="connection-overview-panel">
                <div className="connection-overview-hero">
                  <HostAvatar
                    host={detailHost}
                    getIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
                    className="connection-overview-icon"
                    size={42}
                    iconSize={22}
                  />
                  <div className="connection-overview-copy">
                    <strong>{detailHost.name}</strong>
                    <small>{`${detailHost.username}@${detailHost.address}:${detailHost.port}`}</small>
                  </div>
                  <StatusBadge status={sessionBadgeStatus} label={sessionStatusLabel} />
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>{t('hosts.address')}</dt>
                    <dd>{`${detailHost.address}:${detailHost.port}`}</dd>
                  </div>
                  <div>
                    <dt>{t('hosts.username')}</dt>
                    <dd>{detailHost.username}</dd>
                  </div>
                  <div>
                    <dt>{t('hosts.platform.label')}</dt>
                    <dd>{detailHost.platform === 'linux' ? t('hosts.platform.linux') : t('fields.none')}</dd>
                  </div>
                  <div>
                    <dt>{t('hosts.group')}</dt>
                    <dd>{detailGroup?.name ?? t('hosts.ungrouped')}</dd>
                  </div>
                  <div>
                    <dt>{t('hosts.authMethod')}</dt>
                    <dd>{t(`hosts.auth.${detailHost.auth_method}`)}</dd>
                  </div>
                  <div>
                    <dt>{t('workbench.credential')}</dt>
                    <dd>{detailCredentialLabel}</dd>
                  </div>
                  <div>
                    <dt>{t('workbench.sessionState')}</dt>
                    <dd>{sessionStateLabel}</dd>
                  </div>
                  <div>
                    <dt>{t('hosts.tags')}</dt>
                    <dd className="connection-overview-tags-cell">
                      {detailTags.length > 0 ? (
                        <span className="connection-overview-tags">
                          {detailTags.map((tag, index) => (
                            <span key={`${tag}-${index}`}>{tag}</span>
                          ))}
                        </span>
                      ) : t('fields.none')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('workbench.jumpHost')}</dt>
                    <dd>{detailJumpHost?.name ?? t('fields.none')}</dd>
                  </div>
                  <div>
                    <dt>{t('hosts.proxy')}</dt>
                    <dd>{detailProxy
                      ? `${detailProxy.name} · ${t(`proxies.types.${detailProxy.type === 'http_connect' ? 'httpConnect' : 'socks5'}`)}`
                      : t('hosts.noProxy')}</dd>
                  </div>
                  <div>
                    <dt>{t('hosts.note')}</dt>
                    <dd>{detailHost.note || t('fields.none')}</dd>
                  </div>
                </dl>
                <div className="current-connection-actions">
                  <Button
                    className="secondary-button"
                    disabled={!canOpenFiles || actionBusy || !activeSession}
                    onClick={() => activeSession && void onOpenFiles(activeSession)}
                    icon={<FolderOpen size={16} />}
                  >
                    {t('workbench.manageFiles')}
                  </Button>
                  {canReconnectSession ? (
                    <Button
                      className="secondary-button"
                      disabled={actionBusy}
                      onClick={() => void reconnectActiveSession()}
                      icon={<RotateCcw size={16} />}
                    >
                      {t('workbench.reconnectSession')}
                    </Button>
                  ) : null}
                  <Button
                    danger
                    className="danger-button"
                    disabled={!activeSession || (actionBusy && !activeSessionClosing)}
                    loading={activeSessionClosing}
                    onClick={() => activeSession && void closeSessionTab(activeSession.id)}
                    icon={<Power size={16} />}
                  >
                    {activeSessionClosing
                      ? t('workbench.closingSession')
                      : activeSessionEnded
                        ? t('workbench.closeDisconnectedSession')
                        : t('workbench.closeSession')}
                  </Button>
                </div>
              </div>
            ) : (
              <WorkbenchEmptyState
                icon={<Server size={20} />}
                title={t('workbench.connectionOverview.emptyTitle')}
                description={t('workbench.connectionOverview.emptyHint')}
              />
            ),
          },
          {
            key: 'files',
            label: t('workbench.detailsTabs.files'),
            icon: <FolderOpen size={17} aria-hidden="true" />,
            children: (
              <WorkbenchFilesPanel
                api={api}
                data={data}
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
              />
            ),
          },
          {
            key: 'system',
            label: t('workbench.detailsTabs.systemInfo'),
            icon: <Cpu size={17} aria-hidden="true" />,
            children: (
              <SystemInfoPanel
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
          },
          {
            key: 'monitor',
            label: t('workbench.detailsTabs.systemMonitor'),
            icon: <Monitor size={17} aria-hidden="true" />,
            children: (
              <SystemMonitorPanel
                api={api}
                session={activeSession}
                enabled={detailsActiveTab === 'monitor' && !detailsCollapsed}
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
          },
          {
            key: 'processes',
            label: t('workbench.detailsTabs.processes'),
            icon: <Activity size={17} aria-hidden="true" />,
            children: <ProcessPanel api={api} session={activeSession} enabled={detailsActiveTab === 'processes' && !detailsCollapsed} />,
          },
          {
            key: 'services',
            label: t('workbench.detailsTabs.services'),
            icon: <Wrench size={17} aria-hidden="true" />,
            children: <ServicePanel api={api} session={activeSession} enabled={detailsActiveTab === 'services' && !detailsCollapsed} />,
          },
          {
            key: 'docker',
            label: t('workbench.detailsTabs.docker'),
            icon: <Boxes size={17} aria-hidden="true" />,
            children: <DockerPanel api={api} session={activeSession} enabled={detailsActiveTab === 'docker' && !detailsCollapsed} />,
          },
          {
            key: 'firewall',
            label: t('workbench.detailsTabs.firewall'),
            icon: <Shield size={17} aria-hidden="true" />,
            children: (
              <FirewallPanel
                api={api}
                session={activeSession}
                host={sessionHost}
                enabled={detailsActiveTab === 'firewall' && !detailsCollapsed}
              />
            ),
          },
          {
            key: 'forwards',
            label: t('workbench.detailsTabs.forwards'),
            icon: <Cable size={17} aria-hidden="true" />,
            children: (
              <ForwardSessionPanel
                session={activeSession}
                host={sessionHost}
                forwards={data.forwards}
                enabled={active && detailsActiveTab === 'forwards' && !detailsCollapsed}
                actionBusy={actionBusy}
                onStartForward={onStartForward}
                onStopForward={onStopForward}
              />
            ),
          },
          {
            key: 'snippets',
            label: t('workbench.detailsTabs.snippets'),
            icon: <Code2 size={17} aria-hidden="true" />,
            children: (
              <section className="snippet-send-panel">
                <div className="snippet-send-head">
                  <div className="snippet-send-head-main">
                    <span className="snippet-send-head-icon">
                      <Code2 size={16} aria-hidden="true" />
                    </span>
                    <div>
                      <h3>{t('snippets.sendPanelTitle')}</h3>
                      <span>{t('snippets.sendPanelHint')}</span>
                    </div>
                  </div>
                  <span className="snippet-send-head-count">{t('snippets.libraryCount', { count: filteredSnippets.length })}</span>
                </div>
                <div className="snippet-send-filter-shell">
                  <SnippetFilterBar
                    filter={snippetFilter}
                    query={snippetQuery}
                    selectedTags={snippetSelectedTags}
                    groups={data.snippetGroups}
                    selectedGroupId={snippetSelectedGroupId}
                    availableTags={snippetTags}
                    filteredCount={filteredSnippets.length}
                    totalCount={data.snippets.length}
                    density="compact"
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
                  />
                </div>
                {filteredSnippets.length === 0 ? (
                  <SnippetList
                    snippets={[]}
                    totalCount={data.snippets.length}
                    density="compact"
                    emptyDescription={t('snippets.emptyHint')}
                    noResultsDescription={t('snippets.noFilterResults')}
                  />
                ) : (
                  <div className="snippet-workbench-grouped-list">
                    {groupedFilteredSnippets.map((group) => {
                      const collapsed = collapsedSnippetGroups.has(group.id)
                      return (
                        <section key={group.id} className="snippet-workbench-group">
                          <button
                            type="button"
                            className="snippet-workbench-group-head"
                            aria-expanded={!collapsed}
                            onClick={() => {
                              setCollapsedSnippetGroups((current) => {
                                const next = new Set(current)
                                if (next.has(group.id)) next.delete(group.id)
                                else next.add(group.id)
                                return next
                              })
                            }}
                          >
                            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                            <FolderOpen size={14} />
                            <strong>{group.name}</strong>
                            <span>{group.snippets.length}</span>
                          </button>
                          {!collapsed ? (
                            <SnippetList
                              snippets={group.snippets}
                              totalCount={group.snippets.length}
                              density="compact"
                              emptyDescription={t('snippets.emptyHint')}
                              noResultsDescription={t('snippets.noFilterResults')}
                              renderActions={(snippet) => (
                                <>
                                  <Tooltip title={snippet.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}>
                                    <Button
                                      type="text"
                                      className={`snippet-workbench-action is-favorite ${snippet.favorite ? 'is-active' : ''}`}
                                      disabled={actionBusy}
                                      aria-label={snippet.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}
                                      aria-pressed={snippet.favorite}
                                      icon={<Star size={14} fill={snippet.favorite ? 'currentColor' : 'none'} />}
                                      onClick={() => void onToggleSnippetFavorite(snippet)}
                                    />
                                  </Tooltip>
                                  <Tooltip title={t('snippets.action.insert')}>
                                    <Button
                                      type="text"
                                      className="snippet-workbench-action"
                                      disabled={!canSendSnippet || actionBusy}
                                      aria-label={t('snippets.action.insert')}
                                      icon={<Play size={14} />}
                                      onClick={() => void sendSnippet(snippet, false)}
                                    />
                                  </Tooltip>
                                  <Tooltip title={t('snippets.action.send')}>
                                    <Button
                                      type="text"
                                      className="snippet-workbench-action"
                                      disabled={!canSendSnippet || actionBusy}
                                      aria-label={t('snippets.action.send')}
                                      icon={<Send size={14} />}
                                      onClick={() => void sendSnippet(snippet, true)}
                                    />
                                  </Tooltip>
                                </>
                              )}
                            />
                          ) : null}
                        </section>
                      )
                    })}
                  </div>
                )}
              </section>
            ),
          },
        ]}
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

function StatusItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className={['terminal-status-item', className].filter(Boolean).join(' ')}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

type WorkbenchTranslate = (key: string, options?: Record<string, string | number>) => string

interface SystemInfoTreeNode {
  key: string
  icon?: ReactNode
  label: string
  value: string
  children?: SystemInfoTreeNode[]
}

function SystemInfoPanel({
  session,
  t,
  requesting,
  requestError,
  onRetry,
}: {
  session: Session | null
  t: WorkbenchTranslate
  requesting: boolean
  requestError: string
  onRetry: () => void
}) {
  const status = session?.inventory_status ?? 'idle'
  const info = session?.linux_system_info
  const [expandedKeys, setExpandedKeys] = useState(() => new Set<string>())
  if (!session || session.kind !== 'ssh' || session.status !== 'connected') {
    return (
      <WorkbenchEmptyState
        icon={<Monitor size={20} />}
        title={t('workbench.systemInfo.emptyTitle')}
        description={t('workbench.systemInfo.emptyHint')}
      />
    )
  }
  if ((status === 'collecting' || status === 'idle') && !requestError) {
    return (
      <div className="system-info-loading">
        <div>
          <strong>{t('workbench.systemInfo.loadingTitle')}</strong>
          <span>{t('workbench.systemInfo.loadingHint')}</span>
        </div>
        <Skeleton active paragraph={{ rows: 5 }} title={false} />
      </div>
    )
  }
  if (status !== 'ready' || !info) {
    const failed = status === 'failed' || Boolean(requestError)
    return (
      <WorkbenchEmptyState
        className={`system-info-message is-${status}`}
        tone={failed ? 'danger' : 'warning'}
        icon={<TriangleAlert size={18} />}
        title={status === 'unsupported' ? t('workbench.systemInfo.unsupportedTitle') : t('workbench.systemInfo.failedTitle')}
        description={requestError || session.inventory_message || t('workbench.systemInfo.failedHint')}
        action={failed ? (
          <Button
            size="small"
            className="secondary-button"
            loading={requesting}
            disabled={requesting}
            icon={<RotateCcw size={14} />}
            onClick={onRetry}
          >
            {requesting ? t('workbench.systemInfo.retrying') : t('workbench.systemInfo.retry')}
          </Button>
        ) : undefined}
      />
    )
  }
  const nodes = buildSystemInfoTree(info, t)
  const toggleNode = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  return (
    <div className="system-info-panel">
      <div className="system-info-summary">
        <span className="system-info-platform">
          <Server size={14} />
          {t('hosts.platform.linux')}
        </span>
        <Tooltip title={info.os_pretty_name || info.os_name || t('workbench.systemInfo.unknownOS')}>
          <strong>{info.os_pretty_name || info.os_name || t('workbench.systemInfo.unknownOS')}</strong>
        </Tooltip>
        <span>{info.collected_at ? t('workbench.systemInfo.collectedAt', { time: formatTime(info.collected_at) }) : t('fields.none')}</span>
      </div>
      <div className="system-info-tree" role="tree">
        {nodes.map((node) => (
          <SystemInfoTreeRow key={node.key} node={node} expandedKeys={expandedKeys} level={0} onToggle={toggleNode} />
        ))}
      </div>
    </div>
  )
}

function SystemInfoTreeRow({
  node,
  expandedKeys,
  level,
  onToggle,
}: {
  node: SystemInfoTreeNode
  expandedKeys: Set<string>
  level: number
  onToggle: (key: string) => void
}) {
  const hasChildren = Boolean(node.children?.length)
  const expanded = hasChildren && expandedKeys.has(node.key)
  return (
    <div className={`system-info-tree-node level-${level}`} role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <button
        type="button"
        className={`system-info-tree-row ${hasChildren ? 'is-expandable' : ''}`}
        onClick={() => hasChildren && onToggle(node.key)}
      >
        <span className="system-info-tree-label">
          <span className="system-info-tree-toggle" aria-hidden="true">
            {hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
          </span>
          {node.icon ? <span className="system-info-tree-icon">{node.icon}</span> : null}
          <span>{node.label}</span>
        </span>
        <Tooltip title={node.value}>
          <span className="system-info-tree-value">{node.value}</span>
        </Tooltip>
      </button>
      {expanded && node.children?.length ? (
        <div className="system-info-tree-children" role="group">
          {node.children.map((child) => (
            <SystemInfoTreeRow key={child.key} node={child} expandedKeys={expandedKeys} level={level + 1} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function buildSystemInfoTree(info: NonNullable<Session['linux_system_info']>, t: WorkbenchTranslate): SystemInfoTreeNode[] {
  return [
    { key: 'hostname', icon: <Monitor size={15} />, label: t('workbench.systemInfo.hostname'), value: valueOrNone(info.hostname, t) },
    { key: 'kernel', icon: <Layers size={15} />, label: t('workbench.systemInfo.kernel'), value: valueOrNone(info.kernel, t) },
    {
      key: 'cpu',
      icon: <Cpu size={15} />,
      label: t('workbench.systemInfo.cpu'),
      value: valueOrNone(info.cpu_model, t),
      children: [
        { key: 'cpu-cores', label: t('workbench.systemInfo.cpuCores'), value: formatCPUCoreCount(info.cpu_cores, t) },
        { key: 'cpu-frequency', label: t('workbench.systemInfo.cpuFrequency'), value: formatCPUFrequency(info.cpu_frequency_mhz, t) },
      ],
    },
    { key: 'memory', icon: <HardDrive size={15} />, label: t('workbench.systemInfo.memory'), value: formatMemory(info.memory_total_bytes, t) },
    buildSystemNetworkNode(info, t),
    { key: 'architecture', icon: <Cable size={15} />, label: t('workbench.systemInfo.architecture'), value: valueOrNone(info.architecture, t) },
    { key: 'uptime', icon: <Clock3 size={15} />, label: t('workbench.systemInfo.uptime'), value: formatUptime(info.uptime_seconds, t) },
  ]
}

function buildSystemNetworkNode(info: NonNullable<Session['linux_system_info']>, t: WorkbenchTranslate): SystemInfoTreeNode {
  const network = info.network
  const interfaces = (Array.isArray(network?.interfaces) ? network.interfaces : []).filter(Boolean)
  const addressCount = interfaces.reduce(
    (total, networkInterface) => total + (Array.isArray(networkInterface?.addresses) ? networkInterface.addresses.length : 0),
    0,
  )
  let value = t('workbench.systemInfo.networkUnavailable')
  if (network?.status === 'failed') {
    value = t('workbench.systemInfo.networkFailed')
  } else if (network?.status === 'partial') {
    value = t('workbench.systemInfo.networkSummaryPartial', { interfaces: interfaces.length, addresses: addressCount })
  } else if (network?.status === 'ready') {
    value = interfaces.length
      ? t('workbench.systemInfo.networkSummary', { interfaces: interfaces.length, addresses: addressCount })
      : t('workbench.systemInfo.networkNoInterfaces')
  }
  return {
    key: 'network',
    icon: <NetworkIcon size={15} />,
    label: t('workbench.systemInfo.network'),
    value,
    children: interfaces.map((networkInterface, interfacePosition) => {
      const addresses = (Array.isArray(networkInterface?.addresses) ? networkInterface.addresses : []).filter(Boolean)
      const rawInterfaceName = networkInterface?.name?.trim() || ''
      const interfaceName = rawInterfaceName || t('workbench.systemInfo.unnamedInterface', { index: interfacePosition + 1 })
      const interfaceKey = `${networkInterface?.index ?? 0}-${rawInterfaceName || 'unnamed'}-${interfacePosition}`
      return {
        key: `network-interface-${interfaceKey}`,
        label: interfaceName,
        value: addresses.length
          ? t('workbench.systemInfo.interfaceAddressCount', { count: addresses.length })
          : t('workbench.systemInfo.noAssignedAddress'),
        children: addresses.map((address, addressPosition) => ({
          key: `network-address-${interfaceKey}-${address.family}-${address.address}-${address.prefix_length}-${addressPosition}`,
          label: address.family === 'ipv6' ? t('workbench.systemInfo.ipv6') : t('workbench.systemInfo.ipv4'),
          value: formatNetworkAddress(address.address, address.prefix_length, t),
        })),
      }
    }),
  }
}

function formatNetworkAddress(address: string, prefixLength: number, t: WorkbenchTranslate): string {
  const normalizedAddress = address?.trim()
  if (!normalizedAddress) {
    return t('fields.none')
  }
  return Number.isInteger(prefixLength) && prefixLength >= 0 ? `${normalizedAddress}/${prefixLength}` : normalizedAddress
}

function parseDetailsTabKey(value: unknown): DetailsTabKey {
  return value === 'files' ||
    value === 'system' ||
    value === 'monitor' ||
    value === 'processes' ||
    value === 'services' ||
    value === 'docker' ||
    value === 'firewall' ||
    value === 'forwards' ||
    value === 'snippets' ||
    value === 'overview'
    ? value
    : 'overview'
}

function valueOrNone(value: string | undefined, t: WorkbenchTranslate) {
  return value && value.trim() ? value : t('fields.none')
}

function formatCPUCoreCount(value: number | undefined, t: WorkbenchTranslate) {
  if (!value || value <= 0) {
    return t('fields.none')
  }
  return t('workbench.systemInfo.cpuCoreCount', { count: value })
}

function formatCPUFrequency(value: number | undefined, t: WorkbenchTranslate) {
  if (!value || value <= 0) {
    return t('fields.none')
  }
  if (value >= 1000) {
    return `${trimDecimal(value / 1000, 2)} GHz`
  }
  return `${trimDecimal(value, 0)} MHz`
}

function trimDecimal(value: number, digits: number) {
  return value.toFixed(digits).replace(/\.?0+$/, '')
}

function formatMemory(value: number | undefined, t: WorkbenchTranslate) {
  if (!value || value <= 0) {
    return t('fields.none')
  }
  const gib = value / 1024 / 1024 / 1024
  if (gib >= 1) {
    return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`
  }
  return `${(value / 1024 / 1024).toFixed(0)} MB`
}

function formatUptime(value: number | undefined, t: WorkbenchTranslate) {
  if (!value || value <= 0) {
    return t('fields.none')
  }
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  if (days > 0) {
    return t('workbench.systemInfo.uptimeDays', { days, hours })
  }
  if (hours > 0) {
    return t('workbench.systemInfo.uptimeHours', { hours, minutes })
  }
  return t('workbench.systemInfo.uptimeMinutes', { minutes: Math.max(minutes, 1) })
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

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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

function emptyTerminalSearchResult(): TerminalSearchResult {
  return {
    found: false,
    resultIndex: -1,
    resultCount: 0,
  }
}

function TerminalTabMenuItem({
  icon,
  title,
}: {
  icon: ReactNode
  title: string
}) {
  return (
    <span className="terminal-tab-menu-item">
      <span className="terminal-tab-menu-icon">{icon}</span>
      <span className="terminal-tab-menu-label">{title}</span>
    </span>
  )
}

function SnippetVariablePrompt({
  variables,
  onChange,
}: {
  variables: string[]
  onChange: (name: string, value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="snippet-variable-prompt">
      <p>{t('snippets.variablesHint')}</p>
      {variables.map((variable) => (
        <label className="field" key={variable}>
          <span className="field-label">{`{{${variable}}}`}</span>
          <Input autoFocus={variables[0] === variable} onChange={(event) => onChange(variable, event.target.value)} />
        </label>
      ))}
    </div>
  )
}

function SnippetRiskDialog({ snippet, reasons }: { snippet: CodeSnippet; reasons: string[] }) {
  const { t } = useTranslation()
  return (
    <div className="snippet-risk-dialog">
      <p>{t('snippets.riskConfirmDescription')}</p>
      <strong>{snippet.name}</strong>
      <ul>
        {reasons.map((reason) => (
          <li key={reason}>{t(`snippets.riskReasons.${reason}`)}</li>
        ))}
      </ul>
    </div>
  )
}

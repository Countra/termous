import {
  Cable,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Clock3,
  CopyPlus,
  Cpu,
  HardDrive,
  Layers,
  Monitor,
  FolderOpen,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plus,
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
} from 'lucide-react'
import { App as AntdApp, Button, Dropdown, Input, Modal, Popover, Skeleton, Tabs, Tooltip, type MenuProps } from 'antd'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { AuthMethodBadge } from '../../components/ui/AuthMethodBadge'
import { SessionTabButton } from '../../components/ui/SessionTabButton'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { usePersistentBooleanState } from '../../hooks/usePersistentBooleanState'
import { usePersistentJsonState } from '../../hooks/usePersistentJsonState'
import { useResizablePanelWidth } from '../../hooks/useResizablePanelWidth'
import { ConnectionProgress } from '../terminal/ConnectionProgress'
import { TerminalSearchPanel } from '../terminal/TerminalSearchPanel'
import { TerminalSplitWorkspace, type TerminalDragPoint, type TerminalSplitWorkspaceHandle } from '../terminal/TerminalSplitWorkspace'
import { useTerminalRuntime } from '../terminal/terminalRuntimeContext'
import type { TerminalSearchDirection, TerminalSearchResult } from '../terminal/terminalRuntimeContext'
import type { AppData, CodeSnippet, ForwardInstance, ForwardStartRequest, Host, Session, ThemeMode } from '../../types/domain'
import { analyzeSnippetRisk, extractSnippetVariables, renderSnippetCommand } from '../snippets/snippetUtils'
import { ForwardSessionPanel } from '../forwards/ForwardSessionPanel'
import { FirewallPanel } from './FirewallPanel'
import { SessionTabColorPanel } from './SessionTabColorPanel'
import { SystemMonitorPanel } from './SystemMonitorPanel'
import { WorkbenchEmptyState } from './WorkbenchEmptyState'
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

type DetailsTabKey = 'overview' | 'system' | 'monitor' | 'firewall' | 'forwards' | 'snippets'

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

interface WorkbenchPageProps {
  api: TermousApi
  data: AppData
  theme: ThemeMode
  selectedHostId: string
  activeSession: Session | null
  actionBusy: boolean
  onConnect: (hostId: string) => Promise<void>
  onSelectSession: (sessionId: string) => void
  onDisconnect: (sessionId: string) => Promise<void>
  onOpenFiles: (session: Session) => Promise<void>
  onSnippetUsed: (snippetId: string) => Promise<void>
  onToggleSnippetFavorite: (snippet: CodeSnippet) => Promise<void>
  onStartForward: (input: ForwardStartRequest) => Promise<ForwardInstance>
  onStopForward: (id: string) => Promise<void>
}

export function WorkbenchPage({
  api,
  data,
  theme,
  selectedHostId,
  activeSession,
  actionBusy,
  onConnect,
  onSelectSession,
  onDisconnect,
  onOpenFiles,
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
  const expandDetailsPanel = useCallback(() => setDetailsCollapsed(false), [setDetailsCollapsed])
  const detailsPanelResize = useResizablePanelWidth({
    storageKey: 'termous.ui.workbench.detailsPanelWidth.v1',
    defaultWidth: workbenchDetailsPanelWidth.default,
    minWidth: workbenchDetailsPanelWidth.min,
    maxWidth: workbenchDetailsPanelWidth.max,
    side: 'right',
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
  const tabViewportRef = useRef<HTMLDivElement>(null)
  const tabButtonRefs = useRef(new Map<string, HTMLElement>())
  const previousSessionStatusRef = useRef(new Map<string, Session['status']>())
  const terminalTabDragRef = useRef<TerminalTabDragState | null>(null)
  const suppressNextTabClickRef = useRef(false)
  const [tabScrollState, setTabScrollState] = useState({ canScrollLeft: false, canScrollRight: false })
  const recentConnectionTimersRef = useRef(new Map<string, number>())
  const [recentlyConnectedSessionIds, setRecentlyConnectedSessionIds] = useState<Set<string>>(() => new Set())
  const [pendingSearchSessionId, setPendingSearchSessionId] = useState<string | null>(null)
  const [terminalTabDrag, setTerminalTabDrag] = useState<TerminalTabDragState | null>(null)
  const [snippetQuery, setSnippetQuery] = useState('')
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
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
  const activeSessionId = activeSession?.id
  const sessionStatus = activeSession?.status ?? 'disconnected'
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
  const detailTags = detailHost?.tags ?? []
  const detailCredentialLabel = detailHost?.auth_method === 'system'
    ? t('hosts.systemAuth')
    : detailCredential
      ? `${detailCredential.name} (${t(`vault.typeName.${detailCredential.type}`)})`
      : t('fields.none')
  const visibleSessions = useMemo(
    () => sortSessionsForTabs(data.sessions, sessionTabPreferences),
    [data.sessions, sessionTabPreferences],
  )
  const activeSessionIndex = activeSession ? visibleSessions.findIndex((session) => session.id === activeSession.id) : -1
  const sessionPositionLabel =
    activeSessionIndex >= 0 ? `${activeSessionIndex + 1} / ${visibleSessions.length}` : '0'
  const sessionStateLabel = activeSession?.phase ? t(`connection.phase.${activeSession.phase}`) : t(`status.${sessionStatus}`)
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
  const detailsRailItems = useMemo(
    () => [
      {
        key: 'overview' as const,
        label: t('workbench.detailsTabs.overview'),
        icon: <Server size={17} aria-hidden="true" />,
      },
      {
        key: 'system' as const,
        label: t('workbench.detailsTabs.systemInfo'),
        icon: <Cpu size={17} aria-hidden="true" />,
      },
      {
        key: 'monitor' as const,
        label: t('workbench.detailsTabs.systemMonitor'),
        icon: <Monitor size={17} aria-hidden="true" />,
      },
      {
        key: 'firewall' as const,
        label: t('workbench.detailsTabs.firewall'),
        icon: <Shield size={17} aria-hidden="true" />,
      },
      {
        key: 'forwards' as const,
        label: t('workbench.detailsTabs.forwards'),
        icon: <Cable size={17} aria-hidden="true" />,
      },
      {
        key: 'snippets' as const,
        label: t('workbench.detailsTabs.snippets'),
        icon: <Code2 size={17} aria-hidden="true" />,
      },
    ],
    [t],
  )
  const filteredSnippets = useMemo(() => {
    const tokens = snippetQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const snippets = data.snippets
    if (tokens.length === 0) {
      return snippets.slice(0, 8)
    }
    return snippets
      .filter((snippet) => {
        const searchable = [snippet.name, snippet.description ?? '', snippet.command, snippet.shell, ...(snippet.tags ?? [])]
          .join(' ')
          .toLowerCase()
        return tokens.every((token) => searchable.includes(token))
      })
      .slice(0, 8)
  }, [data.snippets, snippetQuery])
  const quickConnectHosts = useMemo(
    () => filterQuickConnectHosts(data.hosts, quickConnectQuery),
    [data.hosts, quickConnectQuery],
  )
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

  const updateTabScrollState = useCallback(() => {
    const viewport = tabViewportRef.current
    if (!viewport) {
      setTabScrollState({ canScrollLeft: false, canScrollRight: false })
      return
    }
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth
    setTabScrollState({
      canScrollLeft: viewport.scrollLeft > 1,
      canScrollRight: viewport.scrollLeft < maxScrollLeft - 1,
    })
  }, [])

  const scrollTabs = useCallback((direction: 'left' | 'right') => {
    const viewport = tabViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollBy({ left: direction === 'left' ? -220 : 220, behavior: 'smooth' })
    window.setTimeout(updateTabScrollState, 180)
  }, [updateTabScrollState])

  const handleTabWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const viewport = tabViewportRef.current
      if (!viewport) {
        return
      }
      const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth
      if (maxScrollLeft <= 1) {
        return
      }
      const wheelDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (wheelDelta === 0) {
        return
      }
      const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, viewport.scrollLeft + wheelDelta))
      if (Math.abs(nextScrollLeft - viewport.scrollLeft) < 1) {
        return
      }
      event.preventDefault()
      viewport.scrollLeft = nextScrollLeft
      updateTabScrollState()
    },
    [updateTabScrollState],
  )

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
    (sessionId: string) => {
      if (actionBusy) {
        return
      }
      if (terminalSearch.sessionId === sessionId) {
        closeTerminalSearch()
      }
      void onDisconnect(sessionId)
    },
    [actionBusy, closeTerminalSearch, onDisconnect, terminalSearch.sessionId],
  )

  const closeSessionFromTab = useCallback(
    (event: MouseEvent<HTMLElement>, sessionId: string) => {
      if (event.button !== 1) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      closeSessionTab(sessionId)
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
    try {
      await onDisconnect(previousSessionId)
    } catch {
      // 旧会话已经断开时，删除失败不阻止重新连接同一主机。
    }
    await onConnect(hostId)
  }, [actionBusy, activeSession?.host_id, activeSession?.id, onConnect, onDisconnect])

  const reconnectSession = useCallback(
    async (session: Session) => {
      if (!session.host_id || actionBusy) {
        return
      }
      try {
        await onDisconnect(session.id)
      } catch {
        // 旧会话已经断开时，删除失败不阻止重新连接同一主机。
      }
      await onConnect(session.host_id)
    },
    [actionBusy, onConnect, onDisconnect],
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
    return () => {
      for (const timer of recentConnectionTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      recentConnectionTimersRef.current.clear()
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
    const viewport = tabViewportRef.current
    if (!viewport) {
      return undefined
    }
    const observer = new ResizeObserver(updateTabScrollState)
    observer.observe(viewport)
    viewport.addEventListener('scroll', updateTabScrollState, { passive: true })
    updateTabScrollState()
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', updateTabScrollState)
    }
  }, [data.sessions.length, updateTabScrollState])

  useEffect(() => {
    updateTabScrollState()
    const activeButton = activeSession?.id ? tabButtonRefs.current.get(activeSession.id) : undefined
    activeButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    window.setTimeout(updateTabScrollState, 180)
  }, [activeSession?.id, data.sessions.length, updateTabScrollState])

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
        className={`page-grid workbench-grid ${detailsCollapsed ? 'is-details-collapsed' : ''}`}
        style={workbenchGridStyle}
      >
	      <div className="terminal-workspace">
	        <div className="terminal-card">
	          <div className="terminal-toolbar">
	            <div className="session-tabs-shell">
	              <Tooltip title={t('workbench.scrollTabsLeft')}>
	                <Button
	                  type="text"
	                  className="session-scroll-button"
	                  aria-label={t('workbench.scrollTabsLeft')}
	                  disabled={!tabScrollState.canScrollLeft}
	                  icon={<ChevronLeft size={15} />}
	                  onClick={() => scrollTabs('left')}
	                />
	              </Tooltip>
	              <div className="session-tabs-stage">
	                <div
	                  className={`terminal-tabs session-tabs ${tabScrollState.canScrollLeft ? 'has-left-overflow' : ''} ${
	                    tabScrollState.canScrollRight ? 'has-right-overflow' : ''
	                  }`}
	                  role="tablist"
	                  aria-label={t('workbench.terminal')}
	                  ref={tabViewportRef}
	                  onWheel={handleTabWheel}
	                >
	                  {visibleSessions.length === 0 ? (
	                    <SessionTabButton empty role="tab" icon={<SquareTerminal size={15} />} label={t('workbench.noSession')} />
	                  ) : (
	                    visibleSessions.map((session) => {
	                      const preference = sessionTabPreferences[session.id]
	                      const title = resolveSessionTitle(session)
	                      return (
	                        <Dropdown
	                          key={session.id}
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
	                              overlayClassName="session-tab-color-popover"
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
	                                ref={(node) => {
	                                  if (node) {
	                                    tabButtonRefs.current.set(session.id, node)
	                                  } else {
	                                    tabButtonRefs.current.delete(session.id)
	                                  }
	                                }}
	                                active={session.id === activeSession?.id}
	                                role="tab"
	                                aria-selected={session.id === activeSession?.id}
	                                className={
	                                  terminalTabDrag?.dragging && terminalTabDrag.sessionId === session.id ? 'is-dragging' : undefined
	                                }
	                                onClick={(event) => {
	                                  if (suppressNextTabClickRef.current) {
	                                    event.preventDefault()
	                                    return
	                                  }
	                                  onSelectSession(session.id)
	                                }}
	                                onMouseDown={(event) => {
	                                  if (event.button === 1) {
	                                    event.preventDefault()
	                                  }
	                                }}
	                                onPointerDown={(event) => beginTerminalTabDrag(event, session.id)}
	                                onAuxClick={(event) => closeSessionFromTab(event, session.id)}
	                                icon={<SquareTerminal size={15} />}
	                                label={title}
	                                status={session.status}
	                                pinned={preference?.pinned}
	                                pinLabel={t('terminal.tabMenu.pinned')}
	                                accentColor={preference?.color}
	                                closeLabel={`${t('app.close')} ${title}`}
	                                closeDisabled={actionBusy}
	                                onClose={() => closeSessionTab(session.id)}
	                              />
	                            </Popover>
	                          </span>
	                        </Dropdown>
	                      )
	                    })
	                  )}
	                </div>
	                <Popover
	                  open={quickConnectOpen}
	                  trigger="click"
                  placement="bottomLeft"
	                  arrow={false}
	                  overlayClassName="session-quick-connect-popover"
	                  onOpenChange={(open) => setQuickConnectOpen(open)}
	                  content={(
	                    <QuickConnectHostPanel
	                      hosts={quickConnectHosts}
	                      totalCount={data.hosts.length}
	                      query={quickConnectQuery}
	                      actionBusy={actionBusy}
	                      onQueryChange={setQuickConnectQuery}
	                      onConnect={connectQuickHost}
	                    />
	                  )}
	                >
	                  <Button
	                    type="text"
	                    className={`session-new-tab-button ${quickConnectOpen ? 'is-open' : ''}`}
	                    aria-label={t('workbench.quickConnect.trigger')}
	                    icon={<Plus size={17} strokeWidth={2.2} />}
	                  />
	                </Popover>
	              </div>
	              <Tooltip title={t('workbench.scrollTabsRight')}>
	                <Button
	                  type="text"
	                  className="session-scroll-button"
	                  aria-label={t('workbench.scrollTabsRight')}
	                  disabled={!tabScrollState.canScrollRight}
	                  icon={<ChevronRight size={15} />}
	                  onClick={() => scrollTabs('right')}
	                />
	              </Tooltip>
	            </div>
            <StatusBadge status={sessionStatus} label={t(`status.${sessionStatus}`)} />
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
            onCloseSession={(session) => void onDisconnect(session.id)}
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

      <aside className={`details-panel ${detailsCollapsed ? 'is-collapsed' : ''} ${detailsPanelResize.resizing ? 'is-resizing' : ''}`}>
        <Tooltip title={detailsCollapsed ? t('app.expand') : t('app.collapse')}>
          <Button
            type="text"
            className="panel-side-toggle panel-side-toggle-right can-resize"
            onPointerDown={detailsPanelResize.beginResize}
            onClick={(event) => {
              if (detailsPanelResize.shouldSuppressClick()) {
                event.preventDefault()
                event.stopPropagation()
                return
              }
              setDetailsCollapsed((current) => !current)
            }}
            aria-label={detailsCollapsed ? t('app.expand') : t('app.collapse')}
            icon={detailsCollapsed ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          />
        </Tooltip>
        {detailsCollapsed ? (
          <div className="details-collapsed-rail" aria-label={t('workbench.currentConnection')}>
            {detailsRailItems.map((item) => (
              <Tooltip key={item.key} title={item.label} placement="left">
                <Button
                  type="text"
                  className={`details-rail-tab ${detailsActiveTab === item.key ? 'is-active' : ''}`}
                  aria-label={item.label}
                  icon={item.icon}
                  onClick={() => {
                    setDetailsActiveTab(item.key)
                    setDetailsCollapsed(false)
                  }}
                />
              </Tooltip>
            ))}
          </div>
        ) : null}
        <div className={`details-content-shell ${detailsCollapsed ? 'is-hidden' : ''}`} aria-hidden={detailsCollapsed}>
          <Tabs
            className="details-tabs"
            size="small"
            activeKey={detailsActiveTab}
            destroyOnHidden={false}
            onChange={(key) => setDetailsActiveTab(parseDetailsTabKey(key))}
            items={[
                {
                  key: 'overview',
                  label: t('workbench.detailsTabs.overview'),
                  children: (
                    detailHost ? (
                      <div className="connection-overview-panel">
                        <div className="connection-overview-hero">
                          <span className="connection-overview-icon">
                            <Server size={22} />
                          </span>
                          <div className="connection-overview-copy">
                            <strong>{detailHost.name}</strong>
                            <small>{`${detailHost.username}@${detailHost.address}:${detailHost.port}`}</small>
                          </div>
                          <StatusBadge status={sessionStatus} label={t(`status.${sessionStatus}`)} />
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
                            disabled={!activeSession || actionBusy}
                            onClick={() => activeSession && void onDisconnect(activeSession.id)}
                            icon={<Power size={16} />}
                          >
                            {activeSessionEnded ? t('workbench.closeDisconnectedSession') : t('workbench.closeSession')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <WorkbenchEmptyState
                        icon={<Server size={20} />}
                        title={t('workbench.connectionOverview.emptyTitle')}
                        description={t('workbench.connectionOverview.emptyHint')}
                      />
                    )
                  ),
                },
                {
                  key: 'system',
                  label: t('workbench.detailsTabs.systemInfo'),
                  children: <SystemInfoPanel session={activeSession} t={t} />,
                },
                {
                  key: 'monitor',
                  label: t('workbench.detailsTabs.systemMonitor'),
                  children: (
                    <SystemMonitorPanel
                      api={api}
                      session={activeSession}
                      enabled={detailsActiveTab === 'monitor' && !detailsCollapsed}
                      theme={theme}
                    />
                  ),
                },
                {
                  key: 'firewall',
                  label: t('workbench.detailsTabs.firewall'),
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
                  children: (
                    <ForwardSessionPanel
                      session={activeSession}
                      host={sessionHost}
                      forwards={data.forwards}
                      actionBusy={actionBusy}
                      onStartForward={onStartForward}
                      onStopForward={onStopForward}
                    />
                  ),
                },
                {
                  key: 'snippets',
                  label: t('workbench.detailsTabs.snippets'),
                  children: (
                    <section className="snippet-send-panel">
                      <div className="snippet-send-head">
                        <div>
                          <h3>{t('snippets.sendPanelTitle')}</h3>
                          <span>{canSendSnippet ? t('snippets.sendPanelHint') : t('snippets.noActiveSession')}</span>
                        </div>
                        <Code2 size={17} aria-hidden="true" />
                      </div>
                      <Input
                        id="workbench-snippet-search"
                        name="workbench-snippet-search"
                        className="host-search-input snippet-quick-search termous-search-input"
                        value={snippetQuery}
                        allowClear
                        variant="borderless"
                        prefix={<Search size={14} aria-hidden="true" />}
                        placeholder={t('snippets.searchPlaceholder')}
                        onChange={(event) => setSnippetQuery(event.target.value)}
                      />
                      {data.snippets.length === 0 ? (
                        <div className="snippet-send-empty">{t('snippets.emptyHint')}</div>
                      ) : filteredSnippets.length === 0 ? (
                        <div className="snippet-send-empty">{t('snippets.noFilterResults')}</div>
                      ) : (
                        <div className="snippet-send-list">
                          {filteredSnippets.map((snippet) => (
                            <SnippetSendRow
                              key={snippet.id}
                              snippet={snippet}
                              disabled={!canSendSnippet || actionBusy}
                              busy={actionBusy}
                              onInsert={() => void sendSnippet(snippet, false)}
                              onSend={() => void sendSnippet(snippet, true)}
                              onToggleFavorite={() => void onToggleSnippetFavorite(snippet)}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  ),
                },
            ]}
          />
        </div>
      </aside>
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

function QuickConnectHostPanel({
  hosts,
  totalCount,
  query,
  actionBusy,
  onQueryChange,
  onConnect,
}: {
  hosts: Host[]
  totalCount: number
  query: string
  actionBusy: boolean
  onQueryChange: (value: string) => void
  onConnect: (hostId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const emptyTitle = totalCount === 0 ? t('workbench.quickConnect.empty') : t('workbench.quickConnect.noResults')

  return (
    <section className="session-quick-connect" aria-label={t('workbench.quickConnect.title')}>
      <Input
        id="workbench-quick-connect-search"
        name="workbench-quick-connect-search"
        className="termous-search-input session-quick-connect-search"
        value={query}
        allowClear
        variant="borderless"
        prefix={<Search size={14} aria-hidden="true" />}
        placeholder={t('workbench.quickConnect.search')}
        onChange={(event) => onQueryChange(event.target.value)}
        onPressEnter={() => {
          if (hosts.length === 1 && !actionBusy) {
            void onConnect(hosts[0].id)
          }
        }}
      />
      <div className="session-quick-connect-list" role="listbox" aria-label={t('workbench.quickConnect.hostList')}>
        {hosts.length === 0 ? (
          <div className="session-quick-connect-empty">{emptyTitle}</div>
        ) : (
          hosts.map((host) => (
            <button
              key={host.id}
              type="button"
              className="session-quick-connect-row"
              role="option"
              disabled={actionBusy}
              onClick={() => void onConnect(host.id)}
            >
              <span className="session-quick-connect-host-icon" aria-hidden="true">
                <Server size={15} />
              </span>
              <span className="session-quick-connect-copy">
                <strong>
                  {host.name}
                  {host.favorite ? <Star size={12} aria-label={t('workbench.hostLauncher.favorite')} /> : null}
                </strong>
                <small>{host.username}@{host.address}:{host.port}</small>
              </span>
              <span className="session-quick-connect-meta">
                <AuthMethodBadge method={host.auth_method} compact />
              </span>
            </button>
          ))
        )}
      </div>
      <footer className="session-quick-connect-footer">
        <small>{t('workbench.quickConnect.count', { count: totalCount })}</small>
      </footer>
    </section>
  )
}

function filterQuickConnectHosts(hosts: Host[], query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = tokens.length === 0
    ? hosts
    : hosts.filter((host) => {
      const searchable = [
        host.name,
        host.address,
        host.username,
        host.group_id,
        host.auth_method,
        ...(host.tags ?? []),
      ]
        .join(' ')
        .toLowerCase()
      return tokens.every((token) => searchable.includes(token))
    })

  return filtered.slice().sort((left, right) => {
    if (left.favorite !== right.favorite) {
      return left.favorite ? -1 : 1
    }
    const rightConnectedAt = readHostConnectedAt(right)
    const leftConnectedAt = readHostConnectedAt(left)
    if (rightConnectedAt !== leftConnectedAt) {
      return rightConnectedAt - leftConnectedAt
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function readHostConnectedAt(host: Host) {
  if (!host.last_connected_at) {
    return 0
  }
  const value = new Date(host.last_connected_at).getTime()
  return Number.isNaN(value) ? 0 : value
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
  icon?: JSX.Element
  label: string
  value: string
  children?: SystemInfoTreeNode[]
}

function SystemInfoPanel({ session, t }: { session: Session | null; t: WorkbenchTranslate }) {
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
  if (status === 'collecting' || status === 'idle') {
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
    return (
      <WorkbenchEmptyState
        className={`system-info-message is-${status}`}
        tone={status === 'failed' ? 'danger' : 'warning'}
        icon={<TriangleAlert size={18} />}
        title={status === 'unsupported' ? t('workbench.systemInfo.unsupportedTitle') : t('workbench.systemInfo.failedTitle')}
        description={session.inventory_message || t('workbench.systemInfo.failedHint')}
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
    { key: 'architecture', icon: <Cable size={15} />, label: t('workbench.systemInfo.architecture'), value: valueOrNone(info.architecture, t) },
    { key: 'uptime', icon: <Clock3 size={15} />, label: t('workbench.systemInfo.uptime'), value: formatUptime(info.uptime_seconds, t) },
  ]
}

function parseDetailsTabKey(value: unknown): DetailsTabKey {
  return value === 'system' || value === 'monitor' || value === 'firewall' || value === 'forwards' || value === 'snippets' || value === 'overview' ? value : 'overview'
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

function padDurationPart(value: number) {
  return String(value).padStart(2, '0')
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
  icon: JSX.Element
  title: string
}) {
  return (
    <span className="terminal-tab-menu-item">
      <span className="terminal-tab-menu-icon">{icon}</span>
      <span className="terminal-tab-menu-label">{title}</span>
    </span>
  )
}

function SnippetSendRow({
  snippet,
  disabled,
  busy,
  onInsert,
  onSend,
  onToggleFavorite,
}: {
  snippet: CodeSnippet
  disabled: boolean
  busy: boolean
  onInsert: () => void
  onSend: () => void
  onToggleFavorite: () => void
}) {
  const { t } = useTranslation()
  const risk = analyzeSnippetRisk(snippet.command)
  return (
    <div className="snippet-send-row">
      <div className="snippet-send-copy">
        <strong>
          {snippet.favorite ? <Star size={12} aria-hidden="true" /> : null}
          {snippet.name}
          {risk.risky ? <TriangleAlert size={13} aria-label={t('snippets.riskDetected')} /> : null}
        </strong>
        <small>{snippet.command}</small>
      </div>
      <div className="snippet-send-actions">
        <Tooltip title={snippet.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}>
          <Button
            type="text"
            className={`snippet-favorite-icon-button ${snippet.favorite ? 'is-active' : ''}`}
            disabled={busy}
            aria-label={snippet.favorite ? t('snippets.unfavorite') : t('snippets.favorite')}
            aria-pressed={snippet.favorite}
            icon={<Star size={14} fill={snippet.favorite ? 'currentColor' : 'none'} />}
            onClick={onToggleFavorite}
          />
        </Tooltip>
        <Tooltip title={t('snippets.action.insert')}>
          <Button type="text" disabled={disabled} aria-label={t('snippets.action.insert')} icon={<Play size={14} />} onClick={onInsert} />
        </Tooltip>
        <Tooltip title={t('snippets.action.send')}>
          <Button type="text" disabled={disabled} aria-label={t('snippets.action.send')} icon={<Send size={14} />} onClick={onSend} />
        </Tooltip>
      </div>
    </div>
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

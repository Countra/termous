import {
  Cable,
  ChevronLeft,
  ChevronRight,
  Code2,
  Layers,
  Monitor,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
  Power,
  Play,
  Search,
  Send,
  Server,
  Shell,
  SquareTerminal,
  Star,
  TriangleAlert,
} from 'lucide-react'
import { App as AntdApp, Button, Dropdown, Input, Tooltip, type MenuProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { HostContextPanel } from '../../components/hosts/HostContextPanel'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { SessionTabButton } from '../../components/ui/SessionTabButton'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { usePersistentBooleanState } from '../../hooks/usePersistentBooleanState'
import { ConnectionProgress } from '../terminal/ConnectionProgress'
import { TerminalSearchPanel } from '../terminal/TerminalSearchPanel'
import { TerminalViewport } from '../terminal/TerminalViewport'
import { useTerminalRuntime } from '../terminal/terminalRuntimeContext'
import type { TerminalSearchDirection, TerminalSearchResult } from '../terminal/terminalRuntimeContext'
import type { AppData, CodeSnippet, Host, LocalShell, Session, ThemeMode } from '../../types/domain'
import { analyzeSnippetRisk, extractSnippetVariables, renderSnippetCommand } from '../snippets/snippetUtils'

interface TerminalSearchState {
  open: boolean
  sessionId: string | null
  query: string
  caseSensitive: boolean
  regex: boolean
  result: TerminalSearchResult
}

interface WorkbenchPageProps {
  data: AppData
  theme: ThemeMode
  selectedHostId: string
  activeSession: Session | null
  actionBusy: boolean
  onSelectHost: (hostId: string) => void
  onConnect: (hostId: string) => Promise<void>
  onOpenLocal: (shell: LocalShell) => Promise<void>
  onSelectSession: (sessionId: string) => void
  onDisconnect: (sessionId: string) => Promise<void>
  onOpenFiles: (session: Session) => Promise<void>
  onSnippetUsed: (snippetId: string) => Promise<void>
}

export function WorkbenchPage({
  data,
  theme,
  selectedHostId,
  activeSession,
  actionBusy,
  onSelectHost,
  onConnect,
  onOpenLocal,
  onSelectSession,
  onDisconnect,
  onOpenFiles,
  onSnippetUsed,
}: WorkbenchPageProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const { searchActive, clearActiveSearch, sendTextToSession } = useTerminalRuntime()
  const [hostPanelCollapsed, setHostPanelCollapsed] = usePersistentBooleanState(
    'termous.ui.workbench.hostPanelCollapsed.v1',
    false,
  )
  const [detailsCollapsed, setDetailsCollapsed] = usePersistentBooleanState(
    'termous.ui.workbench.detailsCollapsed.v1',
    false,
  )
  const tabViewportRef = useRef<HTMLDivElement>(null)
  const tabButtonRefs = useRef(new Map<string, HTMLElement>())
  const previousSessionStatusRef = useRef(new Map<string, Session['status']>())
  const [tabScrollState, setTabScrollState] = useState({ canScrollLeft: false, canScrollRight: false })
  const [recentlyConnectedSessionId, setRecentlyConnectedSessionId] = useState<string | null>(null)
  const [pendingSearchSessionId, setPendingSearchSessionId] = useState<string | null>(null)
  const [snippetQuery, setSnippetQuery] = useState('')
  const [terminalSearch, setTerminalSearch] = useState<TerminalSearchState>({
    open: false,
    sessionId: null,
    query: '',
    caseSensitive: false,
    regex: false,
    result: emptyTerminalSearchResult(),
  })
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
  const activeSessionId = activeSession?.id
  const activeSessionStatus = activeSession?.status
  const sessionStatus = activeSession?.status ?? 'disconnected'
  const showRecentConnectionProgress = recentlyConnectedSessionId === activeSessionId
  const hasConnectionProgress = Boolean(
    activeSession &&
      activeSession.status !== 'disconnected' &&
      (activeSession.status !== 'connected' || showRecentConnectionProgress),
  )
  const credential = data.credentials.find((item) => item.id === selectedHost?.credential_id)
  const jumpHost = data.hosts.find((host) => host.id === selectedHost?.jump_host_id)
  const [terminalSize, setTerminalSize] = useState({ cols: activeSession?.pty_cols ?? 120, rows: activeSession?.pty_rows ?? 32 })
  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    setTerminalSize({ cols, rows })
  }, [])
  const sessionHost = activeSession?.host_id ? data.hosts.find((host) => host.id === activeSession.host_id) : undefined
  const sessionStateLabel = activeSession?.phase ? t(`connection.phase.${activeSession.phase}`) : t(`status.${sessionStatus}`)
  const targetLabel =
    activeSession?.kind === 'local'
      ? t('workbench.localTerminal')
      : sessionHost
        ? `${sessionHost.username}@${sessionHost.address}:${sessionHost.port}`
        : t('workbench.noHost')
  const startedAt = activeSession?.started_at ? formatTime(activeSession.started_at) : t('fields.none')
  const connectedAt = activeSession?.connected_at ? formatTime(activeSession.connected_at) : t('fields.none')
  const sessionResult = activeSession?.last_error ?? (activeSession?.exit_code !== undefined ? String(activeSession.exit_code) : t('fields.none'))
  const terminalThemeMode = data.settings.terminal.theme_mode === 'follow_app' ? theme : data.settings.terminal.theme_mode
  const canOpenFiles = Boolean(activeSession?.kind === 'ssh' && activeSession.status === 'connected' && activeSession.host_id)
  const canSendSnippet = Boolean(activeSession?.kind === 'ssh' && activeSession.status === 'connected')
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
  const sessionSearchMenuItems = useMemo<MenuProps['items']>(
    () => [
      {
        key: 'search',
        label: (
          <TerminalTabMenuItem
            icon={<Search size={15} />}
            title={t('terminal.search')}
          />
        ),
      },
    ],
    [t],
  )

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

  useEffect(() => {
    if (activeSession) {
      setTerminalSize({ cols: activeSession.pty_cols, rows: activeSession.pty_rows })
    }
  }, [activeSession])

  useEffect(() => {
    if (!activeSessionId || !activeSessionStatus) {
      return undefined
    }
    const previousStatus = previousSessionStatusRef.current.get(activeSessionId)
    previousSessionStatusRef.current.set(activeSessionId, activeSessionStatus)
    if (previousStatus !== 'connecting' || activeSessionStatus !== 'connected') {
      return undefined
    }
    setRecentlyConnectedSessionId(activeSessionId)
    const timer = window.setTimeout(() => {
      setRecentlyConnectedSessionId((current) => (current === activeSessionId ? null : current))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [activeSessionId, activeSessionStatus])

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

  return (
    <section
      className={`page-grid workbench-grid ${hostPanelCollapsed ? 'is-host-collapsed' : ''} ${
        detailsCollapsed ? 'is-details-collapsed' : ''
      }`}
    >
      <HostContextPanel
        hosts={data.hosts}
        groups={data.groups}
        selectedHostId={selectedHost?.id}
        collapsed={hostPanelCollapsed}
        title={t('workbench.hostPanel')}
        collapsedTitle={t('workbench.hostsShort')}
        subtitle={`${data.hosts.length} ${t('workbench.hostCount')}`}
        emptyDescription={t('workbench.terminalHint')}
        searchPlaceholder={t('workbench.hostSearch')}
        onToggleCollapsed={() => setHostPanelCollapsed((current) => !current)}
        onSelectHost={onSelectHost}
      />

      <div className="terminal-workspace">
        <div className="page-title-row">
          <div>
            <h1>{t('workbench.title')}</h1>
            <p>{t('workbench.subtitle')}</p>
          </div>
          <div className="page-actions">
            <Button className="secondary-button" disabled={actionBusy} onClick={() => void onOpenLocal('powershell')} icon={<Shell size={16} />}>
              {t('workbench.openPowerShell')}
            </Button>
            <Button className="secondary-button" disabled={actionBusy} onClick={() => void onOpenLocal('cmd')} icon={<Monitor size={16} />}>
              {t('workbench.openCmd')}
            </Button>
            <ConnectionActionButton
              disabled={!selectedHost || actionBusy}
              onClick={() => selectedHost && void onConnect(selectedHost.id)}
              icon={<Cable size={16} />}
            >
              {t('app.connect')}
            </ConnectionActionButton>
          </div>
        </div>

        <div className="metric-strip">
          <Metric icon={<Cable size={18} />} label={t('workbench.sessionCount')} value={String(data.sessions.length)} />
          <Metric icon={<Layers size={18} />} label={t('workbench.hostCount')} value={String(data.hosts.length)} />
          <Metric
            icon={<Power size={18} />}
            label={t('workbench.credentialState')}
            value={credential ? t('status.available') : t('status.notConfigured')}
          />
        </div>

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
              <div
                className={`terminal-tabs session-tabs ${tabScrollState.canScrollLeft ? 'has-left-overflow' : ''} ${
                  tabScrollState.canScrollRight ? 'has-right-overflow' : ''
                }`}
                role="tablist"
                aria-label={t('workbench.terminal')}
                ref={tabViewportRef}
                onWheel={handleTabWheel}
              >
                {data.sessions.length === 0 ? (
                  <SessionTabButton empty role="tab" icon={<SquareTerminal size={15} />} label={t('workbench.noSession')} />
                ) : (
                    data.sessions.map((session) => {
                      const title = sessionTitle(session, data.hosts, t)
                      return (
                        <Dropdown
                          key={session.id}
                          trigger={['contextMenu']}
                          classNames={{ root: 'terminal-tab-dropdown' }}
                          menu={{
                            items: sessionSearchMenuItems,
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation()
                              if (key === 'search') {
                                requestSessionSearch(session.id)
                              }
                            },
                          }}
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
                            onClick={() => onSelectSession(session.id)}
                            onMouseDown={(event) => {
                              if (event.button === 1) {
                                event.preventDefault()
                              }
                            }}
                            onAuxClick={(event) => closeSessionFromTab(event, session.id)}
                            icon={<SquareTerminal size={15} />}
                            label={title}
                            status={session.status}
                            closeLabel={`${t('app.close')} ${title}`}
                            closeDisabled={actionBusy}
                            onClose={() => closeSessionTab(session.id)}
                          />
                        </Dropdown>
                      )
                    })
                )}
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
          <TerminalViewport
            session={activeSession}
            themeMode={terminalThemeMode}
            placeholder={selectedHost ? t('workbench.terminalReady') : t('workbench.terminalHint')}
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
            onResize={handleTerminalResize}
          />
          <div className="terminal-statusbar">
            <StatusItem label={t('workbench.target')} value={targetLabel} />
            <StatusItem label={t('workbench.sessionState')} value={sessionStateLabel} />
            <StatusItem label={t('workbench.startedAt')} value={startedAt} />
            <StatusItem label={t('workbench.connectedAt')} value={connectedAt} />
            <StatusItem label={t('workbench.terminalSize')} value={`${terminalSize.cols} x ${terminalSize.rows}`} />
            <StatusItem label={t('workbench.result')} value={sessionResult} />
          </div>
        </div>
      </div>

      <aside className={`details-panel ${detailsCollapsed ? 'is-collapsed' : ''}`}>
        <div className="panel-heading">
          <div>
            <h2>{detailsCollapsed ? t('workbench.detailsShort') : t('workbench.currentConnection')}</h2>
            {!detailsCollapsed ? <span>{t('workbench.connectionDetails')}</span> : null}
          </div>
          <Tooltip title={detailsCollapsed ? t('app.expand') : t('app.collapse')}>
            <Button
            type="text"
            className="icon-button compact"
            onClick={() => setDetailsCollapsed((current) => !current)}
            aria-label={detailsCollapsed ? t('app.expand') : t('app.collapse')}
            icon={detailsCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          />
          </Tooltip>
        </div>
        {detailsCollapsed ? (
          <div className="details-collapsed-rail">
            <Server size={18} />
            <span>{t(`status.${sessionStatus}`)}</span>
          </div>
        ) : (
          <>
            <CustomSelect
              label={t('workbench.selectHost')}
              value={selectedHost?.id ?? ''}
              onChange={onSelectHost}
              options={data.hosts.map((host) => ({ value: host.id, label: host.name, description: host.address }))}
              disabled={data.hosts.length === 0}
            />
            <dl className="detail-list">
              <div>
                <dt>{t('hosts.address')}</dt>
                <dd>{selectedHost ? `${selectedHost.address}:${selectedHost.port}` : t('fields.none')}</dd>
              </div>
              <div>
                <dt>{t('hosts.username')}</dt>
                <dd>{selectedHost?.username ?? t('fields.none')}</dd>
              </div>
              <div>
                <dt>{t('workbench.credential')}</dt>
                <dd>{selectedHost?.auth_method === 'system' ? t('hosts.systemAuth') : credential?.name ?? t('fields.none')}</dd>
              </div>
              <div>
                <dt>{t('workbench.sessionState')}</dt>
                <dd>{sessionStateLabel}</dd>
              </div>
              <div>
                <dt>{t('workbench.jumpHost')}</dt>
                <dd>{jumpHost?.name ?? t('hosts.noJumpHost')}</dd>
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
              <Button
                danger
                className="danger-button"
                disabled={!activeSession || actionBusy}
                onClick={() => activeSession && void onDisconnect(activeSession.id)}
                icon={<Power size={16} />}
              >
                {t('workbench.closeSession')}
              </Button>
            </div>
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
                      onInsert={() => void sendSnippet(snippet, false)}
                      onSend={() => void sendSnippet(snippet, true)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </aside>
    </section>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="terminal-status-item">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
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

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function emptyTerminalSearchResult(): TerminalSearchResult {
  return {
    found: false,
    resultIndex: -1,
    resultCount: 0,
  }
}

function Metric({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div className="metric-item">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
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
  onInsert,
  onSend,
}: {
  snippet: CodeSnippet
  disabled: boolean
  onInsert: () => void
  onSend: () => void
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

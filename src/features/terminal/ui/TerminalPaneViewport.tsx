import { App as AntdApp, Button } from 'antd'
import { CircleAlert, RefreshCw, WifiOff, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import type { Session, ThemeMode } from '../../../types/domain'
import { TerminalCompletionPopup } from './TerminalCompletionPopup'
import { TerminalContextMenu } from './TerminalContextMenu'
import {
  buildTerminalContextMenu,
  type TerminalContextMenuActionKey,
  type TerminalContextMenuItem,
} from '../model/terminalContextMenuModel'
import { resolveTerminalContextPath } from '../model/terminalContextPath'
import { useSessionCwdState } from '../runtime/terminalCwdContext'
import {
  useSessionCompletionSnapshot,
  useTerminalRuntime,
} from '../runtime/terminalRuntimeContext'
import type { TerminalContextSnapshot } from '../model/terminalContextTarget'
import {
  computeTerminalCompletionPosition,
  estimateTerminalCompletionPopupHeight,
  TERMINAL_COMPLETION_POPUP_WIDTH,
  type TerminalCompletionPopupPosition,
} from '../model/terminalCompletionPosition'
import { shouldActivateTerminalCompletionViewport } from '../model/terminalCompletionViewport'
import {
  useShortcutRuntime,
  type ShortcutScope,
} from '#entities/shortcuts'
import noticeStyles from './TerminalCompletionNotice.module.scss'

interface TerminalPaneViewportProps {
  paneId: string
  session: Session | null
  active: boolean
  workspaceActive: boolean
  dropTargeted?: boolean
  themeMode: ThemeMode
  placeholder: string
  emptyState?: ReactNode
  searchPanel?: ReactNode
  actionBusy?: boolean
  onResize?: (cols: number, rows: number) => void
  onActivate: () => void
  onReconnect?: () => void
  onSearch?: (sessionId: string, initialQuery?: string) => void
  onOpenPath?: (session: Session, path: string) => void
  onClose?: () => void
}

interface TerminalContextMenuState {
  instanceId: number
  snapshot: TerminalContextSnapshot
  point: { x: number; y: number }
  items: TerminalContextMenuItem[]
  resolvedPath: string | null
  autoFocus: boolean
}

export function TerminalPaneViewport({
  paneId,
  session,
  active,
  workspaceActive,
  dropTargeted = false,
  themeMode,
  placeholder,
  emptyState,
  searchPanel,
  actionBusy = false,
  onResize,
  onActivate,
  onReconnect,
  onSearch,
  onOpenPath,
  onClose,
}: TerminalPaneViewportProps) {
  const paneHostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const contextMenuSequenceRef = useRef(0)
  const completionPositionFrameRef = useRef<number | null>(null)
  const contextPathSelectionRef = useRef<{
    sessionId: string
  } | null>(null)
  const {
    registerViewport,
    focusActive,
    resizeSession,
    captureSessionContext,
    pasteSessionClipboard,
    copyText,
    selectSessionContextRange,
    clearSessionContextSelection,
    selectAllSession,
    focusSession,
    subscribeSessionCompletionLayout,
    captureSessionCompletionCursor,
    setViewportCompletionActive,
    setViewportCompletionVisible,
    selectSessionCompletion,
    acceptSessionCompletion,
    retrySessionCompletion,
    closeSessionCompletion,
  } = useTerminalRuntime()
  const { t } = useTranslation()
  const { runtime: shortcutRuntime, labels: shortcutLabels } = useShortcutRuntime()
  const { message } = AntdApp.useApp()
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null)
  const [completionPosition, setCompletionPosition] = useState<TerminalCompletionPopupPosition | null>(null)
  const [completionRetrySessionId, setCompletionRetrySessionId] = useState<string | null>(null)
  const sessionId = session?.id ?? null
  const shortcutContextId = sessionId ? `terminal.viewport:${paneId}` : null
  const completionRetrying = completionRetrySessionId === sessionId
  const completionShortcutFooterVisible = Boolean(
    shortcutLabels.get('terminal.completion.previous')?.length
    || shortcutLabels.get('terminal.completion.next')?.length
    || shortcutLabels.get('terminal.completion.accept')?.length,
  )
  const completionPopupId = `terminal-completion-${paneId}`
  const completion = useSessionCompletionSnapshot(sessionId)
  const cwdState = useSessionCwdState(sessionId)
  const sessionEnded = session?.status === 'disconnected' || session?.status === 'failed'
  const DisconnectIcon = session?.status === 'failed' ? CircleAlert : WifiOff
  const completionOpen = Boolean(
    sessionId
    && session?.kind === 'ssh'
    && session.status === 'connected'
    && active
    && workspaceActive
    && !searchPanel
    && !contextMenu
    && completion.readiness === 'ready'
    && completion.input.trust === 'trusted'
    && !completion.input.composing
    && completion.items.length > 0,
  )
  const completionNotice = Boolean(
    session?.kind === 'ssh'
    && session.status === 'connected'
    && active
    && workspaceActive
    && completion.readiness !== 'disabled'
  ) && (
    completion.promptObservation.status === 'reconnect_required'
    || completion.promptObservation.status === 'degraded'
    || completion.promptObservation.status === 'unsupported'
  )
    ? completion.promptObservation.status
    : null
  const shortcutStateRef = useRef({
    session,
    active,
    workspaceActive,
    actionBusy,
    onActivate,
    onReconnect,
    onSearch,
  })
  shortcutStateRef.current = {
    session,
    active,
    workspaceActive,
    actionBusy,
    onActivate,
    onReconnect,
    onSearch,
  }

  useEffect(() => {
    if (!sessionId || !shortcutContextId) return
    const disposeContext = shortcutRuntime.pushContext({
      id: shortcutContextId,
      layer: 'focus',
      priority: 10,
      isActive: () => {
        const current = shortcutStateRef.current
        return Boolean(
          current.session?.id === sessionId
          && current.active
          && current.workspaceActive,
        )
      },
      scopes: () => {
        const current = shortcutStateRef.current
        if (
          current.session?.id !== sessionId
          || !current.active
          || !current.workspaceActive
        ) {
          return []
        }
        const scopes: ShortcutScope[] = ['terminal.active']
        if (
          current.session.kind === 'ssh'
          && (current.session.status === 'disconnected' || current.session.status === 'failed')
        ) {
          scopes.push('terminal.disconnected')
        }
        return scopes
      },
    })
    const disposeHandlers = [
      shortcutRuntime.registerHandler(shortcutContextId, 'terminal.search.open', () => {
        const current = shortcutStateRef.current
        if (current.session?.id !== sessionId || !current.onSearch) return 'fallthrough'
        current.onActivate()
        current.onSearch(sessionId)
        return 'handled'
      }),
      shortcutRuntime.registerHandler(shortcutContextId, 'terminal.select_all', () => {
        if (!selectAllSession(sessionId)) return 'fallthrough'
        focusSession(sessionId)
        return 'handled'
      }),
      shortcutRuntime.registerHandler(shortcutContextId, 'terminal.session.reconnect', () => {
        const current = shortcutStateRef.current
        if (
          current.session?.id !== sessionId
          || current.session.kind !== 'ssh'
          || (current.session.status !== 'disconnected' && current.session.status !== 'failed')
          || !current.onReconnect
        ) {
          return 'fallthrough'
        }
        if (current.actionBusy) return 'blocked'
        current.onReconnect()
        return 'handled'
      }),
    ]
    return () => {
      disposeHandlers.reverse().forEach((dispose) => dispose())
      disposeContext()
    }
  }, [focusSession, selectAllSession, sessionId, shortcutContextId, shortcutRuntime])

  const clearContextPathSelection = useCallback(() => {
    const selection = contextPathSelectionRef.current
    contextPathSelectionRef.current = null
    if (selection) {
      clearSessionContextSelection(selection.sessionId)
    }
  }, [clearSessionContextSelection])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    clearContextPathSelection()
  }, [clearContextPathSelection])

  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button === 2 || (event.target as Element).closest('.terminal-search-panel')) {
        return
      }
      onActivate()
      if (!sessionEnded && active) {
        focusActive()
      }
    },
    [active, focusActive, onActivate, sessionEnded],
  )

  const openContextMenu = useCallback(
    (
      point: { x: number; y: number },
      pointer?: { clientX: number; clientY: number },
      frozenSnapshot?: TerminalContextSnapshot,
    ) => {
      if (!session) {
        return
      }
      closeSessionCompletion(session.id)
      const snapshot = frozenSnapshot ?? captureSessionContext(session.id, pointer)
      if (!snapshot) {
        return
      }
      const resolvedPath = snapshot.target?.kind === 'path'
        ? resolveTerminalContextPath(snapshot.target, cwdState?.confirmed_path)
        : null
      onActivate()
      clearContextPathSelection()
      if (
        snapshot.target?.kind === 'path'
        && snapshot.target.source === 'pointer'
        && snapshot.target.selectionRange
        && selectSessionContextRange(
          session.id,
          snapshot.target.selectionRange,
          snapshot.target.value,
        )
      ) {
        contextPathSelectionRef.current = {
          sessionId: session.id,
        }
      }
      contextMenuSequenceRef.current += 1
      setContextMenu({
        instanceId: contextMenuSequenceRef.current,
        snapshot,
        point,
        resolvedPath,
        autoFocus: !pointer,
        items: buildTerminalContextMenu(snapshot, {
          showOpenPath: session.kind === 'ssh',
          canOpenPath: Boolean(
            resolvedPath &&
            session.kind === 'ssh' &&
            session.status === 'connected' &&
            session.host_id &&
            onOpenPath
          ),
          canReconnect: Boolean(session.kind === 'ssh' && session.host_id && onReconnect),
          reconnectDisabled: actionBusy,
        }),
      })
    },
    [
      actionBusy,
      captureSessionContext,
      closeSessionCompletion,
      clearContextPathSelection,
      cwdState?.confirmed_path,
      onActivate,
      onOpenPath,
      onReconnect,
      selectSessionContextRange,
      session,
    ],
  )

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!session || (event.target as Element).closest('.terminal-search-panel')) {
        return
      }
      event.preventDefault()
      const snapshot = captureSessionContext(session.id, {
        clientX: event.clientX,
        clientY: event.clientY,
      }) ?? (sessionEnded ? {
        sessionId: session.id,
        selectionText: '',
        searchSeed: '',
        target: null,
        mouseTrackingMode: 'none' as const,
        writable: false,
        disconnected: true,
      } : null)
      if (!snapshot) {
        closeContextMenu()
        return
      }
      if (snapshot.mouseTrackingMode !== 'none' && !event.shiftKey) {
        closeContextMenu()
        return
      }
      event.stopPropagation()
      openContextMenu(
        { x: event.clientX, y: event.clientY },
        { clientX: event.clientX, clientY: event.clientY },
        snapshot,
      )
    },
    [captureSessionContext, closeContextMenu, openContextMenu, session, sessionEnded],
  )

  const handleMouseDownCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (
      event.button !== 2
      || !event.shiftKey
      || (event.target as Element).closest('.terminal-search-panel')
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as Element
      const inSearchPanel = Boolean(target.closest('.terminal-search-panel'))
      const opensContextMenu = event.key === 'ContextMenu'
        || (event.shiftKey && event.key === 'F10')
      if (session && opensContextMenu && !inSearchPanel) {
        event.preventDefault()
        event.stopPropagation()
        const rect = frameRef.current?.getBoundingClientRect()
        const point = rect
          ? {
            x: Math.min(rect.right - 16, rect.left + 48),
            y: Math.min(rect.bottom - 16, rect.top + 48),
          }
          : { x: 24, y: 24 }
        openContextMenu(point)
        return
      }
      if (
        !shortcutContextId
        || inSearchPanel
        || target.closest('[data-shortcut-adapter]')
      ) {
        return
      }
      const result = shortcutRuntime.dispatch(event.nativeEvent, {
        adapterId: `terminal-viewport:${paneId}`,
        contextIds: [shortcutContextId],
        editable: Boolean(target.closest('input, textarea, select, [contenteditable="true"]')),
      })
      if (result.result === 'handled' || result.result === 'blocked') {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [openContextMenu, paneId, session, shortcutContextId, shortcutRuntime],
  )

  const handleContextAction = useCallback(
    async (action: TerminalContextMenuActionKey) => {
      const frozen = contextMenu
      closeContextMenu()
      if (!frozen || !session || session.id !== frozen.snapshot.sessionId) {
        return
      }
      const target = frozen.snapshot.target
      switch (action) {
        case 'reconnect': {
          const currentSnapshot = captureSessionContext(session.id)
          if (
            !actionBusy
            && (currentSnapshot?.disconnected || (!currentSnapshot && sessionEnded))
          ) {
            onReconnect?.()
          }
          return
        }
        case 'open_link':
          if (target?.kind === 'url' && !await openTerminalExternalUrl(target.value)) {
            void message.error({
              content: t('terminal.openLinkFailed'),
              duration: 2,
              className: 'termous-message',
            })
          }
          break
        case 'copy_link':
        case 'copy_path':
          if (target) {
            await copyText(target.value)
          }
          break
        case 'open_path': {
          const currentSnapshot = captureSessionContext(session.id)
          if (
            target?.kind === 'path' &&
            frozen.resolvedPath &&
            session.kind === 'ssh' &&
            session.status === 'connected' &&
            currentSnapshot?.writable &&
            !currentSnapshot.disconnected
          ) {
            onOpenPath?.(session, frozen.resolvedPath)
            return
          }
          break
        }
        case 'copy_selection':
          await copyText(frozen.snapshot.selectionText)
          break
        case 'find_selection':
          onSearch?.(session.id, frozen.snapshot.searchSeed)
          return
        case 'paste':
          await pasteSessionClipboard(session.id)
          break
        case 'select_all':
          // 等菜单完成关闭和焦点归还后再创建选区，避免 Dropdown 的收尾焦点覆盖 xterm 选区。
          window.requestAnimationFrame(() => {
            focusSession(session.id)
            selectAllSession(session.id)
          })
          return
        case 'find':
          onSearch?.(session.id)
          return
      }
      focusSession(session.id)
    },
    [
      contextMenu,
      closeContextMenu,
      copyText,
      actionBusy,
      captureSessionContext,
      focusSession,
      message,
      onOpenPath,
      onReconnect,
      onSearch,
      pasteSessionClipboard,
      selectAllSession,
      session,
      sessionEnded,
      t,
    ],
  )

  useEffect(() => {
    closeContextMenu()
  }, [closeContextMenu, sessionId])

  useEffect(() => {
    if (!workspaceActive) {
      closeContextMenu()
    }
  }, [closeContextMenu, workspaceActive])

  useEffect(() => {
    if (!contextMenu) {
      return undefined
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.terminal-context-menu')) {
        return
      }
      closeContextMenu()
    }
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      closeContextMenu()
      if (sessionId) {
        focusSession(sessionId)
      }
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown, true)
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
      document.removeEventListener('keydown', handleDocumentKeyDown, true)
    }
  }, [closeContextMenu, contextMenu, focusSession, sessionId])

  useEffect(() => {
    return () => {
      clearContextPathSelection()
    }
  }, [clearContextPathSelection])

  useEffect(() => {
    return registerViewport({
      viewportId: paneId,
      sessionId,
      host: paneHostRef.current,
      active,
      onResize,
    })
  }, [active, onResize, paneId, registerViewport, sessionId])

  useEffect(() => {
    const interactionActive = shouldActivateTerminalCompletionViewport({
      sessionId,
      sessionKind: session?.kind,
      sessionStatus: session?.status,
      paneActive: active,
      workspaceActive,
      searchOpen: Boolean(searchPanel),
      contextMenuOpen: Boolean(contextMenu),
    })
    setViewportCompletionActive(paneId, sessionId, interactionActive)
    return () => {
      setViewportCompletionActive(paneId, sessionId, false)
    }
  }, [
    active,
    contextMenu,
    paneId,
    searchPanel,
    session?.kind,
    session?.status,
    sessionId,
    setViewportCompletionActive,
    workspaceActive,
  ])

  useLayoutEffect(() => {
    const visible = Boolean(completionOpen && completionPosition)
    setViewportCompletionVisible(paneId, sessionId, visible)
    return () => {
      setViewportCompletionVisible(paneId, sessionId, false)
    }
  }, [
    completionOpen,
    completionPosition,
    paneId,
    sessionId,
    setViewportCompletionVisible,
  ])

  useLayoutEffect(() => {
    const helperInput = paneHostRef.current?.querySelector('.xterm-helper-textarea')
    if (!(helperInput instanceof HTMLTextAreaElement)) {
      return undefined
    }
    const visible = Boolean(completionOpen && completionPosition)
    if (!visible) {
      helperInput.removeAttribute('aria-autocomplete')
      helperInput.removeAttribute('aria-controls')
      helperInput.removeAttribute('aria-activedescendant')
      helperInput.removeAttribute('aria-expanded')
      return undefined
    }

    helperInput.setAttribute('aria-autocomplete', 'list')
    helperInput.setAttribute('aria-controls', completionPopupId)
    helperInput.setAttribute('aria-expanded', 'true')
    if (completion.selectedIndex >= 0 && completion.selectedIndex < completion.items.length) {
      helperInput.setAttribute(
        'aria-activedescendant',
        `${completionPopupId}-option-${completion.selectedIndex}`,
      )
    } else {
      helperInput.removeAttribute('aria-activedescendant')
    }
    return () => {
      if (helperInput.getAttribute('aria-controls') !== completionPopupId) {
        return
      }
      helperInput.removeAttribute('aria-autocomplete')
      helperInput.removeAttribute('aria-controls')
      helperInput.removeAttribute('aria-activedescendant')
      helperInput.removeAttribute('aria-expanded')
    }
  }, [
    completion.items.length,
    completion.selectedIndex,
    completionOpen,
    completionPopupId,
    completionPosition,
  ])

  const updateCompletionPosition = useCallback(() => {
    if (completionPositionFrameRef.current !== null) {
      window.cancelAnimationFrame(completionPositionFrameRef.current)
      completionPositionFrameRef.current = null
    }
    if (!completionOpen || !sessionId) {
      setCompletionPosition(null)
      return
    }
    completionPositionFrameRef.current = window.requestAnimationFrame(() => {
      completionPositionFrameRef.current = null
      const frame = frameRef.current
      const geometry = captureSessionCompletionCursor(sessionId)
      if (!frame || !geometry) {
        setCompletionPosition(null)
        return
      }
      const paneRect = frame.getBoundingClientRect()
      const nextPosition = computeTerminalCompletionPosition({
        paneRect: {
          left: paneRect.left,
          top: paneRect.top,
          width: paneRect.width,
          height: paneRect.height,
        },
        screenRect: geometry.screenRect,
        cursorX: geometry.cursorX,
        cursorY: geometry.cursorY,
        cellWidth: geometry.screenRect.width / geometry.columns,
        cellHeight: geometry.screenRect.height / geometry.rows,
        popupWidth: TERMINAL_COMPLETION_POPUP_WIDTH,
        popupHeight: estimateTerminalCompletionPopupHeight(
          completion.items.length,
          completionShortcutFooterVisible,
        ),
      })
      setCompletionPosition((current) => sameCompletionPosition(current, nextPosition)
        ? current
        : nextPosition)
    })
  }, [
    captureSessionCompletionCursor,
    completion.items.length,
    completionOpen,
    completionShortcutFooterVisible,
    sessionId,
  ])

  useLayoutEffect(() => {
    updateCompletionPosition()
  }, [
    completion.input.revision,
    updateCompletionPosition,
  ])

  useEffect(() => {
    if (!sessionId) {
      return undefined
    }
    return subscribeSessionCompletionLayout(sessionId, updateCompletionPosition)
  }, [sessionId, subscribeSessionCompletionLayout, updateCompletionPosition])

  useEffect(() => {
    return () => {
      if (completionPositionFrameRef.current !== null) {
        window.cancelAnimationFrame(completionPositionFrameRef.current)
        completionPositionFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const host = paneHostRef.current
    if (!host || !sessionId) {
      return undefined
    }
    const observer = new ResizeObserver(() => resizeSession(sessionId))
    observer.observe(host)
    return () => {
      observer.disconnect()
    }
  }, [resizeSession, sessionId])

  return (
    <div
      ref={frameRef}
      className={`terminal-pane-frame ${active ? 'is-active' : ''} ${dropTargeted ? 'is-drop-target' : ''}`}
      data-pane-id={paneId}
      onMouseDownCapture={handleMouseDownCapture}
      onKeyDownCapture={handleKeyDownCapture}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      <div
        className={`terminal-canvas terminal-theme-${themeMode} ${session ? 'has-session' : 'is-empty'} ${
          sessionEnded ? 'is-session-ended' : ''
        }`}
        aria-label={session ? t('workbench.terminal') : placeholder}
      >
        <div
          className="terminal-session-stack"
          data-shortcut-adapter="xterm"
          ref={paneHostRef}
        />
        <div
          className={`terminal-empty-state ${emptyState ? 'has-action' : ''}`}
          aria-hidden={session ? true : undefined}
        >
          {emptyState ?? placeholder}
        </div>
        {session && sessionEnded ? (
          <div className="terminal-disconnect-overlay" aria-live="polite">
            <div className={`terminal-disconnect-card ${session.status === 'failed' ? 'is-failed' : 'is-disconnected'}`}>
              <span className="terminal-disconnect-icon" aria-hidden="true">
                <DisconnectIcon size={18} />
              </span>
              <div className="terminal-disconnect-copy">
                <strong>
                  {session.status === 'failed'
                    ? t('workbench.terminalFailedTitle')
                    : t('workbench.terminalDisconnectedTitle')}
                </strong>
                <span>
                  {session.last_error ||
                    session.status_message ||
                    (session.status === 'failed' ? t('workbench.terminalFailedHint') : t('workbench.terminalDisconnectedHint'))}
                </span>
              </div>
              <div className="terminal-disconnect-actions">
                {onReconnect ? (
                  <Button
                    className="terminal-disconnect-button terminal-disconnect-button-primary"
                    disabled={actionBusy}
                    icon={<RefreshCw size={15} />}
                    onClick={onReconnect}
                  >
                    {t('workbench.reconnectSession')}
                  </Button>
                ) : null}
                {onClose ? (
                  <Button className="terminal-disconnect-button" disabled={actionBusy} icon={<X size={15} />} onClick={onClose}>
                    {t('workbench.closeDisconnectedSession')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {completionNotice ? (
          <div
            className={`${noticeStyles['terminal-completion-notice']} ${
              completionNotice === 'degraded' || completionNotice === 'unsupported'
                ? noticeStyles[`is-${completionNotice}`]
                : ''
            }`}
            role="status"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <CircleAlert size={14} aria-hidden="true" />
            <span>{t(`terminal.completion.status.${completionNotice}`)}</span>
            {completionNotice === 'reconnect_required' && onReconnect ? (
              <Button
                type="text"
                size="small"
                disabled={actionBusy}
                icon={<RefreshCw size={13} />}
                onClick={onReconnect}
              >
                {t('terminal.completion.reconnect')}
              </Button>
            ) : completionNotice === 'degraded' && completion.promptObservation.retryable ? (
              <Button
                type="text"
                size="small"
                loading={completionRetrying}
                disabled={completionRetrying}
                icon={<RefreshCw size={13} />}
                onClick={() => {
                  if (!sessionId || completionRetrying) {
                    return
                  }
                  const retryingSessionId = sessionId
                  setCompletionRetrySessionId(retryingSessionId)
                  void retrySessionCompletion(sessionId).then((result) => {
                    if (result === 'failed') {
                      void message.error({
                        content: t('terminal.completion.retryFailed'),
                        duration: 2,
                        className: 'termous-message',
                      })
                    }
                  }).finally(() => {
                    setCompletionRetrySessionId((current) => (
                      current === retryingSessionId ? null : current
                    ))
                  })
                }}
              >
                {t('terminal.completion.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {active ? searchPanel : null}
      </div>
      <TerminalCompletionPopup
        id={completionPopupId}
        open={completionOpen}
        items={completion.items}
        selectedIndex={completion.selectedIndex}
        position={completionPosition}
        themeMode={themeMode}
        onSelectedIndexChange={(index) => {
          if (sessionId) {
            selectSessionCompletion(sessionId, index)
          }
        }}
        onAccept={(item, index) => {
          if (sessionId) {
            acceptSessionCompletion(sessionId, {
              index,
              id: item.id,
              insertText: item.insert_text,
            })
          }
        }}
      />
      <TerminalContextMenu
        instanceId={contextMenu?.instanceId ?? 0}
        open={Boolean(contextMenu)}
        autoFocus={contextMenu?.autoFocus ?? false}
        point={contextMenu?.point ?? { x: 0, y: 0 }}
        items={contextMenu?.items ?? []}
        onAction={(action) => void handleContextAction(action)}
        onOpenChange={(open) => {
          if (!open) {
            closeContextMenu()
          }
        }}
      />
    </div>
  )
}

function sameCompletionPosition(
  left: TerminalCompletionPopupPosition | null,
  right: TerminalCompletionPopupPosition | null,
) {
  if (!left || !right) {
    return left === right
  }
  return (
    left.left === right.left
    && left.top === right.top
    && left.maxWidth === right.maxWidth
    && left.maxHeight === right.maxHeight
    && left.placement === right.placement
  )
}

async function openTerminalExternalUrl(url: string) {
  try {
    const externalBridge = getTermousBridge()?.external
    if (externalBridge?.openUrl) {
      const result = await externalBridge.openUrl(url)
      return result.ok
    }
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  } catch {
    return false
  }
}

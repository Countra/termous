import { Button } from 'antd'
import { CircleAlert, RefreshCw, WifiOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Session, ThemeMode } from '../../types/domain'
import { useTerminalRuntime } from './terminalRuntimeContext'

interface TerminalPaneViewportProps {
  paneId: string
  session: Session | null
  active: boolean
  dropTargeted?: boolean
  themeMode: ThemeMode
  placeholder: string
  emptyState?: ReactNode
  searchPanel?: ReactNode
  actionBusy?: boolean
  onResize?: (cols: number, rows: number) => void
  onActivate: () => void
  onReconnect?: () => void
  onClose?: () => void
}

export function TerminalPaneViewport({
  paneId,
  session,
  active,
  dropTargeted = false,
  themeMode,
  placeholder,
  emptyState,
  searchPanel,
  actionBusy = false,
  onResize,
  onActivate,
  onReconnect,
  onClose,
}: TerminalPaneViewportProps) {
  const paneHostRef = useRef<HTMLDivElement>(null)
  const { registerViewport, focusActive, resizeSession, copyOrPasteActive } = useTerminalRuntime()
  const { t } = useTranslation()
  const sessionId = session?.id ?? null
  const sessionEnded = session?.status === 'disconnected' || session?.status === 'failed'
  const DisconnectIcon = session?.status === 'failed' ? CircleAlert : WifiOff

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

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!session || (event.target as Element).closest('.terminal-search-panel')) {
        return
      }
      event.preventDefault()
      onActivate()
      if (active) {
        void copyOrPasteActive({ clearSelectionAfterCopy: true })
      }
    },
    [active, copyOrPasteActive, onActivate, session],
  )

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
      className={`terminal-pane-frame ${active ? 'is-active' : ''} ${dropTargeted ? 'is-drop-target' : ''}`}
      data-pane-id={paneId}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      <div
        className={`terminal-canvas terminal-theme-${themeMode} ${session ? 'has-session' : 'is-empty'} ${
          sessionEnded ? 'is-session-ended' : ''
        }`}
        aria-label={session ? t('workbench.terminal') : placeholder}
      >
        <div className="terminal-session-stack" ref={paneHostRef} />
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
        {active ? searchPanel : null}
      </div>
    </div>
  )
}

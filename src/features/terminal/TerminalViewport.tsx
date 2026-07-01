import { Button } from 'antd'
import { CircleAlert, RotateCcw, WifiOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useTerminalRuntime } from './terminalRuntimeContext'
import type { Session, ThemeMode } from '../../types/domain'

interface TerminalViewportProps {
  session: Session | null
  themeMode: ThemeMode
  placeholder: string
  searchPanel?: ReactNode
  actionBusy?: boolean
  onResize?: (cols: number, rows: number) => void
  onReconnect?: () => void
  onClose?: () => void
}

export function TerminalViewport({
  session,
  themeMode,
  placeholder,
  searchPanel,
  actionBusy = false,
  onResize,
  onReconnect,
  onClose,
}: TerminalViewportProps) {
  const paneHostRef = useRef<HTMLDivElement>(null)
  const { registerViewport, focusActive, resizeActive, copyOrPasteActive } = useTerminalRuntime()
  const { t } = useTranslation()
  const sessionId = session?.id ?? null
  const sessionEnded = session?.status === 'disconnected' || session?.status === 'failed'
  const DisconnectIcon = session?.status === 'failed' ? CircleAlert : WifiOff

  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button === 2) {
        return
      }
      if ((event.target as Element).closest('.terminal-search-panel')) {
        return
      }
      if (sessionEnded) {
        return
      }
      focusActive()
    },
    [focusActive, sessionEnded],
  )

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!session || (event.target as Element).closest('.terminal-search-panel')) {
        return
      }
      event.preventDefault()
      void copyOrPasteActive({ clearSelectionAfterCopy: true })
    },
    [copyOrPasteActive, session],
  )

  useEffect(() => {
    return registerViewport({
      sessionId,
      host: paneHostRef.current,
      onResize,
    })
  }, [onResize, registerViewport, sessionId])

  useEffect(() => {
    const host = paneHostRef.current
    if (!host) {
      return undefined
    }
    const observer = new ResizeObserver(resizeActive)
    observer.observe(host)
    return () => {
      observer.disconnect()
    }
  }, [resizeActive])

  return (
    <div
      className={`terminal-canvas terminal-theme-${themeMode} ${session ? 'has-session' : 'is-empty'} ${
        sessionEnded ? 'is-session-ended' : ''
      }`}
      aria-label={session ? t('workbench.terminal') : placeholder}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      <div className="terminal-session-stack" ref={paneHostRef} />
      <div className="terminal-empty-state" aria-hidden={session ? 'true' : 'false'}>
        {placeholder}
      </div>
      {session && sessionEnded ? (
        <div className="terminal-disconnect-overlay" aria-live="polite">
          <div className={`terminal-disconnect-card ${session.status === 'failed' ? 'is-failed' : 'is-disconnected'}`}>
            <span className="terminal-disconnect-icon" aria-hidden="true">
              <DisconnectIcon size={18} />
            </span>
            <div className="terminal-disconnect-copy">
              <strong>{session.status === 'failed' ? t('workbench.terminalFailedTitle') : t('workbench.terminalDisconnectedTitle')}</strong>
              <span>
                {session.last_error || session.status_message || (
                  session.status === 'failed' ? t('workbench.terminalFailedHint') : t('workbench.terminalDisconnectedHint')
                )}
              </span>
            </div>
            <div className="terminal-disconnect-actions">
              {onReconnect ? (
                <Button
                  className="terminal-disconnect-button terminal-disconnect-button-primary"
                  disabled={actionBusy}
                  icon={<RotateCcw size={15} />}
                  onClick={onReconnect}
                >
                  {t('workbench.reconnectSession')}
                </Button>
              ) : null}
              {onClose ? (
                <Button
                  className="terminal-disconnect-button"
                  disabled={actionBusy}
                  icon={<X size={15} />}
                  onClick={onClose}
                >
                  {t('workbench.closeDisconnectedSession')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {searchPanel}
    </div>
  )
}

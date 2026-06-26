import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useTerminalRuntime } from './terminalRuntimeContext'
import type { Session, ThemeMode } from '../../types/domain'

interface TerminalViewportProps {
  session: Session | null
  themeMode: ThemeMode
  placeholder: string
  searchPanel?: ReactNode
  onResize?: (cols: number, rows: number) => void
}

export function TerminalViewport({ session, themeMode, placeholder, searchPanel, onResize }: TerminalViewportProps) {
  const paneHostRef = useRef<HTMLDivElement>(null)
  const { registerViewport, focusActive, resizeActive, copyOrPasteActive } = useTerminalRuntime()
  const { t } = useTranslation()
  const sessionId = session?.id ?? null

  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button === 2) {
        return
      }
      if ((event.target as Element).closest('.terminal-search-panel')) {
        return
      }
      focusActive()
    },
    [focusActive],
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
      className={`terminal-canvas terminal-theme-${themeMode} ${session ? 'has-session' : 'is-empty'}`}
      aria-label={session ? t('workbench.terminal') : placeholder}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      <div className="terminal-session-stack" ref={paneHostRef} />
      <div className="terminal-empty-state" aria-hidden={session ? 'true' : 'false'}>
        {placeholder}
      </div>
      {searchPanel}
    </div>
  )
}

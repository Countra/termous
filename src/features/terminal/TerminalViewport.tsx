import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useTerminalRuntime } from './terminalRuntimeContext'
import type { Session, ThemeMode } from '../../types/domain'

interface TerminalViewportProps {
  session: Session | null
  themeMode: ThemeMode
  placeholder: string
  onResize?: (cols: number, rows: number) => void
}

export function TerminalViewport({ session, themeMode, placeholder, onResize }: TerminalViewportProps) {
  const paneHostRef = useRef<HTMLDivElement>(null)
  const { registerViewport, focusActive, resizeActive } = useTerminalRuntime()
  const { t } = useTranslation()
  const sessionId = session?.id ?? null

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
      onMouseDown={focusActive}
    >
      <div className="terminal-session-stack" ref={paneHostRef} />
      <div className="terminal-empty-state" aria-hidden={session ? 'true' : 'false'}>
        {placeholder}
      </div>
    </div>
  )
}

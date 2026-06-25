import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApi } from '../../api/client'
import type { Session, SessionPhase, SessionStatus, ThemeMode } from '../../types/domain'

interface TerminalPaneProps {
  api: TermousApi
  session: Session | null
  theme: ThemeMode
  placeholder: string
  onResize?: (cols: number, rows: number) => void
  onSessionEvent?: (sessionId: string, patch: Partial<Session>) => void
}

export function TerminalPane({ api, session, theme, placeholder, onResize, onSessionEvent }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  const onResizeRef = useRef(onResize)
  const onSessionEventRef = useRef(onSessionEvent)
  const themeRef = useRef(theme)
  const { t } = useTranslation()
  const sessionId = session?.id

  useEffect(() => {
    onResizeRef.current = onResize
    onSessionEventRef.current = onSessionEvent
    themeRef.current = theme
  }, [onResize, onSessionEvent, placeholder, theme])

  useEffect(() => {
    if (!containerRef.current) return undefined

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: terminalTheme(themeRef.current),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(containerRef.current)
    const helperInput = containerRef.current.querySelector('.xterm-helper-textarea')
    if (helperInput instanceof HTMLTextAreaElement) {
      helperInput.name = 'terminal-input'
    }
    fit.fit()
    termRef.current = terminal
    fitRef.current = fit

    const observer = new ResizeObserver(() => {
      fit.fit()
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current)
      }
      resizeTimerRef.current = window.setTimeout(() => {
        sendResize(terminal, socketRef.current, lastSizeRef.current, onResizeRef.current)
      }, 120)
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current)
      }
      closeSocket(socketRef.current)
      terminal.dispose()
      termRef.current = null
      fitRef.current = null
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    const terminal = termRef.current
    if (!terminal) return undefined
    terminal.options.theme = terminalTheme(theme)
    return undefined
  }, [theme])

  useEffect(() => {
    const terminal = termRef.current
    if (!terminal) {
      return undefined
    }
    if (!sessionId) {
      terminal.clear()
      return undefined
    }

    closeSocket(socketRef.current)
    lastSizeRef.current = { cols: 0, rows: 0 }
    terminal.clear()
    const socket = new WebSocket(api.websocketUrl(`/api/v1/sessions/${sessionId}/terminal`))
    socketRef.current = socket

    const disposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })

    socket.addEventListener('open', () => {
      fitRef.current?.fit()
      sendResize(terminal, socket, lastSizeRef.current, onResizeRef.current)
    })
    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string
          data?: string
          message?: string
          reason?: string
          status?: SessionStatus
          phase?: SessionPhase
          progress?: number
        }
        if (msg.type === 'status' || msg.type === 'phase' || msg.type === 'ready') {
          if (msg.status || msg.phase || typeof msg.progress === 'number') {
            const patch: Partial<Session> = { status_message: msg.message }
            if (msg.status) patch.status = msg.status
            if (msg.phase) patch.phase = msg.phase
            if (typeof msg.progress === 'number') patch.progress = msg.progress
            onSessionEventRef.current?.(sessionId, patch)
          }
          if (msg.type === 'ready') {
            terminal.focus()
          }
        }
        if (msg.type === 'output' && msg.data) {
          terminal.write(msg.data)
        }
        if (msg.type === 'error' && msg.message) {
          onSessionEventRef.current?.(sessionId, {
            status: 'failed',
            phase: 'failed',
            progress: 100,
            status_message: msg.message,
            last_error: msg.message,
          })
        }
        if (msg.type === 'closed') {
          onSessionEventRef.current?.(sessionId, {
            status: 'disconnected',
            phase: 'disconnected',
            status_message: msg.reason ?? t('status.disconnected'),
          })
        }
      } catch {
        onSessionEventRef.current?.(sessionId, {
          status: 'failed',
          phase: 'failed',
          progress: 100,
          status_message: t('app.error'),
          last_error: t('app.error'),
        })
      }
    })
    let disposed = false
    socket.addEventListener('close', () => {
      if (!disposed) {
        onSessionEventRef.current?.(sessionId, {
          status: 'disconnected',
          phase: 'disconnected',
          status_message: t('status.disconnected'),
        })
      }
    })
    socket.addEventListener('error', () => {
      onSessionEventRef.current?.(sessionId, {
        status: 'failed',
        phase: 'failed',
        progress: 100,
        status_message: t('app.apiOffline'),
        last_error: t('app.apiOffline'),
      })
    })

    return () => {
      disposed = true
      disposable.dispose()
      closeSocket(socket)
    }
  }, [api, sessionId, t])

  return <div className="terminal-canvas" ref={containerRef} aria-label={session ? t('workbench.terminal') : placeholder} />
}

function closeSocket(socket: WebSocket | null) {
  if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    return
  }
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.addEventListener('open', () => socket.close(), { once: true })
    return
  }
  socket.close()
}

function sendResize(
  terminal: Terminal,
  socket: WebSocket | null,
  lastSize: { cols: number; rows: number },
  onResize?: (cols: number, rows: number) => void,
) {
  if (terminal.cols === lastSize.cols && terminal.rows === lastSize.rows) {
    return
  }
  lastSize.cols = terminal.cols
  lastSize.rows = terminal.rows
  onResize?.(terminal.cols, terminal.rows)
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
  }
}

function terminalTheme(theme: ThemeMode) {
  if (theme === 'light') {
    return {
      background: '#fbfcfe',
      foreground: '#1f2630',
      cursor: '#1f6feb',
      selectionBackground: '#d7e5ff',
      black: '#151a22',
      blue: '#1f6feb',
      cyan: '#087f9b',
      green: '#0e7d58',
      magenta: '#7d55c7',
      red: '#bf343b',
      white: '#ffffff',
      yellow: '#966100',
    }
  }
  return {
    background: '#080a0f',
    foreground: '#e6ebf4',
    cursor: '#61a8ff',
    selectionBackground: '#24476d',
    black: '#020617',
    blue: '#61a8ff',
    cyan: '#22d3ee',
    green: '#34d399',
    magenta: '#b58cff',
    red: '#ff6a63',
    white: '#f8fafc',
    yellow: '#f0b84c',
  }
}

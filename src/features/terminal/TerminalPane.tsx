import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApi } from '../../api/client'
import type { Session, ThemeMode } from '../../types/domain'

interface TerminalPaneProps {
  api: TermousApi
  session: Session | null
  theme: ThemeMode
  placeholder: string
  onResize?: (cols: number, rows: number) => void
}

export function TerminalPane({ api, session, theme, placeholder, onResize }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  const { t } = useTranslation()

  useEffect(() => {
    if (!containerRef.current) return undefined

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: terminalTheme(theme),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(containerRef.current)
    fit.fit()
    terminal.writeln(placeholder)
    termRef.current = terminal
    fitRef.current = fit

    const observer = new ResizeObserver(() => {
      fit.fit()
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current)
      }
      resizeTimerRef.current = window.setTimeout(() => {
        sendResize(terminal, socketRef.current, lastSizeRef.current, onResize)
      }, 120)
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current)
      }
      socketRef.current?.close()
      terminal.dispose()
      termRef.current = null
      fitRef.current = null
      socketRef.current = null
    }
  }, [onResize, placeholder, theme])

  useEffect(() => {
    const terminal = termRef.current
    if (!terminal) return undefined
    terminal.options.theme = terminalTheme(theme)
    return undefined
  }, [theme])

  useEffect(() => {
    const terminal = termRef.current
    if (!terminal || !session) {
      return undefined
    }

    socketRef.current?.close()
    lastSizeRef.current = { cols: 0, rows: 0 }
    terminal.clear()
    terminal.writeln(`${t('workbench.terminalReady')}: ${session.id}`)
    const socket = new WebSocket(api.websocketUrl(`/api/v1/sessions/${session.id}/terminal`))
    socketRef.current = socket

    const disposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })

    socket.addEventListener('open', () => {
      fitRef.current?.fit()
      sendResize(terminal, socket, lastSizeRef.current, onResize)
    })
    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type: string; data?: string; message?: string; reason?: string }
        if (msg.type === 'output' && msg.data) {
          terminal.write(msg.data)
        }
        if (msg.type === 'error' && msg.message) {
          terminal.writeln(`\r\n[termous] ${msg.message}`)
        }
        if (msg.type === 'closed') {
          terminal.writeln(`\r\n[termous] ${msg.reason ?? t('status.disconnected')}`)
        }
      } catch {
        terminal.writeln(`\r\n[termous] ${t('app.error')}`)
      }
    })
    let disposed = false
    socket.addEventListener('close', () => {
      if (!disposed) {
        terminal.writeln(`\r\n[termous] ${t('status.disconnected')}`)
      }
    })
    socket.addEventListener('error', () => {
      terminal.writeln(`\r\n[termous] ${t('app.apiOffline')}`)
    })

    return () => {
      disposed = true
      disposable.dispose()
      socket.close()
    }
  }, [api, onResize, session, t])

  return <div className="terminal-canvas" ref={containerRef} aria-label={t('workbench.terminal')} />
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
      background: '#f7f8fb',
      foreground: '#1d2633',
      cursor: '#286df2',
      selectionBackground: '#c9dbff',
      black: '#111827',
      blue: '#286df2',
      cyan: '#0f8ca8',
      green: '#0f8b5f',
      magenta: '#8d55d7',
      red: '#c3393d',
      white: '#f8fafc',
      yellow: '#a66b00',
    }
  }
  return {
    background: '#090d14',
    foreground: '#d8e1ee',
    cursor: '#7dd3fc',
    selectionBackground: '#234363',
    black: '#020617',
    blue: '#60a5fa',
    cyan: '#22d3ee',
    green: '#34d399',
    magenta: '#c084fc',
    red: '#f87171',
    white: '#f8fafc',
    yellow: '#facc15',
  }
}

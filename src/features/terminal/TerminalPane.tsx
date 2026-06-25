import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApi } from '../../api/client'
import type { Session, SessionPhase, SessionStatus, ThemeMode } from '../../types/domain'

interface TerminalPaneProps {
  api: TermousApi
  session: Session | null
  sessionIds: string[]
  theme: ThemeMode
  placeholder: string
  onResize?: (cols: number, rows: number) => void
  onSessionEvent?: (sessionId: string, patch: Partial<Session>) => void
}

interface TerminalEntry {
  sessionId: string
  terminal: Terminal
  fit: FitAddon
  socket: WebSocket
  container: HTMLDivElement
  disposables: Array<{ dispose: () => void }>
  lastSize: { cols: number; rows: number }
  resizeTimer: number | null
  disposed: boolean
  isReady: boolean
}

export function TerminalPane({ api, session, sessionIds, theme, placeholder, onResize, onSessionEvent }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const paneHostRef = useRef<HTMLDivElement>(null)
  const entriesRef = useRef(new Map<string, TerminalEntry>())
  const activeSessionIdRef = useRef<string | null>(null)
  const onResizeRef = useRef(onResize)
  const onSessionEventRef = useRef(onSessionEvent)
  const themeRef = useRef(theme)
  const tRef = useRef<(key: string) => string>((key) => key)
  const { t } = useTranslation()
  const sessionId = session?.id

  useEffect(() => {
    onResizeRef.current = onResize
    onSessionEventRef.current = onSessionEvent
    themeRef.current = theme
    tRef.current = t
  }, [onResize, onSessionEvent, theme, t])

  const disposeEntry = useCallback((entry: TerminalEntry) => {
    if (entry.disposed) {
      return
    }
    entry.disposed = true
    if (entry.resizeTimer) {
      window.clearTimeout(entry.resizeTimer)
      entry.resizeTimer = null
    }
    entry.disposables.forEach((disposable) => disposable.dispose())
    closeSocket(entry.socket)
    entry.terminal.dispose()
    entry.container.remove()
    entriesRef.current.delete(entry.sessionId)
  }, [])

  const disposeAllEntries = useCallback(() => {
    Array.from(entriesRef.current.values()).forEach(disposeEntry)
  }, [disposeEntry])

  const fitAndResize = useCallback((entry: TerminalEntry, shouldFocus = false) => {
    window.requestAnimationFrame(() => {
      if (entry.disposed || activeSessionIdRef.current !== entry.sessionId) {
        return
      }
      try {
        entry.fit.fit()
      } catch {
        return
      }
      sendResize(entry, onResizeRef.current)
      if (shouldFocus) {
        entry.terminal.focus()
      }
    })
  }, [])

  const createEntry = useCallback(
    (nextSessionId: string) => {
      const existingEntry = entriesRef.current.get(nextSessionId)
      if (existingEntry) {
        return existingEntry
      }
      const paneHost = paneHostRef.current
      if (!paneHost) {
        return null
      }
      const pane = document.createElement('div')
      pane.className = 'terminal-session-pane is-inactive'
      pane.dataset.sessionId = nextSessionId
      paneHost.appendChild(pane)

      const socket = new WebSocket(api.websocketUrl(`/api/v1/sessions/${nextSessionId}/terminal`))
      const fit = new FitAddon()
      const terminal = createTerminal(themeRef.current)
      terminal.loadAddon(fit)
      terminal.open(pane)
      const helperInput = pane.querySelector('.xterm-helper-textarea')
      if (helperInput instanceof HTMLTextAreaElement) {
        helperInput.name = `terminal-input-${nextSessionId}`
      }

      const entry: TerminalEntry = {
        sessionId: nextSessionId,
        terminal,
        fit,
        socket,
        container: pane,
        disposables: [],
        lastSize: { cols: 0, rows: 0 },
        resizeTimer: null,
        disposed: false,
        isReady: false,
      }
      entriesRef.current.set(nextSessionId, entry)

      entry.disposables.push(
        terminal.onData((data) => {
          if (activeSessionIdRef.current !== nextSessionId) {
            return
          }
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'input', data }))
          }
        }),
      )

      socket.addEventListener('open', () => {
        entry.isReady = true
        if (activeSessionIdRef.current === nextSessionId) {
          fitAndResize(entry, true)
        }
      })
      socket.addEventListener('message', (event) => {
        if (entry.disposed) {
          return
        }
        handleSocketMessage(entry, String(event.data), onSessionEventRef.current, tRef.current)
      })
      socket.addEventListener('close', () => {
        if (!entry.disposed) {
          onSessionEventRef.current?.(nextSessionId, {
            status: 'disconnected',
            phase: 'disconnected',
            status_message: tRef.current('status.disconnected'),
          })
        }
      })
      socket.addEventListener('error', () => {
        onSessionEventRef.current?.(nextSessionId, {
          status: 'failed',
          phase: 'failed',
          progress: 100,
          status_message: tRef.current('app.apiOffline'),
          last_error: tRef.current('app.apiOffline'),
        })
      })

      return entry
    },
    [api, fitAndResize],
  )

  const setActiveEntry = useCallback(
    (nextSessionId: string | null) => {
      activeSessionIdRef.current = nextSessionId
      entriesRef.current.forEach((entry) => {
        const active = entry.sessionId === nextSessionId
        entry.container.classList.toggle('is-active', active)
        entry.container.classList.toggle('is-inactive', !active)
      })
      if (!nextSessionId) {
        return
      }
      const entry = createEntry(nextSessionId)
      if (!entry) {
        return
      }
      entry.container.classList.add('is-active')
      entry.container.classList.remove('is-inactive')
      fitAndResize(entry, true)
    },
    [createEntry, fitAndResize],
  )

  const scheduleActiveResize = useCallback(() => {
    const activeSessionId = activeSessionIdRef.current
    if (!activeSessionId) {
      return
    }
    const entry = entriesRef.current.get(activeSessionId)
    if (!entry || entry.disposed) {
      return
    }
    if (entry.resizeTimer) {
      window.clearTimeout(entry.resizeTimer)
    }
    entry.resizeTimer = window.setTimeout(() => {
      entry.resizeTimer = null
      fitAndResize(entry)
    }, 120)
  }, [fitAndResize])

  useEffect(() => {
    if (!containerRef.current) return undefined
    const observer = new ResizeObserver(scheduleActiveResize)
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      disposeAllEntries()
    }
  }, [disposeAllEntries, scheduleActiveResize])

  useEffect(() => {
    return () => {
      disposeAllEntries()
    }
  }, [api, disposeAllEntries])

  useEffect(() => {
    const allowedSessionIds = new Set(sessionIds)
    Array.from(entriesRef.current.values()).forEach((entry) => {
      if (!allowedSessionIds.has(entry.sessionId)) {
        disposeEntry(entry)
      }
    })
  }, [disposeEntry, sessionIds])

  useEffect(() => {
    entriesRef.current.forEach((entry) => {
      entry.terminal.options.theme = terminalTheme(theme)
    })
  }, [theme])

  useEffect(() => {
    setActiveEntry(sessionId ?? null)
  }, [sessionId, setActiveEntry])

  return (
    <div
      className={`terminal-canvas ${session ? 'has-session' : 'is-empty'}`}
      ref={containerRef}
      aria-label={session ? t('workbench.terminal') : placeholder}
      onMouseDown={() => {
        const activeSessionId = activeSessionIdRef.current
        if (!activeSessionId) {
          return
        }
        entriesRef.current.get(activeSessionId)?.terminal.focus()
      }}
    >
      <div className="terminal-session-stack" ref={paneHostRef} />
      <div className="terminal-empty-state" aria-hidden={session ? 'true' : 'false'}>
        {placeholder}
      </div>
    </div>
  )
}

function createTerminal(theme: ThemeMode) {
  return new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: terminalTheme(theme),
  })
}

function handleSocketMessage(
  entry: TerminalEntry,
  data: string,
  onSessionEvent: TerminalPaneProps['onSessionEvent'],
  t: (key: string) => string,
) {
  try {
    const msg = JSON.parse(data) as {
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
        onSessionEvent?.(entry.sessionId, patch)
      }
    }
    if (msg.type === 'output' && msg.data) {
      entry.terminal.write(msg.data)
    }
    if (msg.type === 'error' && msg.message) {
      onSessionEvent?.(entry.sessionId, {
        status: 'failed',
        phase: 'failed',
        progress: 100,
        status_message: msg.message,
        last_error: msg.message,
      })
    }
    if (msg.type === 'closed') {
      onSessionEvent?.(entry.sessionId, {
        status: 'disconnected',
        phase: 'disconnected',
        status_message: msg.reason ?? t('status.disconnected'),
      })
    }
  } catch {
    onSessionEvent?.(entry.sessionId, {
      status: 'failed',
      phase: 'failed',
      progress: 100,
      status_message: t('app.error'),
      last_error: t('app.error'),
    })
  }
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

function sendResize(entry: TerminalEntry, onResize?: (cols: number, rows: number) => void) {
  const { terminal, socket, lastSize } = entry
  if (terminal.cols === lastSize.cols && terminal.rows === lastSize.rows) {
    return
  }
  lastSize.cols = terminal.cols
  lastSize.rows = terminal.rows
  onResize?.(terminal.cols, terminal.rows)
  if (socket.readyState === WebSocket.OPEN) {
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

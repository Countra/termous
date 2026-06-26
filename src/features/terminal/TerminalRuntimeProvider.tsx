import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApi } from '../../api/client'
import type { Session, SessionPhase, SessionStatus, TerminalSettings, ThemeMode } from '../../types/domain'
import { defaultTerminalSettings, normalizeTerminalSettings } from '../settings/terminalSettings'
import {
  TerminalRuntimeContext,
  type TerminalRuntimeContextValue,
  type TerminalViewportOptions,
} from './terminalRuntimeContext'

interface TerminalRuntimeProviderProps {
  api: TermousApi
  sessions: Session[]
  theme: ThemeMode
  terminalSettings: TerminalSettings
  children: ReactNode
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

interface ViewportState {
  sessionId: string | null
  host: HTMLDivElement | null
  onResize?: (cols: number, rows: number) => void
}

export function TerminalRuntimeProvider({
  api,
  sessions,
  theme,
  terminalSettings,
  children,
  onSessionEvent,
}: TerminalRuntimeProviderProps) {
  const entriesRef = useRef(new Map<string, TerminalEntry>())
  const parkingHostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<ViewportState>({ sessionId: null, host: null })
  const activeSessionIdRef = useRef<string | null>(null)
  const apiRef = useRef(api)
  const themeRef = useRef(theme)
  const terminalSettingsRef = useRef(normalizeTerminalSettings(terminalSettings))
  const onSessionEventRef = useRef(onSessionEvent)
  const tRef = useRef<(key: string) => string>((key) => key)
  const { t } = useTranslation()

  useEffect(() => {
    apiRef.current = api
  }, [api])

  useEffect(() => {
    themeRef.current = theme
    entriesRef.current.forEach((entry) => {
      entry.terminal.options.theme = terminalTheme(terminalSettingsRef.current, theme)
    })
  }, [theme])

  useEffect(() => {
    onSessionEventRef.current = onSessionEvent
    tRef.current = t
  }, [onSessionEvent, t])

  const closeSocket = useCallback((socket: WebSocket | null) => {
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      return
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.addEventListener('open', () => socket.close(), { once: true })
      return
    }
    socket.close()
  }, [])

  const disposeEntry = useCallback(
    (entry: TerminalEntry) => {
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
    },
    [closeSocket],
  )

  const disposeSession = useCallback(
    (sessionId: string) => {
      const entry = entriesRef.current.get(sessionId)
      if (entry) {
        disposeEntry(entry)
      }
    },
    [disposeEntry],
  )

  const disposeAll = useCallback(() => {
    Array.from(entriesRef.current.values()).forEach(disposeEntry)
  }, [disposeEntry])

  const sendResize = useCallback((entry: TerminalEntry) => {
    const { terminal, socket, lastSize } = entry
    if (terminal.cols === lastSize.cols && terminal.rows === lastSize.rows) {
      return
    }
    lastSize.cols = terminal.cols
    lastSize.rows = terminal.rows
    viewportRef.current.onResize?.(terminal.cols, terminal.rows)
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
  }, [])

  const fitAndResize = useCallback(
    (entry: TerminalEntry, shouldFocus = false) => {
      window.requestAnimationFrame(() => {
        if (entry.disposed || activeSessionIdRef.current !== entry.sessionId || !viewportRef.current.host) {
          return
        }
        try {
          entry.fit.fit()
        } catch {
          return
        }
        sendResize(entry)
        if (shouldFocus) {
          entry.terminal.focus()
        }
      })
    },
    [sendResize],
  )

  useEffect(() => {
    const nextSettings = normalizeTerminalSettings(terminalSettings)
    const previousSettings = terminalSettingsRef.current
    terminalSettingsRef.current = nextSettings
    const shouldResize = shouldFitAfterSettingsChange(previousSettings, nextSettings)
    entriesRef.current.forEach((entry) => {
      applyTerminalSettings(entry.terminal, nextSettings, themeRef.current)
      if (shouldResize) {
        fitAndResize(entry)
      }
    })
  }, [fitAndResize, terminalSettings])

  const createEntry = useCallback(
    (sessionId: string) => {
      const existingEntry = entriesRef.current.get(sessionId)
      if (existingEntry) {
        return existingEntry
      }

      const pane = document.createElement('div')
      pane.className = 'terminal-session-pane is-inactive'
      pane.dataset.sessionId = sessionId
      ;(parkingHostRef.current ?? document.body).appendChild(pane)

      const socket = new WebSocket(apiRef.current.websocketUrl(`/api/v1/sessions/${sessionId}/terminal`))
      const fit = new FitAddon()
      const terminal = createTerminal(themeRef.current, terminalSettingsRef.current)
      terminal.loadAddon(fit)
      terminal.open(pane)
      const helperInput = pane.querySelector('.xterm-helper-textarea')
      if (helperInput instanceof HTMLTextAreaElement) {
        helperInput.name = `terminal-input-${sessionId}`
      }

      const entry: TerminalEntry = {
        sessionId,
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
      entriesRef.current.set(sessionId, entry)

      entry.disposables.push(
        terminal.onData((data) => {
          if (activeSessionIdRef.current !== sessionId) {
            return
          }
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'input', data }))
          }
        }),
      )

      socket.addEventListener('open', () => {
        entry.isReady = true
        if (activeSessionIdRef.current === sessionId) {
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
          onSessionEventRef.current?.(sessionId, {
            status: 'disconnected',
            phase: 'disconnected',
            status_message: tRef.current('status.disconnected'),
          })
        }
      })
      socket.addEventListener('error', () => {
        onSessionEventRef.current?.(sessionId, {
          status: 'failed',
          phase: 'failed',
          progress: 100,
          status_message: tRef.current('app.apiOffline'),
          last_error: tRef.current('app.apiOffline'),
        })
      })

      return entry
    },
    [fitAndResize],
  )

  const moveEntryToHost = useCallback((entry: TerminalEntry, host: HTMLDivElement | null, active: boolean) => {
    const targetHost = host ?? parkingHostRef.current
    if (targetHost && entry.container.parentElement !== targetHost) {
      targetHost.appendChild(entry.container)
    }
    entry.container.classList.toggle('is-active', active)
    entry.container.classList.toggle('is-inactive', !active)
  }, [])

  const syncViewport = useCallback(() => {
    const { sessionId, host } = viewportRef.current
    activeSessionIdRef.current = sessionId

    entriesRef.current.forEach((entry) => {
      moveEntryToHost(entry, host, entry.sessionId === sessionId && Boolean(host))
    })

    if (!sessionId || !host) {
      return
    }
    const entry = createEntry(sessionId)
    moveEntryToHost(entry, host, true)
    fitAndResize(entry, true)
  }, [createEntry, fitAndResize, moveEntryToHost])

  const registerViewport = useCallback(
    ({ sessionId, host, onResize }: TerminalViewportOptions) => {
      viewportRef.current = { sessionId, host, onResize }
      syncViewport()
      return () => {
        if (viewportRef.current.host === host) {
          viewportRef.current = { sessionId: null, host: null }
          syncViewport()
        }
      }
    },
    [syncViewport],
  )

  const focusActive = useCallback(() => {
    const activeSessionId = activeSessionIdRef.current
    if (!activeSessionId) {
      return
    }
    entriesRef.current.get(activeSessionId)?.terminal.focus()
  }, [])

  const scheduleActiveResize = useCallback(() => {
    const activeSessionId = activeSessionIdRef.current
    if (!activeSessionId || !viewportRef.current.host) {
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
    const allowedSessionIds = new Set(sessions.map((session) => session.id))
    Array.from(entriesRef.current.values()).forEach((entry) => {
      if (!allowedSessionIds.has(entry.sessionId)) {
        disposeEntry(entry)
      }
    })
    syncViewport()
  }, [disposeEntry, sessions, syncViewport])

  useEffect(() => {
    return () => {
      disposeAll()
    }
  }, [api, disposeAll])

  const value = useMemo<TerminalRuntimeContextValue>(
    () => ({
      registerViewport,
      focusActive,
      resizeActive: scheduleActiveResize,
      disposeSession,
      disposeAll,
    }),
    [disposeAll, disposeSession, focusActive, registerViewport, scheduleActiveResize],
  )

  return (
    <TerminalRuntimeContext.Provider value={value}>
      {children}
      <div className="terminal-runtime-parking" ref={parkingHostRef} aria-hidden="true" />
    </TerminalRuntimeContext.Provider>
  )
}

function createTerminal(theme: ThemeMode, settings: TerminalSettings = defaultTerminalSettings) {
  const normalizedSettings = normalizeTerminalSettings(settings)
  return new Terminal({
    cursorBlink: normalizedSettings.cursor_blink,
    cursorStyle: normalizedSettings.cursor_style,
    convertEol: true,
    fontFamily: fontFamilyFromSetting(normalizedSettings.font_family),
    fontSize: normalizedSettings.font_size,
    letterSpacing: normalizedSettings.letter_spacing,
    lineHeight: normalizedSettings.line_height,
    scrollback: normalizedSettings.scrollback,
    theme: terminalTheme(normalizedSettings, theme),
  })
}

function applyTerminalSettings(terminal: Terminal, settings: TerminalSettings, appTheme: ThemeMode) {
  const normalizedSettings = normalizeTerminalSettings(settings)
  terminal.options.cursorBlink = normalizedSettings.cursor_blink
  terminal.options.cursorStyle = normalizedSettings.cursor_style
  terminal.options.fontFamily = fontFamilyFromSetting(normalizedSettings.font_family)
  terminal.options.fontSize = normalizedSettings.font_size
  terminal.options.letterSpacing = normalizedSettings.letter_spacing
  terminal.options.lineHeight = normalizedSettings.line_height
  terminal.options.scrollback = normalizedSettings.scrollback
  terminal.options.theme = terminalTheme(normalizedSettings, appTheme)
}

function shouldFitAfterSettingsChange(previous: TerminalSettings, next: TerminalSettings) {
  return (
    previous.font_family !== next.font_family ||
    previous.font_size !== next.font_size ||
    previous.line_height !== next.line_height ||
    previous.letter_spacing !== next.letter_spacing
  )
}

function fontFamilyFromSetting(fontFamily: TerminalSettings['font_family']) {
  if (fontFamily === 'consolas') {
    return 'Consolas, "JetBrains Mono", monospace'
  }
  if (fontFamily === 'monospace') {
    return 'monospace'
  }
  return '"JetBrains Mono", Consolas, monospace'
}

function handleSocketMessage(
  entry: TerminalEntry,
  data: string,
  onSessionEvent: TerminalRuntimeProviderProps['onSessionEvent'],
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

function terminalTheme(settings: TerminalSettings, appTheme: ThemeMode) {
  const theme = settings.theme_mode === 'follow_app' ? appTheme : settings.theme_mode
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
  if (theme === 'custom') {
    return {
      background: '#101417',
      foreground: '#e5e7df',
      cursor: '#d6ff7f',
      selectionBackground: '#3d4f35',
      black: '#070a0d',
      blue: '#8ab4ff',
      cyan: '#84e8d1',
      green: '#a6e58f',
      magenta: '#d5a6ff',
      red: '#ff8f84',
      white: '#f7f4e8',
      yellow: '#f7d46b',
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

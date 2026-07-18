import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { App as AntdApp } from 'antd'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApi } from '../../api/client'
import { TerminalCwdRuntimeProvider } from '../../app/TerminalCwdRuntimeProvider'
import type {
  Session,
  SessionCwdChangeRequest,
  SessionCwdState,
  SessionPhase,
  SessionStatus,
  TerminalFont,
  TerminalSettings,
  ThemeMode,
} from '../../types/domain'
import { defaultTerminalSettings, normalizeTerminalSettings } from '../settings/terminalSettings'
import {
  TerminalRuntimeContext,
  type TerminalRuntimeContextValue,
  type TerminalClipboardAction,
  type TerminalClipboardOptions,
  type TerminalSearchDirection,
  type TerminalSearchOptions,
  type TerminalSearchResult,
  type TerminalSendResult,
  type TerminalViewportOptions,
} from './terminalRuntimeContext'
import {
  parseOSC7Payload,
  parsePrivateCwdPayload,
  TERMOUS_CWD_PRIVATE_OSC,
  TerminalCwdRuntime,
} from './terminalCwdRuntime'
import { fontFamilyFromSetting, loadTerminalFont, syncImportedFontFaces } from './terminalFonts'

interface TerminalRuntimeProviderProps {
  api: TermousApi
  sessions: Session[]
  theme: ThemeMode
  terminalSettings: TerminalSettings
  terminalFonts: TerminalFont[]
  children: ReactNode
  onSessionEvent?: (sessionId: string, patch: Partial<Session>) => void
}

interface TerminalEntry {
  sessionId: string
  terminal: Terminal
  fit: FitAddon
  search: SearchAddon
  searchResult: TerminalSearchResult
  searchDecorationKey: string
  socket: WebSocket
  container: HTMLDivElement
  disposables: Array<{ dispose: () => void }>
  lastSize: { cols: number; rows: number }
  resizeTimer: number | null
  disposed: boolean
  isReady: boolean
}

interface ViewportState {
  viewportId: string
  sessionId: string | null
  host: HTMLDivElement | null
  active: boolean
  onResize?: (cols: number, rows: number) => void
}

export function TerminalRuntimeProvider({
  api,
  sessions,
  theme,
  terminalSettings,
  terminalFonts,
  children,
  onSessionEvent,
}: TerminalRuntimeProviderProps) {
  const entriesRef = useRef(new Map<string, TerminalEntry>())
  const sessionsRef = useRef(new Map<string, Session>())
  const parkingHostRef = useRef<HTMLDivElement>(null)
  const viewportsRef = useRef(new Map<string, ViewportState>())
  const activeSessionIdRef = useRef<string | null>(null)
  const apiRef = useRef(api)
  const themeRef = useRef(theme)
  const terminalSettingsRef = useRef(normalizeTerminalSettings(terminalSettings))
  const terminalFontsRef = useRef(terminalFonts)
  const onSessionEventRef = useRef(onSessionEvent)
  const tRef = useRef<(key: string) => string>((key) => key)
  const cwdRuntimeRef = useRef<TerminalCwdRuntime | null>(null)
  if (!cwdRuntimeRef.current) {
    cwdRuntimeRef.current = new TerminalCwdRuntime()
  }
  const cwdRuntime = cwdRuntimeRef.current
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const sessionSnapshot = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  sessionsRef.current = sessionSnapshot

  useEffect(() => {
    apiRef.current = api
    syncImportedFontFaces(api, terminalFontsRef.current)
  }, [api])

  useEffect(() => {
    themeRef.current = theme
    syncTerminalCssVariables(terminalSettingsRef.current, theme, terminalFontsRef.current)
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

  const getViewportForSession = useCallback((sessionId: string) => {
    const viewports = Array.from(viewportsRef.current.values()).filter((viewport) => (
      viewport.sessionId === sessionId && Boolean(viewport.host)
    ))
    return viewports.find((viewport) => viewport.active) ?? viewports[0] ?? null
  }, [])

  const sendResize = useCallback((entry: TerminalEntry) => {
    const { terminal, socket, lastSize } = entry
    if (terminal.cols === lastSize.cols && terminal.rows === lastSize.rows) {
      return
    }
    lastSize.cols = terminal.cols
    lastSize.rows = terminal.rows
    getViewportForSession(entry.sessionId)?.onResize?.(terminal.cols, terminal.rows)
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
  }, [getViewportForSession])

  const fitAndResize = useCallback(
    (entry: TerminalEntry, shouldFocus = false) => {
      window.requestAnimationFrame(() => {
        const viewport = getViewportForSession(entry.sessionId)
        if (entry.disposed || !viewport?.host) {
          return
        }
        try {
          entry.fit.fit()
        } catch {
          return
        }
        sendResize(entry)
        if (shouldFocus && activeSessionIdRef.current === entry.sessionId) {
          entry.terminal.focus()
        }
      })
    },
    [getViewportForSession, sendResize],
  )

  const fitAfterFontLoad = useCallback(
    (settings: TerminalSettings, fonts: TerminalFont[]) => {
      void loadTerminalFont(settings.font_family, fonts).then(() => {
        entriesRef.current.forEach((entry) => {
          fitAndResize(entry)
        })
      })
    },
    [fitAndResize],
  )

  const getEntry = useCallback((sessionId?: string) => {
    const targetSessionId = sessionId ?? activeSessionIdRef.current
    return targetSessionId ? entriesRef.current.get(targetSessionId) : undefined
  }, [])

  const isEntryEnded = useCallback((entry: TerminalEntry) => {
    return isEndedSessionStatus(sessionsRef.current.get(entry.sessionId)?.status)
  }, [])

  const applyEntrySessionState = useCallback(
    (entry: TerminalEntry) => {
      const ended = isEntryEnded(entry)
      entry.container.classList.toggle('is-terminal-ended', ended)
      if (ended) {
        entry.isReady = false
      }
    },
    [isEntryEnded],
  )

  const sendTextToSession = useCallback((sessionId: string, text: string, options?: { execute?: boolean }): TerminalSendResult => {
    const entry = entriesRef.current.get(sessionId)
    if (!entry) {
      return 'missing_session'
    }
    if (isEntryEnded(entry) || activeSessionIdRef.current !== sessionId || !entry.isReady || entry.socket.readyState !== WebSocket.OPEN) {
      return 'not_ready'
    }
    try {
      const payload = options?.execute ? ensureTerminalEnter(text) : text
      entry.socket.send(JSON.stringify({ type: 'input', data: payload }))
      entry.terminal.focus()
      return 'sent'
    } catch {
      return 'failed'
    }
  }, [isEntryEnded])

  const sendTextToActive = useCallback(
    (text: string, options?: { execute?: boolean }) => {
      const activeSessionId = activeSessionIdRef.current
      return activeSessionId ? sendTextToSession(activeSessionId, text, options) : 'missing_session'
    },
    [sendTextToSession],
  )

  const notifyClipboardError = useCallback(
    (translationKey: string) => {
      void message.error({
        content: tRef.current(translationKey),
        duration: 2,
        className: 'termous-message',
      })
    },
    [message],
  )

  const copyEntrySelection = useCallback(
    async (entry: TerminalEntry, options?: TerminalClipboardOptions): Promise<TerminalClipboardAction> => {
      if (!entry.terminal.hasSelection()) {
        return 'none'
      }
      const selectedText = entry.terminal.getSelection()
      if (!selectedText) {
        return 'empty'
      }
      try {
        await writeClipboardText(selectedText)
        if (options?.clearSelectionAfterCopy) {
          entry.terminal.clearSelection()
        }
        return 'copied'
      } catch {
        notifyClipboardError('terminal.copyFailed')
        return 'failed'
      }
    },
    [notifyClipboardError],
  )

  const pasteEntryClipboard = useCallback(
    async (entry: TerminalEntry): Promise<TerminalClipboardAction> => {
      if (isEntryEnded(entry)) {
        return 'none'
      }
      try {
        const text = await readClipboardText()
        if (!text) {
          return 'empty'
        }
        entry.terminal.paste(text)
        entry.terminal.focus()
        return 'pasted'
      } catch {
        notifyClipboardError('terminal.pasteFailed')
        return 'failed'
      }
    },
    [isEntryEnded, notifyClipboardError],
  )

  const copyActiveSelection = useCallback(async () => {
    const entry = getEntry()
    return entry ? copyEntrySelection(entry) : 'none'
  }, [copyEntrySelection, getEntry])

  const pasteActiveClipboard = useCallback(async () => {
    const entry = getEntry()
    return entry ? pasteEntryClipboard(entry) : 'none'
  }, [getEntry, pasteEntryClipboard])

  const copyOrPasteActive = useCallback(async (options?: TerminalClipboardOptions) => {
    const entry = getEntry()
    if (!entry) {
      return 'none'
    }
    if (entry.terminal.hasSelection()) {
      return copyEntrySelection(entry, options)
    }
    if (isEntryEnded(entry)) {
      return 'none'
    }
    return pasteEntryClipboard(entry)
  }, [copyEntrySelection, getEntry, isEntryEnded, pasteEntryClipboard])

  const searchActive = useCallback(
    (
      term: string,
      options: TerminalSearchOptions,
      direction: TerminalSearchDirection,
      sessionId?: string,
    ): TerminalSearchResult => {
      const entry = getEntry(sessionId)
      if (!entry || !term) {
        return emptySearchResult()
      }
      return runEntrySearch(entry, term, options, direction, terminalSettingsRef.current, themeRef.current)
    },
    [getEntry],
  )

  const clearActiveSearch = useCallback((sessionId?: string) => {
    const entry = getEntry(sessionId)
    if (!entry) {
      return
    }
    entry.search.clearDecorations()
    entry.terminal.clearSelection()
    entry.searchResult = emptySearchResult()
    entry.searchDecorationKey = ''
  }, [getEntry])

  useEffect(() => {
    const nextSettings = normalizeTerminalSettings(terminalSettings)
    const previousSettings = terminalSettingsRef.current
    terminalSettingsRef.current = nextSettings
    const shouldResize = shouldFitAfterSettingsChange(previousSettings, nextSettings)
    const fonts = terminalFontsRef.current
    syncImportedFontFaces(apiRef.current, fonts)
    syncTerminalCssVariables(nextSettings, themeRef.current, fonts)
    entriesRef.current.forEach((entry) => {
      applyTerminalSettings(entry.terminal, nextSettings, themeRef.current, fonts)
      if (shouldResize) {
        fitAndResize(entry)
      }
    })
    if (shouldResize) {
      fitAfterFontLoad(nextSettings, fonts)
    }
  }, [fitAfterFontLoad, fitAndResize, terminalSettings])

  useEffect(() => {
    terminalFontsRef.current = terminalFonts
    syncImportedFontFaces(apiRef.current, terminalFonts)
    const settings = terminalSettingsRef.current
    syncTerminalCssVariables(settings, themeRef.current, terminalFonts)
    entriesRef.current.forEach((entry) => {
      applyTerminalSettings(entry.terminal, settings, themeRef.current, terminalFonts)
      fitAndResize(entry)
    })
    fitAfterFontLoad(settings, terminalFonts)
  }, [fitAfterFontLoad, fitAndResize, terminalFonts])

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
      const search = new SearchAddon({ highlightLimit: 2000 })
      const terminal = createTerminal(themeRef.current, terminalSettingsRef.current, terminalFontsRef.current)
      terminal.loadAddon(fit)
      terminal.loadAddon(search)
      terminal.open(pane)
      const helperInput = pane.querySelector('.xterm-helper-textarea')
      if (helperInput instanceof HTMLTextAreaElement) {
        helperInput.name = `terminal-input-${sessionId}`
      }

      const entry: TerminalEntry = {
        sessionId,
        terminal,
        fit,
        search,
        searchResult: emptySearchResult(),
        searchDecorationKey: '',
        socket,
        container: pane,
        disposables: [],
        lastSize: { cols: 0, rows: 0 },
        resizeTimer: null,
        disposed: false,
        isReady: false,
      }
      entriesRef.current.set(sessionId, entry)
      const relaySessionEvent = (targetSessionId: string, patch: Partial<Session>) => {
        const existing = sessionsRef.current.get(targetSessionId)
        if (existing) {
          sessionsRef.current.set(targetSessionId, { ...existing, ...patch })
        } else if (patch.id) {
          sessionsRef.current.set(targetSessionId, patch as Session)
        }
        onSessionEventRef.current?.(targetSessionId, patch)
      }
      const sendTerminalInput = (data: string | Uint8Array) => {
        const viewport = getViewportForSession(sessionId)
        if (entry.disposed || isEntryEnded(entry) || !entry.isReady || socket.readyState !== WebSocket.OPEN || !viewport?.host) {
          return
        }
        if (typeof data === 'string') {
          socket.send(JSON.stringify({ type: 'input', data }))
          return
        }
        const payload = new ArrayBuffer(data.byteLength)
        new Uint8Array(payload).set(data)
        socket.send(payload)
      }
      const handleClipboardKey = (event: KeyboardEvent) => {
        const key = event.key.toLowerCase()
        const hasClipboardModifier = event.ctrlKey || event.metaKey
        if (!hasClipboardModifier || event.altKey) {
          return
        }
        if (key === 'c' && terminal.hasSelection()) {
          event.preventDefault()
          event.stopPropagation()
          void copyEntrySelection(entry)
          return
        }
        if (isEntryEnded(entry)) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (key === 'c') {
          event.preventDefault()
          event.stopPropagation()
          sendTerminalInput('\x03')
          return
        }
        if (key === 'v') {
          event.preventDefault()
          event.stopPropagation()
          void pasteEntryClipboard(entry)
        }
      }
      const handleCopyEvent = (event: ClipboardEvent) => {
        event.preventDefault()
        event.stopPropagation()
        if (terminal.hasSelection()) {
          const selectedText = terminal.getSelection()
          if (selectedText && event.clipboardData) {
            event.clipboardData.setData('text/plain', selectedText)
          } else {
            void copyEntrySelection(entry)
          }
          return
        }
        if (isEntryEnded(entry)) {
          return
        }
        sendTerminalInput('\x03')
      }
      const handlePasteEvent = (event: ClipboardEvent) => {
        event.preventDefault()
        event.stopPropagation()
        if (isEntryEnded(entry)) {
          return
        }
        const text = event.clipboardData?.getData('text/plain')
        if (text) {
          terminal.paste(text)
          terminal.focus()
          return
        }
        void pasteEntryClipboard(entry)
      }
      pane.addEventListener('keydown', handleClipboardKey, true)
      pane.addEventListener('copy', handleCopyEvent, true)
      pane.addEventListener('paste', handlePasteEvent, true)
      entry.disposables.push({
        dispose: () => {
          pane.removeEventListener('keydown', handleClipboardKey, true)
          pane.removeEventListener('copy', handleCopyEvent, true)
          pane.removeEventListener('paste', handlePasteEvent, true)
        },
      })

      entry.disposables.push(
        terminal.onData((data) => {
          sendTerminalInput(data)
        }),
        terminal.onBinary((data) => {
          sendTerminalInput(binaryStringToBytes(data))
        }),
      )
      entry.disposables.push(
        terminal.parser.registerOscHandler(7, (payload) => {
          const observation = parseOSC7Payload(payload)
          return observation
            ? cwdRuntime.observeTerminalPath(sessionId, observation)
            : false
        }),
        terminal.parser.registerOscHandler(TERMOUS_CWD_PRIVATE_OSC, (payload) => {
          const observation = parsePrivateCwdPayload(payload)
          return observation
            ? cwdRuntime.observePrivateControl(sessionId, observation)
            : false
        }),
      )
      const unregisterCwdTransport = cwdRuntime.registerTransport(sessionId, (request) => {
        if (
          entry.disposed ||
          isEntryEnded(entry) ||
          !entry.isReady ||
          socket.readyState !== WebSocket.OPEN
        ) {
          return false
        }
        try {
          socket.send(JSON.stringify({
            type: 'cwd_change',
            cwd_change: request,
          }))
          return true
        } catch {
          return false
        }
      })
      entry.disposables.push({ dispose: unregisterCwdTransport })

      socket.addEventListener('open', () => {
        if (isEntryEnded(entry)) {
          closeSocket(socket)
          applyEntrySessionState(entry)
          return
        }
        entry.isReady = true
        if (activeSessionIdRef.current === sessionId) {
          fitAndResize(entry, true)
        }
      })
      socket.addEventListener('message', (event) => {
        if (entry.disposed) {
          return
        }
        handleSocketMessage(
          entry,
          String(event.data),
          relaySessionEvent,
          (state) => cwdRuntime.applyServerState(sessionId, state),
          (message, operationId) => {
            cwdRuntime.applyRequestError(sessionId, message, operationId)
          },
          tRef.current,
        )
        applyEntrySessionState(entry)
      })
      socket.addEventListener('close', () => {
        if (!entry.disposed) {
          const currentStatus = sessionsRef.current.get(sessionId)?.status
          if (!isEndedSessionStatus(currentStatus)) {
            relaySessionEvent(sessionId, {
              status: 'disconnected',
              phase: 'disconnected',
              status_message: tRef.current('status.disconnected'),
            })
          }
          applyEntrySessionState(entry)
        }
      })
      socket.addEventListener('error', () => {
        relaySessionEvent(sessionId, {
          status: 'failed',
          phase: 'failed',
          progress: 100,
          status_message: tRef.current('app.apiOffline'),
          last_error: tRef.current('app.apiOffline'),
        })
        applyEntrySessionState(entry)
      })

      return entry
    },
    [
      applyEntrySessionState,
      closeSocket,
      copyEntrySelection,
      cwdRuntime,
      fitAndResize,
      getViewportForSession,
      isEntryEnded,
      pasteEntryClipboard,
    ],
  )

  const moveEntryToHost = useCallback((entry: TerminalEntry, host: HTMLDivElement | null, active: boolean, visible: boolean) => {
    const targetHost = host ?? parkingHostRef.current
    if (targetHost && entry.container.parentElement !== targetHost) {
      targetHost.appendChild(entry.container)
    }
    entry.container.classList.toggle('is-active', active && visible)
    entry.container.classList.toggle('is-inactive', !visible)
  }, [])

  const syncViewports = useCallback(() => {
    const visibleViewports = new Map<string, ViewportState>()
    let activeSessionId: string | null = null

    viewportsRef.current.forEach((viewport) => {
      if (!viewport.sessionId || !viewport.host || visibleViewports.has(viewport.sessionId)) {
        return
      }
      visibleViewports.set(viewport.sessionId, viewport)
      if (viewport.active) {
        activeSessionId = viewport.sessionId
      }
    })

    activeSessionIdRef.current = activeSessionId ?? visibleViewports.values().next().value?.sessionId ?? null

    entriesRef.current.forEach((entry) => {
      const viewport = visibleViewports.get(entry.sessionId)
      moveEntryToHost(entry, viewport?.host ?? null, entry.sessionId === activeSessionIdRef.current, Boolean(viewport?.host))
    })

    visibleViewports.forEach((viewport, sessionId) => {
      const existingEntry = entriesRef.current.get(sessionId)
      if (!existingEntry && isEndedSessionStatus(sessionsRef.current.get(sessionId)?.status)) {
        return
      }
      const entry = existingEntry ?? createEntry(sessionId)
      moveEntryToHost(entry, viewport.host, sessionId === activeSessionIdRef.current, true)
      fitAndResize(entry, sessionId === activeSessionIdRef.current && !isEndedSessionStatus(sessionsRef.current.get(sessionId)?.status))
    })
  }, [createEntry, fitAndResize, moveEntryToHost])

  const registerViewport = useCallback(
    ({ viewportId = 'default', sessionId, host, active = true, onResize }: TerminalViewportOptions) => {
      viewportsRef.current.set(viewportId, { viewportId, sessionId, host, active, onResize })
      syncViewports()
      return () => {
        const current = viewportsRef.current.get(viewportId)
        if (current?.host === host) {
          viewportsRef.current.delete(viewportId)
          syncViewports()
        }
      }
    },
    [syncViewports],
  )

  const focusActive = useCallback(() => {
    const activeSessionId = activeSessionIdRef.current
    if (!activeSessionId) {
      return
    }
    const entry = entriesRef.current.get(activeSessionId)
    if (!entry || isEntryEnded(entry)) {
      return
    }
    entry.terminal.focus()
  }, [isEntryEnded])

  const scheduleSessionResize = useCallback((sessionId: string) => {
    const viewport = getViewportForSession(sessionId)
    if (!viewport?.host) {
      return
    }
    const entry = entriesRef.current.get(sessionId)
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
  }, [fitAndResize, getViewportForSession])

  const scheduleActiveResize = useCallback(() => {
    const activeSessionId = activeSessionIdRef.current
    if (!activeSessionId) {
      return
    }
    scheduleSessionResize(activeSessionId)
  }, [scheduleSessionResize])

  useEffect(() => {
    const allowedSessionIds = new Set(sessions.map((session) => session.id))
    Array.from(entriesRef.current.values()).forEach((entry) => {
      if (!allowedSessionIds.has(entry.sessionId)) {
        disposeEntry(entry)
        return
      }
      applyEntrySessionState(entry)
    })
    cwdRuntime.retainSessions(allowedSessionIds)
    syncViewports()
  }, [applyEntrySessionState, cwdRuntime, disposeEntry, sessions, syncViewports])

  useEffect(() => {
    return () => {
      disposeAll()
      cwdRuntime.dispose()
    }
  }, [api, cwdRuntime, disposeAll])

  const value = useMemo<TerminalRuntimeContextValue>(
    () => ({
      registerViewport,
      focusActive,
      resizeActive: scheduleActiveResize,
      resizeSession: scheduleSessionResize,
      disposeSession,
      disposeAll,
      searchActive,
      clearActiveSearch,
      copyActiveSelection,
      pasteActiveClipboard,
      copyOrPasteActive,
      sendTextToSession,
      sendTextToActive,
    }),
    [
      clearActiveSearch,
      copyActiveSelection,
      copyOrPasteActive,
      disposeAll,
      disposeSession,
      focusActive,
      pasteActiveClipboard,
      registerViewport,
      scheduleActiveResize,
      scheduleSessionResize,
      searchActive,
      sendTextToActive,
      sendTextToSession,
    ],
  )

  return (
    <TerminalCwdRuntimeProvider runtime={cwdRuntime}>
      <TerminalRuntimeContext.Provider value={value}>
        {children}
        <div className="terminal-runtime-parking" ref={parkingHostRef} aria-hidden="true" />
      </TerminalRuntimeContext.Provider>
    </TerminalCwdRuntimeProvider>
  )
}

function createTerminal(theme: ThemeMode, settings: TerminalSettings = defaultTerminalSettings, fonts: TerminalFont[] = []) {
  const normalizedSettings = normalizeTerminalSettings(settings)
  return new Terminal({
    allowProposedApi: true,
    cursorBlink: normalizedSettings.cursor_blink,
    cursorStyle: normalizedSettings.cursor_style,
    fontFamily: fontFamilyFromSetting(normalizedSettings.font_family, fonts),
    fontSize: normalizedSettings.font_size,
    letterSpacing: normalizedSettings.letter_spacing,
    lineHeight: normalizedSettings.line_height,
    scrollback: normalizedSettings.scrollback,
    theme: terminalTheme(normalizedSettings, theme),
  })
}

function applyTerminalSettings(terminal: Terminal, settings: TerminalSettings, appTheme: ThemeMode, fonts: TerminalFont[] = []) {
  const normalizedSettings = normalizeTerminalSettings(settings)
  terminal.options.cursorBlink = normalizedSettings.cursor_blink
  terminal.options.cursorStyle = normalizedSettings.cursor_style
  terminal.options.fontFamily = fontFamilyFromSetting(normalizedSettings.font_family, fonts)
  terminal.options.fontSize = normalizedSettings.font_size
  terminal.options.letterSpacing = normalizedSettings.letter_spacing
  terminal.options.lineHeight = normalizedSettings.line_height
  terminal.options.scrollback = normalizedSettings.scrollback
  terminal.options.theme = terminalTheme(normalizedSettings, appTheme)
}

function syncTerminalCssVariables(settings: TerminalSettings, appTheme: ThemeMode, fonts: TerminalFont[] = []) {
  const normalizedSettings = normalizeTerminalSettings(settings)
  const theme = terminalTheme(normalizedSettings, appTheme)
  const root = document.documentElement
  root.style.setProperty('--terminal-font-family', fontFamilyFromSetting(normalizedSettings.font_family, fonts))
  root.style.setProperty('--terminal-font-size', `${normalizedSettings.font_size}px`)
  root.style.setProperty('--terminal-line-height', String(normalizedSettings.line_height))
  root.style.setProperty('--terminal-letter-spacing', `${normalizedSettings.letter_spacing}px`)
  root.style.setProperty('--terminal-bg', theme.background ?? '#080a0f')
  root.style.setProperty('--terminal-fg', theme.foreground ?? '#e6ebf4')
  root.style.setProperty('--terminal-cursor', theme.cursor ?? '#61a8ff')
  root.style.setProperty('--terminal-selection-bg', theme.selectionBackground ?? '#24476d')
}

function shouldFitAfterSettingsChange(previous: TerminalSettings, next: TerminalSettings) {
  return (
    previous.font_family !== next.font_family ||
    previous.font_size !== next.font_size ||
    previous.line_height !== next.line_height ||
    previous.letter_spacing !== next.letter_spacing
  )
}

function handleSocketMessage(
  entry: TerminalEntry,
  data: string,
  onSessionEvent: TerminalRuntimeProviderProps['onSessionEvent'],
  onCwdState: (state: SessionCwdState) => void,
  onCwdError: (message: string, operationId?: string) => void,
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
      session?: Session
      cwd_change?: SessionCwdChangeRequest
      cwd_state?: SessionCwdState
    }
    if (msg.session) {
      onSessionEvent?.(entry.sessionId, msg.session)
    } else if (msg.type === 'status' || msg.type === 'phase' || msg.type === 'ready' || msg.type === 'inventory') {
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
    if (msg.type === 'cwd_state' && msg.cwd_state) {
      onCwdState(msg.cwd_state)
    }
    if (msg.type === 'cwd_error' && msg.message) {
      onCwdError(msg.message, msg.cwd_change?.operation_id)
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

function runEntrySearch(
  entry: TerminalEntry,
  term: string,
  options: TerminalSearchOptions,
  direction: TerminalSearchDirection,
  settings: TerminalSettings,
  appTheme: ThemeMode,
): TerminalSearchResult {
  if (options.regex && !isValidRegexTerm(term, options.caseSensitive)) {
    resetEntrySearch(entry)
    return { ...emptySearchResult(), error: 'invalid_regex' }
  }

  const decorationKey = terminalSearchDecorationKey(settings, appTheme)
  const searchOptions = {
    caseSensitive: options.caseSensitive,
    regex: options.regex,
    decorations: terminalSearchDecorations(settings, appTheme),
  }
  if (entry.searchDecorationKey && entry.searchDecorationKey !== decorationKey) {
    resetEntrySearch(entry)
  }

  let nextResult: TerminalSearchResult | null = null
  const disposable = entry.search.onDidChangeResults((event) => {
    nextResult = normalizeSearchEventResult(event.resultIndex, event.resultCount)
  })

  try {
    const found = direction === 'previous'
      ? entry.search.findPrevious(term, searchOptions)
      : entry.search.findNext(term, searchOptions)
    entry.searchDecorationKey = decorationKey
    entry.searchResult = found
      ? nextResult ?? {
        found: true,
        resultIndex: Math.max(entry.searchResult.resultIndex, 0),
        resultCount: Math.max(entry.searchResult.resultCount, 1),
      }
      : emptySearchResult()
    return entry.searchResult
  } catch {
    resetEntrySearch(entry)
    return emptySearchResult()
  } finally {
    disposable.dispose()
  }
}

function resetEntrySearch(entry: TerminalEntry) {
  entry.search.clearDecorations()
  entry.terminal.clearSelection()
  entry.searchResult = emptySearchResult()
  entry.searchDecorationKey = ''
}

function isValidRegexTerm(term: string, caseSensitive: boolean) {
  try {
    new RegExp(term, caseSensitive ? 'g' : 'gi')
    return true
  } catch {
    return false
  }
}

function normalizeSearchEventResult(resultIndex: number, resultCount: number): TerminalSearchResult {
  if (resultCount <= 0) {
    return emptySearchResult()
  }
  return {
    found: resultIndex >= 0,
    resultIndex,
    resultCount,
  }
}

function terminalSearchDecorationKey(settings: TerminalSettings, appTheme: ThemeMode) {
  return settings.theme_mode === 'follow_app' ? appTheme : settings.theme_mode
}

function terminalSearchDecorations(settings: TerminalSettings, appTheme: ThemeMode) {
  const theme = terminalSearchDecorationKey(settings, appTheme)
  if (theme === 'light') {
    return {
      matchBackground: '#f6dfa2',
      matchBorder: '#d6b461',
      matchOverviewRuler: '#c79836',
      activeMatchBackground: '#e8b23d',
      activeMatchBorder: '#ad7415',
      activeMatchColorOverviewRuler: '#ad7415',
    }
  }
  return {
    matchBackground: '#4a3b1e',
    matchBorder: '#806836',
    matchOverviewRuler: '#b9842d',
    activeMatchBackground: '#d9a441',
    activeMatchBorder: '#f2cc72',
    activeMatchColorOverviewRuler: '#f2cc72',
  }
}

function emptySearchResult(): TerminalSearchResult {
  return {
    found: false,
    resultIndex: -1,
    resultCount: 0,
  }
}

function isEndedSessionStatus(status?: SessionStatus) {
  return status === 'disconnected' || status === 'failed'
}

async function readClipboardText() {
  if (window.termous?.clipboard?.readText) {
    return window.termous.clipboard.readText()
  }
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText()
  }
  throw new Error('clipboard read unavailable')
}

async function writeClipboardText(text: string) {
  if (window.termous?.clipboard?.writeText) {
    await window.termous.clipboard.writeText(text)
    return
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  if (fallbackCopyText(text)) {
    return
  }
  throw new Error('clipboard write unavailable')
}

function fallbackCopyText(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

function binaryStringToBytes(data: string) {
  const bytes = new Uint8Array(data.length)
  for (let index = 0; index < data.length; index += 1) {
    bytes[index] = data.charCodeAt(index) & 0xff
  }
  return bytes
}

function ensureTerminalEnter(text: string) {
  return /\r?\n$/.test(text) ? text : `${text}\r`
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

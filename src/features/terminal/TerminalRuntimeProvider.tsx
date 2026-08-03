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
  CompletionSettings,
  Session,
  SessionCwdState,
  SessionStatus,
  TerminalFont,
  TerminalSettings,
  ThemeMode,
} from '../../types/domain'
import {
  completionProviderSettingsSignature,
  defaultTerminalSettings,
  hasEnabledCompletionProvider,
  normalizeTerminalSettings,
} from '../settings/terminalSettings'
import {
  TerminalRuntimeContext,
  type TerminalRuntimeContextValue,
  type TerminalClipboardAction,
  type TerminalCompletionCursorGeometry,
  type TerminalCompletionRetryResult,
  type TerminalSearchDirection,
  type TerminalSearchOptions,
  type TerminalSearchResult,
  type TerminalSendResult,
  type TerminalViewportOptions,
} from './terminalRuntimeContext'
import {
  captureTerminalPointerTarget,
  classifyTerminalContextValue,
  normalizeTerminalSearchSeed,
  type TerminalContextPointer,
  type TerminalContextSelectionRange,
  type TerminalContextSnapshot,
} from './terminalContextTarget'
import {
  TerminalCwdRuntime,
  type SessionCwdRequestError,
} from './terminalCwdRuntime'
import {
  TerminalCompletionRuntime,
  type TerminalCompletionExpectedSelection,
  type TerminalCompletionQueryExecutor,
} from './terminalCompletionRuntime'
import {
  isPredictableTerminalCompletionText,
  predictTerminalCompletionCursor,
} from './terminalCompletionPosition'
import { transitionTerminalCompletionActivity } from './terminalCompletionViewport'
import { fontFamilyFromSetting, loadTerminalFont, syncImportedFontFaces } from './terminalFonts'
import type { TerminalPromptBoundary } from './terminalProtocol'
import {
  TerminalTransport,
  type TerminalTransportEvent,
  type TerminalTransportState,
} from './terminalTransport'

const terminalTextEncoder = new TextEncoder()

interface TerminalRuntimeProviderProps {
  api: TermousApi
  sessions: Session[]
  theme: ThemeMode
  terminalSettings: TerminalSettings
  completionSettings: CompletionSettings
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
  transport: TerminalTransport
  transportState: TerminalTransportState
  container: HTMLDivElement
  disposables: Array<{ dispose: () => void }>
  lastSize: { cols: number; rows: number }
  resizeTimer: number | null
  suppressCompletionInput: boolean
  completionPromptAnchor: CompletionPromptAnchor | null
  disposed: boolean
}

interface CompletionPromptAnchor {
  sourceGeneration: number
  shellId: string
  promptGeneration: number
  inputEpoch: number
  cursorX: number
  cursorY: number
}

interface ViewportState {
  viewportId: string
  sessionId: string | null
  host: HTMLDivElement | null
  active: boolean
  completionActive: boolean
  completionVisible: boolean
  onResize?: (cols: number, rows: number) => void
}

interface CompletionStatusReconciliation {
  attempt: number
  controller?: AbortController
  timer?: number
  refreshPromise?: Promise<TerminalCompletionRetryResult>
}

const completionStatusRetryDelays = [0, 1_000, 2_000, 4_000, 8_000, 16_000, 18_000]

export function TerminalRuntimeProvider({
  api,
  sessions,
  theme,
  terminalSettings,
  completionSettings,
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
  const completionProvidersSignature = completionProviderSettingsSignature(
    completionSettings.providers,
  )
  const completionProvidersEnabled = hasEnabledCompletionProvider(completionSettings.providers)
  const completionProvidersSignatureRef = useRef(completionProvidersSignature)
  const completionQueryExecutor = useCallback<TerminalCompletionQueryExecutor>(
    (sessionId, query, signal) => (
      apiRef.current.querySessionCompletions(sessionId, query, { signal })
    ),
    [],
  )
  const completionRuntimeRef = useRef<TerminalCompletionRuntime | null>(null)
  if (!completionRuntimeRef.current) {
    completionRuntimeRef.current = new TerminalCompletionRuntime(completionSettings.enabled, {
      query: completionProvidersEnabled ? completionQueryExecutor : undefined,
    })
  }
  const completionRuntime = completionRuntimeRef.current
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const completionLayoutListenersRef = useRef(new Map<string, Set<() => void>>())
  const completionStatusReconciliationsRef = useRef(
    new Map<string, CompletionStatusReconciliation>(),
  )
  const sessionSnapshot = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  sessionsRef.current = sessionSnapshot

  const stopCompletionStatusReconciliation = useCallback((sessionId: string) => {
    const reconciliation = completionStatusReconciliationsRef.current.get(sessionId)
    if (!reconciliation) {
      return
    }
    reconciliation.controller?.abort()
    if (reconciliation.timer !== undefined) {
      window.clearTimeout(reconciliation.timer)
    }
    completionStatusReconciliationsRef.current.delete(sessionId)
  }, [])

  const startCompletionStatusReconciliation = useCallback((sessionId: string) => {
    stopCompletionStatusReconciliation(sessionId)
    const session = sessionsRef.current.get(sessionId)
    const entry = entriesRef.current.get(sessionId)
    const snapshot = completionRuntime.getSnapshot(sessionId)
    if (
      session?.kind !== 'ssh'
      || session.status !== 'connected'
      || !entry
      || entry.disposed
      || !entry.transport.isLive()
      || snapshot.readiness === 'disabled'
      || snapshot.boundary !== null
    ) {
      return
    }

    const reconciliation: CompletionStatusReconciliation = { attempt: 0 }
    completionStatusReconciliationsRef.current.set(sessionId, reconciliation)

    const isCurrent = () => (
      completionStatusReconciliationsRef.current.get(sessionId) === reconciliation
    )
    const finish = () => {
      if (isCurrent()) {
        completionStatusReconciliationsRef.current.delete(sessionId)
      }
    }
    const scheduleNext = () => {
      if (!isCurrent() || reconciliation.attempt >= completionStatusRetryDelays.length) {
        if (isCurrent()) {
          const currentEntry = entriesRef.current.get(sessionId)
          const currentSnapshot = completionRuntime.getSnapshot(sessionId)
          if (
            currentEntry
            && !currentEntry.disposed
            && currentEntry.transport.isLive()
            && currentSnapshot.readiness !== 'disabled'
            && currentSnapshot.boundary === null
          ) {
            completionRuntime.markPromptObservationUnavailable(sessionId)
          }
        }
        finish()
        return
      }
      const delay = completionStatusRetryDelays[reconciliation.attempt] ?? 0
      reconciliation.attempt += 1
      if (delay === 0) {
        void poll()
        return
      }
      reconciliation.timer = window.setTimeout(() => {
        reconciliation.timer = undefined
        void poll()
      }, delay)
    }
    const poll = async () => {
      if (!isCurrent()) {
        return
      }
      const currentEntry = entriesRef.current.get(sessionId)
      const currentSnapshot = completionRuntime.getSnapshot(sessionId)
      if (
        !currentEntry
        || currentEntry.disposed
        || !currentEntry.transport.isLive()
        || currentSnapshot.readiness === 'disabled'
        || currentSnapshot.boundary !== null
      ) {
        finish()
        return
      }

      const controller = new AbortController()
      reconciliation.controller = controller
      try {
        const status = await apiRef.current.sessionCompletionStatus(sessionId, {
          signal: controller.signal,
        })
        if (!isCurrent() || controller.signal.aborted) {
          return
        }
        reconciliation.controller = undefined
        completionRuntime.applyStatus(sessionId, status)
        if (
          status.prompt_observation.status === 'waiting'
          || status.prompt_observation.status === 'preparing'
          || (
            status.prompt_observation.status === 'degraded'
            && status.prompt_observation.retryable === true
          )
        ) {
          scheduleNext()
        } else {
          finish()
        }
      } catch {
        if (!isCurrent() || controller.signal.aborted) {
          return
        }
        reconciliation.controller = undefined
        scheduleNext()
      }
    }

    scheduleNext()
  }, [completionRuntime, stopCompletionStatusReconciliation])

  const retrySessionCompletion = useCallback((sessionId: string) => {
    const existing = completionStatusReconciliationsRef.current.get(sessionId)
    if (existing?.refreshPromise) {
      return existing.refreshPromise
    }
    stopCompletionStatusReconciliation(sessionId)
    const entry = entriesRef.current.get(sessionId)
    const session = sessionsRef.current.get(sessionId)
    const snapshot = completionRuntime.getSnapshot(sessionId)
    if (
      session?.kind !== 'ssh'
      || session.status !== 'connected'
      || !entry
      || entry.disposed
      || !entry.transport.isLive()
      || snapshot.readiness === 'disabled'
      || snapshot.promptObservation.retryable !== true
    ) {
      return Promise.resolve<TerminalCompletionRetryResult>('cancelled')
    }

    const controller = new AbortController()
    const reconciliation: CompletionStatusReconciliation = {
      attempt: 0,
      controller,
    }
    const hasRecoveredPrompt = () => {
      const latest = completionRuntime.getSnapshot(sessionId)
      return latest.readiness === 'ready' && latest.boundary !== null
    }
    completionStatusReconciliationsRef.current.set(sessionId, reconciliation)
    const refreshPromise: Promise<TerminalCompletionRetryResult> = apiRef.current.refreshSessionCompletions(sessionId, {
      signal: controller.signal,
    }).then((status) => {
      if (
        controller.signal.aborted
        || completionStatusReconciliationsRef.current.get(sessionId) !== reconciliation
      ) {
        return hasRecoveredPrompt() ? 'succeeded' : 'cancelled'
      }
      reconciliation.controller = undefined
      completionStatusReconciliationsRef.current.delete(sessionId)
      completionRuntime.applyStatus(sessionId, status)
      if (
        status.prompt_observation.status === 'waiting'
        || status.prompt_observation.status === 'preparing'
        || (
          status.prompt_observation.status === 'degraded'
          && status.prompt_observation.retryable === true
        )
      ) {
        startCompletionStatusReconciliation(sessionId)
      }
      return 'succeeded'
    }).catch(() => {
      const interrupted = controller.signal.aborted
        || completionStatusReconciliationsRef.current.get(sessionId) !== reconciliation
      if (!interrupted) {
        completionStatusReconciliationsRef.current.delete(sessionId)
      }
      if (hasRecoveredPrompt()) {
        return 'succeeded'
      }
      return interrupted ? 'cancelled' : 'failed'
    })
    reconciliation.refreshPromise = refreshPromise
    return refreshPromise
  }, [
    completionRuntime,
    startCompletionStatusReconciliation,
    stopCompletionStatusReconciliation,
  ])

  useEffect(() => {
    apiRef.current = api
    syncImportedFontFaces(api, terminalFontsRef.current)
  }, [api])

  useEffect(() => {
    if (completionProvidersSignatureRef.current === completionProvidersSignature) {
      return
    }
    completionProvidersSignatureRef.current = completionProvidersSignature
    completionRuntime.invalidateProviderConfiguration()
  }, [completionProvidersSignature, completionRuntime])

  useEffect(() => {
    completionRuntime.setQueryExecutor(
      completionProvidersEnabled ? completionQueryExecutor : undefined,
    )
  }, [completionProvidersEnabled, completionQueryExecutor, completionRuntime])

  useEffect(() => {
    completionRuntime.setEnabled(completionSettings.enabled)
    if (!completionSettings.enabled) {
      for (const sessionId of completionStatusReconciliationsRef.current.keys()) {
        stopCompletionStatusReconciliation(sessionId)
      }
      return
    }
    for (const entry of entriesRef.current.values()) {
      if (entry.transport.isLive()) {
        startCompletionStatusReconciliation(entry.sessionId)
      }
    }
  }, [
    completionRuntime,
    completionSettings.enabled,
    startCompletionStatusReconciliation,
    stopCompletionStatusReconciliation,
  ])

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

  const disposeEntry = useCallback(
    (entry: TerminalEntry) => {
      if (entry.disposed) {
        return
      }
      cwdRuntime.applyTransportState(entry.sessionId, 'disposed')
      stopCompletionStatusReconciliation(entry.sessionId)
      completionRuntime.disposeSession(entry.sessionId)
      entry.disposed = true
      if (entry.resizeTimer) {
        window.clearTimeout(entry.resizeTimer)
        entry.resizeTimer = null
      }
      entry.disposables.forEach((disposable) => disposable.dispose())
      entry.transport.dispose()
      entry.terminal.dispose()
      entry.container.remove()
      entriesRef.current.delete(entry.sessionId)
      completionLayoutListenersRef.current.delete(entry.sessionId)
    },
    [completionRuntime, cwdRuntime, stopCompletionStatusReconciliation],
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

  const isCompletionInteractionActive = useCallback((sessionId: string) => {
    const viewport = getViewportForSession(sessionId)
    return Boolean(
      viewport?.active
      && viewport.completionActive
      && viewport.completionVisible
      && viewport.host?.isConnected
      && activeSessionIdRef.current === sessionId,
    )
  }, [getViewportForSession])

  const setViewportCompletionActive = useCallback((
    viewportId: string,
    sessionId: string | null,
    active: boolean,
  ) => {
    const viewport = viewportsRef.current.get(viewportId)
    if (!viewport) {
      return
    }
    const transition = transitionTerminalCompletionActivity(
      viewport.sessionId,
      viewport.completionActive,
      sessionId,
      active,
    )
    if (!transition.changed) {
      return
    }
    viewport.completionActive = transition.active
    if (transition.closeSessionId) {
      completionRuntime.closeSuggestions(transition.closeSessionId)
    }
  }, [completionRuntime])

  const setViewportCompletionVisible = useCallback((
    viewportId: string,
    sessionId: string | null,
    visible: boolean,
  ) => {
    const viewport = viewportsRef.current.get(viewportId)
    if (!viewport || viewport.sessionId !== sessionId) {
      return
    }
    viewport.completionVisible = visible
  }, [])

  const emitCompletionLayout = useCallback((sessionId: string) => {
    completionLayoutListenersRef.current.get(sessionId)?.forEach((listener) => listener())
  }, [])

  const subscribeSessionCompletionLayout = useCallback((
    sessionId: string,
    listener: () => void,
  ) => {
    const listeners = completionLayoutListenersRef.current.get(sessionId) ?? new Set<() => void>()
    listeners.add(listener)
    completionLayoutListenersRef.current.set(sessionId, listeners)
    return () => {
      const current = completionLayoutListenersRef.current.get(sessionId)
      current?.delete(listener)
      if (current?.size === 0) {
        completionLayoutListenersRef.current.delete(sessionId)
      }
    }
  }, [])

  const captureSessionCompletionCursor = useCallback((
    sessionId: string,
  ): TerminalCompletionCursorGeometry | null => {
    const entry = entriesRef.current.get(sessionId)
    const viewport = getViewportForSession(sessionId)
    if (
      !entry
      || entry.disposed
      || !viewport?.active
      || !viewport.host?.isConnected
      || entry.terminal.buffer.active.type !== 'normal'
    ) {
      return null
    }
    const buffer = entry.terminal.buffer.active
    if (buffer.viewportY !== buffer.baseY) {
      return null
    }
    const screen = entry.container.querySelector('.xterm-screen')
    if (!(screen instanceof HTMLElement)) {
      return null
    }
    const rect = screen.getBoundingClientRect()
    if (
      rect.width <= 0
      || rect.height <= 0
      || entry.terminal.cols <= 0
      || entry.terminal.rows <= 0
    ) {
      return null
    }
    const completion = completionRuntime.getSnapshot(sessionId)
    const anchor = entry.completionPromptAnchor
    const anchorMatchesBoundary = Boolean(
      anchor
      && completion.boundary
      && completion.input.trust === 'trusted'
      && !completion.input.composing
      && matchesCompletionPromptAnchor(anchor, completion.boundary),
    )
    const prediction = anchorMatchesBoundary && anchor
      ? predictTerminalCompletionCursor({
        anchorX: anchor.cursorX,
        anchorY: anchor.cursorY,
        columns: entry.terminal.cols,
        rows: entry.terminal.rows,
        line: completion.input.line,
        cursorUtf16: completion.input.cursorUtf16,
      })
      : null
    const inputBeforeCursor = completion.input.line.slice(0, completion.input.cursorUtf16)
    if (
      anchorMatchesBoundary
      && anchor
      && inputBeforeCursor.length > 0
      && !isPredictableTerminalCompletionText(inputBeforeCursor)
      && buffer.cursorX === anchor.cursorX
      && buffer.cursorY === anchor.cursorY
    ) {
      return null
    }
    return {
      screenRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      cursorX: prediction?.cursorX ?? buffer.cursorX,
      cursorY: prediction?.cursorY ?? buffer.cursorY,
      columns: entry.terminal.cols,
      rows: entry.terminal.rows,
    }
  }, [completionRuntime, getViewportForSession])

  const sendResize = useCallback((entry: TerminalEntry) => {
    const { terminal, lastSize } = entry
    if (terminal.cols === lastSize.cols && terminal.rows === lastSize.rows) {
      return
    }
    lastSize.cols = terminal.cols
    lastSize.rows = terminal.rows
    getViewportForSession(entry.sessionId)?.onResize?.(terminal.cols, terminal.rows)
    entry.transport.sendResize(terminal.cols, terminal.rows)
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

  const isEntryWritable = useCallback((entry: TerminalEntry) => {
    return sessionsRef.current.get(entry.sessionId)?.status === 'connected'
  }, [])

  const applyEntrySessionState = useCallback(
    (entry: TerminalEntry) => {
      const ended = isEntryEnded(entry)
      entry.container.classList.toggle('is-terminal-ended', ended)
    },
    [isEntryEnded],
  )

  const sendTextToSession = useCallback((sessionId: string, text: string, options?: { execute?: boolean }): TerminalSendResult => {
    const entry = entriesRef.current.get(sessionId)
    if (!entry) {
      return 'missing_session'
    }
    if (
      !isEntryWritable(entry) ||
      activeSessionIdRef.current !== sessionId ||
      !entry.transport.isLive()
    ) {
      return 'not_ready'
    }
    try {
      const payload = options?.execute ? ensureTerminalEnter(text) : text
      if (!entry.transport.sendInput(terminalTextEncoder.encode(payload))) {
        completionRuntime.markUncertain(sessionId)
        return 'not_ready'
      }
      completionRuntime.applyProgrammaticInput(sessionId, text, options)
      entry.terminal.focus()
      return 'sent'
    } catch {
      return 'failed'
    }
  }, [completionRuntime, isEntryWritable])

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
    async (entry: TerminalEntry): Promise<TerminalClipboardAction> => {
      if (!entry.terminal.hasSelection()) {
        return 'none'
      }
      const selectedText = entry.terminal.getSelection()
      if (!selectedText) {
        return 'empty'
      }
      try {
        await writeClipboardText(selectedText)
        return 'copied'
      } catch {
        notifyClipboardError('terminal.copyFailed')
        return 'failed'
      }
    },
    [notifyClipboardError],
  )

  const pasteEntryText = useCallback((entry: TerminalEntry, text: string) => {
    completionRuntime.applyPaste(entry.sessionId, text)
    entry.suppressCompletionInput = true
    try {
      entry.terminal.paste(text)
    } catch {
      completionRuntime.markUncertain(entry.sessionId)
      throw new Error('terminal paste failed')
    } finally {
      queueMicrotask(() => {
        entry.suppressCompletionInput = false
      })
    }
  }, [completionRuntime])

  const pasteEntryClipboard = useCallback(
    async (entry: TerminalEntry): Promise<TerminalClipboardAction> => {
      if (!isEntryWritable(entry) || !entry.transport.isLive()) {
        return 'none'
      }
      try {
        const text = await readClipboardText()
        if (!text) {
          return 'empty'
        }
        const viewport = getViewportForSession(entry.sessionId)
        if (
          entry.disposed
          || entriesRef.current.get(entry.sessionId) !== entry
          || !isEntryWritable(entry)
          || !entry.transport.isLive()
          || activeSessionIdRef.current !== entry.sessionId
          || !viewport?.active
          || !viewport.host?.isConnected
        ) {
          return 'none'
        }
        pasteEntryText(entry, text)
        entry.terminal.focus()
        return 'pasted'
      } catch {
        notifyClipboardError('terminal.pasteFailed')
        return 'failed'
      }
    },
    [getViewportForSession, isEntryWritable, notifyClipboardError, pasteEntryText],
  )

  const pasteSessionClipboard = useCallback(
    async (sessionId: string) => {
      const entry = getEntry(sessionId)
      return entry ? pasteEntryClipboard(entry) : 'none'
    },
    [getEntry, pasteEntryClipboard],
  )

  const copyText = useCallback(
    async (text: string): Promise<TerminalClipboardAction> => {
      if (!text) {
        return 'empty'
      }
      try {
        await writeClipboardText(text)
        return 'copied'
      } catch {
        notifyClipboardError('terminal.copyFailed')
        return 'failed'
      }
    },
    [notifyClipboardError],
  )

  const captureSessionContext = useCallback(
    (
      sessionId: string,
      pointer?: TerminalContextPointer,
    ): TerminalContextSnapshot | null => {
      const entry = getEntry(sessionId)
      if (!entry || entry.disposed) {
        return null
      }
      const session = sessionsRef.current.get(sessionId)
      const selectionText = entry.terminal.hasSelection()
        ? entry.terminal.getSelection()
        : ''
      const selectionTarget = selectionText
        ? classifyTerminalContextValue(selectionText, 'selection')
        : null
      const target = selectionTarget ?? (
        selectionText || !pointer
          ? null
          : captureTerminalPointerTarget(entry.terminal, pointer)
      )
      const writable = Boolean(
        session?.status === 'connected' && entry.transport.isLive(),
      )
      const disconnected = Boolean(
        isEndedSessionStatus(session?.status)
        || entry.transportState === 'attach_failed'
        || entry.transportState === 'ended',
      )
      return {
        sessionId,
        selectionText,
        searchSeed: normalizeTerminalSearchSeed(selectionText),
        target,
        mouseTrackingMode: entry.terminal.modes.mouseTrackingMode,
        writable,
        disconnected,
      }
    },
    [getEntry],
  )

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

      const relaySessionEvent = (targetSessionId: string, patch: Partial<Session>) => {
        const existing = sessionsRef.current.get(targetSessionId)
        if (existing) {
          sessionsRef.current.set(targetSessionId, { ...existing, ...patch })
        } else if (patch.id) {
          sessionsRef.current.set(targetSessionId, patch as Session)
        }
        onSessionEventRef.current?.(targetSessionId, patch)
      }
      const transport = new TerminalTransport({
        url: apiRef.current.websocketUrl(`/api/v1/sessions/${sessionId}/terminal`),
        onEvent: (event) => {
          const currentEntry = entriesRef.current.get(sessionId)
          if (!currentEntry || currentEntry.disposed) {
            return
          }
          if (event.type === 'transport_state') {
            completionRuntime.applyTransportState(sessionId, event.state)
            if (event.state !== 'live') {
              stopCompletionStatusReconciliation(sessionId)
              currentEntry.completionPromptAnchor = null
            }
          } else if (event.type === 'prompt_boundary') {
            stopCompletionStatusReconciliation(sessionId)
            if (completionRuntime.applyPromptBoundary(sessionId, event.message)) {
              const buffer = currentEntry.terminal.buffer.active
              currentEntry.completionPromptAnchor = {
                sourceGeneration: event.message.source_generation,
                shellId: event.message.shell_id,
                promptGeneration: event.message.prompt_generation,
                inputEpoch: event.message.input_epoch,
                cursorX: buffer.cursorX,
                cursorY: buffer.cursorY,
              }
            }
          } else if (event.type === 'output_gap') {
            currentEntry.completionPromptAnchor = null
            completionRuntime.invalidateSession(sessionId)
          }
          handleTerminalTransportEvent(
            currentEntry,
            event,
            relaySessionEvent,
            (state) => cwdRuntime.applyServerState(sessionId, state),
            (requestError) => {
              cwdRuntime.applyRequestError(sessionId, requestError)
            },
            (state) => cwdRuntime.applyTransportState(sessionId, state),
            tRef.current('workbench.terminalOutputGap'),
          )
          applyEntrySessionState(currentEntry)
          if (event.type === 'attached') {
            startCompletionStatusReconciliation(sessionId)
          }
          if (
            event.type === 'attached' &&
            activeSessionIdRef.current === sessionId
          ) {
            fitAndResize(currentEntry, true)
          }
        },
      })
      const entry: TerminalEntry = {
        sessionId,
        terminal,
        fit,
        search,
        searchResult: emptySearchResult(),
        searchDecorationKey: '',
        transport,
        transportState: 'idle',
        container: pane,
        disposables: [],
        lastSize: { cols: 0, rows: 0 },
        resizeTimer: null,
        suppressCompletionInput: false,
        completionPromptAnchor: null,
        disposed: false,
      }
      entriesRef.current.set(sessionId, entry)
      const sendTerminalInput = (
        data: string | Uint8Array,
        trackCompletion: 'user' | 'binary' | 'none' = 'user',
      ) => {
        const viewport = getViewportForSession(sessionId)
        if (
          entry.disposed ||
          !isEntryWritable(entry) ||
          !entry.transport.isLive() ||
          !viewport?.host
        ) {
          completionRuntime.markUncertain(sessionId)
          return false
        }
        const sent = entry.transport.sendInput(
          typeof data === 'string' ? terminalTextEncoder.encode(data) : data,
        )
        if (!sent) {
          completionRuntime.markUncertain(sessionId)
          return false
        }
        if (trackCompletion === 'binary') {
          completionRuntime.applyBinaryInput(sessionId)
        } else if (trackCompletion === 'user' && typeof data === 'string') {
          completionRuntime.applyUserData(sessionId, data)
        }
        return true
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
        if (!isEntryWritable(entry)) {
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
        if (!isEntryWritable(entry)) {
          return
        }
        sendTerminalInput('\x03')
      }
      const handlePasteEvent = (event: ClipboardEvent) => {
        event.preventDefault()
        event.stopPropagation()
        if (!isEntryWritable(entry)) {
          return
        }
        const text = event.clipboardData?.getData('text/plain')
        if (text) {
          pasteEntryText(entry, text)
          terminal.focus()
          return
        }
        void pasteEntryClipboard(entry)
      }
      pane.addEventListener('keydown', handleClipboardKey, true)
      pane.addEventListener('copy', handleCopyEvent, true)
      pane.addEventListener('paste', handlePasteEvent, true)
      const handleCompositionStart = () => {
        completionRuntime.startComposition(sessionId)
      }
      const handleCompositionEnd = () => {
        completionRuntime.endComposition(sessionId)
      }
      helperInput?.addEventListener('compositionstart', handleCompositionStart)
      helperInput?.addEventListener('compositionend', handleCompositionEnd)
      entry.disposables.push({
        dispose: () => {
          pane.removeEventListener('keydown', handleClipboardKey, true)
          pane.removeEventListener('copy', handleCopyEvent, true)
          pane.removeEventListener('paste', handlePasteEvent, true)
          helperInput?.removeEventListener('compositionstart', handleCompositionStart)
          helperInput?.removeEventListener('compositionend', handleCompositionEnd)
        },
      })

      terminal.attachCustomKeyEventHandler((event) => {
        if (
          event.type !== 'keydown'
          || !isCompletionInteractionActive(sessionId)
        ) {
          return true
        }
        const snapshot = completionRuntime.getSnapshot(sessionId)
        if (snapshot.items.length === 0) {
          return true
        }
        if (
          event.key !== 'Tab'
          && (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
        ) {
          return true
        }
        switch (event.key) {
          case 'ArrowUp':
            event.preventDefault()
            event.stopPropagation()
            completionRuntime.moveSelection(sessionId, -1)
            return false
          case 'ArrowDown':
            event.preventDefault()
            event.stopPropagation()
            completionRuntime.moveSelection(sessionId, 1)
            return false
          case 'Enter':
            {
              const acceptance = completionRuntime.acceptSelection(sessionId)
              if (!acceptance) {
                event.preventDefault()
                event.stopPropagation()
                completionRuntime.closeSuggestions(sessionId)
                return false
              }
              if (acceptance.exact) {
                return true
              }
              event.preventDefault()
              event.stopPropagation()
              if (acceptance.text.length > 0) {
                sendTerminalInput(acceptance.text, 'none')
              }
            }
            return false
          case 'Escape':
            event.preventDefault()
            event.stopPropagation()
            completionRuntime.closeSuggestions(sessionId)
            return false
          case 'Tab':
            completionRuntime.closeSuggestions(sessionId)
            return true
          default:
            return true
        }
      })

      entry.disposables.push(
        terminal.onData((data) => {
          const trackCompletion = entry.suppressCompletionInput ? 'none' : 'user'
          sendTerminalInput(data, trackCompletion)
        }),
        terminal.onBinary((data) => {
          sendTerminalInput(binaryStringToBytes(data), 'binary')
        }),
        terminal.buffer.onBufferChange((buffer) => {
          if (buffer.type === 'alternate') {
            entry.completionPromptAnchor = null
          }
          completionRuntime.setAlternateScreen(sessionId, buffer.type === 'alternate')
          emitCompletionLayout(sessionId)
        }),
        terminal.onWriteParsed(() => {
          const completion = completionRuntime.getSnapshot(sessionId)
          const anchor = entry.completionPromptAnchor
          const buffer = terminal.buffer.active
          if (
            anchor
            && completion.boundary
            && completion.input.trust === 'trusted'
            && completion.input.line.length === 0
            && buffer.type === 'normal'
            && matchesCompletionPromptAnchor(anchor, completion.boundary)
          ) {
            anchor.cursorX = buffer.cursorX
            anchor.cursorY = buffer.cursorY
          }
          emitCompletionLayout(sessionId)
        }),
        terminal.onResize(() => {
          entry.completionPromptAnchor = null
          emitCompletionLayout(sessionId)
        }),
        terminal.onScroll(() => {
          emitCompletionLayout(sessionId)
        }),
      )
      const unregisterCwdTransport = cwdRuntime.registerTransport(
        sessionId,
        (request) => {
          if (
            entry.disposed ||
            !isEntryWritable(entry) ||
            !entry.transport.isLive()
          ) {
            return false
          }
          return entry.transport.sendCwdChange(request)
        },
        (requestId) => {
          if (
            entry.disposed ||
            !isEntryWritable(entry) ||
            !entry.transport.isLive()
          ) {
            return false
          }
          return entry.transport.sendCwdRefresh(requestId)
        },
      )
      entry.disposables.push({ dispose: unregisterCwdTransport })
      transport.start()

      return entry
    },
    [
      applyEntrySessionState,
      copyEntrySelection,
      completionRuntime,
      cwdRuntime,
      emitCompletionLayout,
      fitAndResize,
      getViewportForSession,
      isCompletionInteractionActive,
      isEntryWritable,
      pasteEntryClipboard,
      pasteEntryText,
      startCompletionStatusReconciliation,
      stopCompletionStatusReconciliation,
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
      const entry = entriesRef.current.get(sessionId) ?? createEntry(sessionId)
      moveEntryToHost(entry, viewport.host, sessionId === activeSessionIdRef.current, true)
      fitAndResize(entry, sessionId === activeSessionIdRef.current && !isEndedSessionStatus(sessionsRef.current.get(sessionId)?.status))
    })
  }, [createEntry, fitAndResize, moveEntryToHost])

  const registerViewport = useCallback(
    ({ viewportId = 'default', sessionId, host, active = true, onResize }: TerminalViewportOptions) => {
      const previous = viewportsRef.current.get(viewportId)
      viewportsRef.current.set(viewportId, {
        viewportId,
        sessionId,
        host,
        active,
        completionActive: previous?.sessionId === sessionId
          ? previous.completionActive
          : false,
        completionVisible: previous?.sessionId === sessionId
          ? previous.completionVisible
          : false,
        onResize,
      })
      syncViewports()
      return () => {
        const current = viewportsRef.current.get(viewportId)
        if (current?.host === host) {
          viewportsRef.current.delete(viewportId)
          if (current.sessionId) {
            completionRuntime.closeSuggestions(current.sessionId)
          }
          syncViewports()
        }
      }
    },
    [completionRuntime, syncViewports],
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

  const focusSession = useCallback((sessionId: string) => {
    const entry = entriesRef.current.get(sessionId)
    const viewport = getViewportForSession(sessionId)
    if (
      !entry
      || entry.disposed
      || !viewport?.active
      || !viewport.host?.isConnected
    ) {
      return false
    }
    entry.terminal.focus()
    return true
  }, [getViewportForSession])

  const subscribeSessionCompletion = useCallback((sessionId: string, listener: () => void) => (
    completionRuntime.subscribe(sessionId, listener)
  ), [completionRuntime])

  const getSessionCompletionSnapshot = useCallback((sessionId: string) => (
    completionRuntime.getSnapshot(sessionId)
  ), [completionRuntime])

  const moveSessionCompletionSelection = useCallback((sessionId: string, delta: number) => {
    if (!isCompletionInteractionActive(sessionId)) {
      return false
    }
    return completionRuntime.moveSelection(sessionId, delta)
  }, [completionRuntime, isCompletionInteractionActive])

  const selectSessionCompletion = useCallback((sessionId: string, index: number) => {
    if (!isCompletionInteractionActive(sessionId)) {
      return false
    }
    return completionRuntime.selectIndex(sessionId, index)
  }, [completionRuntime, isCompletionInteractionActive])

  const acceptSessionCompletion = useCallback((
    sessionId: string,
    expected?: TerminalCompletionExpectedSelection,
  ) => {
    const entry = entriesRef.current.get(sessionId)
    if (
      !entry
      || entry.disposed
      || !isEntryWritable(entry)
      || !entry.transport.isLive()
      || !isCompletionInteractionActive(sessionId)
    ) {
      return false
    }
    const acceptance = completionRuntime.acceptSelection(sessionId, expected)
    if (!acceptance) {
      return false
    }
    if (
      acceptance.text.length > 0
      && !entry.transport.sendInput(terminalTextEncoder.encode(acceptance.text))
    ) {
      completionRuntime.markUncertain(sessionId)
      return false
    }
    entry.terminal.focus()
    return true
  }, [completionRuntime, isCompletionInteractionActive, isEntryWritable])

  const closeSessionCompletion = useCallback((sessionId: string) => {
    completionRuntime.closeSuggestions(sessionId)
  }, [completionRuntime])

  const selectSessionContextRange = useCallback((
    sessionId: string,
    range: TerminalContextSelectionRange,
    expectedText: string,
  ) => {
    const entry = entriesRef.current.get(sessionId)
    if (
      !entry
      || entry.disposed
      || range.column < 0
      || range.row < 0
      || range.length <= 0
    ) {
      return false
    }
    try {
      entry.terminal.select(range.column, range.row, range.length)
      if (entry.terminal.getSelection() !== expectedText) {
        entry.terminal.clearSelection()
        return false
      }
      return true
    } catch {
      entry.terminal.clearSelection()
      return false
    }
  }, [])

  const clearSessionContextSelection = useCallback((sessionId: string) => {
    const entry = entriesRef.current.get(sessionId)
    if (
      !entry
      || entry.disposed
      || !entry.terminal.hasSelection()
    ) {
      return false
    }
    entry.terminal.clearSelection()
    return true
  }, [])

  const selectAllSession = useCallback((sessionId: string) => {
    const entry = entriesRef.current.get(sessionId)
    const viewport = getViewportForSession(sessionId)
    if (
      !entry
      || entry.disposed
      || !viewport?.active
      || !viewport.host?.isConnected
    ) {
      return false
    }
    entry.terminal.selectAll()
    return true
  }, [getViewportForSession])

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
    const completionLayoutListeners = completionLayoutListenersRef.current
    const completionStatusReconciliations = completionStatusReconciliationsRef.current
    return () => {
      for (const sessionId of completionStatusReconciliations.keys()) {
        stopCompletionStatusReconciliation(sessionId)
      }
      disposeAll()
      cwdRuntime.dispose()
      completionRuntime.clear()
      completionLayoutListeners.clear()
    }
  }, [api, completionRuntime, cwdRuntime, disposeAll, stopCompletionStatusReconciliation])

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
      captureSessionContext,
      pasteSessionClipboard,
      copyText,
      selectSessionContextRange,
      clearSessionContextSelection,
      selectAllSession,
      focusSession,
      sendTextToSession,
      sendTextToActive,
      subscribeSessionCompletion,
      getSessionCompletionSnapshot,
      subscribeSessionCompletionLayout,
      captureSessionCompletionCursor,
      setViewportCompletionActive,
      setViewportCompletionVisible,
      moveSessionCompletionSelection,
      selectSessionCompletion,
      acceptSessionCompletion,
      retrySessionCompletion,
      closeSessionCompletion,
    }),
    [
      acceptSessionCompletion,
      clearActiveSearch,
      clearSessionContextSelection,
      closeSessionCompletion,
      captureSessionContext,
      captureSessionCompletionCursor,
      copyText,
      disposeAll,
      disposeSession,
      focusActive,
      focusSession,
      getSessionCompletionSnapshot,
      moveSessionCompletionSelection,
      pasteSessionClipboard,
      registerViewport,
      retrySessionCompletion,
      scheduleActiveResize,
      scheduleSessionResize,
      searchActive,
      selectSessionCompletion,
      selectSessionContextRange,
      selectAllSession,
      sendTextToActive,
      sendTextToSession,
      setViewportCompletionActive,
      setViewportCompletionVisible,
      subscribeSessionCompletion,
      subscribeSessionCompletionLayout,
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

function matchesCompletionPromptAnchor(
  anchor: CompletionPromptAnchor,
  boundary: TerminalPromptBoundary,
) {
  return (
    anchor.sourceGeneration === boundary.source_generation
    && anchor.shellId === boundary.shell_id
    && anchor.promptGeneration === boundary.prompt_generation
    && anchor.inputEpoch === boundary.input_epoch
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

function handleTerminalTransportEvent(
  entry: TerminalEntry,
  event: TerminalTransportEvent,
  onSessionEvent: TerminalRuntimeProviderProps['onSessionEvent'],
  onCwdState: (state: SessionCwdState) => void,
  onCwdError: (error: SessionCwdRequestError) => void,
  onTransportState: (state: TerminalTransportState) => void,
  outputGapMessage: string,
) {
  switch (event.type) {
    case 'transport_state':
      entry.transportState = event.state
      onTransportState(event.state)
      entry.container.dataset.transportState = event.state
      entry.container.classList.toggle(
        'is-terminal-transport-reconnecting',
        event.state === 'connecting' ||
          event.state === 'attaching' ||
          event.state === 'retry_wait',
      )
      return
    case 'attached':
      delete entry.container.dataset.transportError
      onSessionEvent?.(entry.sessionId, event.message.session)
      onCwdState(event.message.cwd_state)
      return
    case 'output':
      entry.terminal.write(event.data)
      return
    case 'output_gap':
      entry.container.dataset.outputGapReason = event.reason
      entry.container.dataset.outputGapMessage = outputGapMessage
      return
    case 'session_state':
      onSessionEvent?.(entry.sessionId, event.message.session)
      return
    case 'cwd_state':
      onCwdState(event.message.cwd_state)
      return
    case 'prompt_boundary':
      return
    case 'request_error':
      entry.container.dataset.transportError = event.code
      if (
        (event.scope === 'cwd_change' || event.scope === 'cwd_refresh')
        && event.requestId
      ) {
        onCwdError({
          scope: event.scope,
          request_id: event.requestId,
          code: event.code,
          retryable: event.retryable,
          message: event.message,
        })
      }
      return
    case 'session_ended': {
      const patch: Partial<Session> = {
        ...event.message.session,
        status_message:
          event.message.session.status_message || event.message.reason,
      }
      if (event.message.exit_code !== undefined) {
        patch.exit_code = event.message.exit_code
      }
      onSessionEvent?.(entry.sessionId, patch)
      return
    }
    case 'protocol_error':
      entry.container.dataset.transportError = event.error.message
      return
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

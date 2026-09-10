import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  cancelTerminalAiCompletion,
  generateTerminalAiCompletion,
  terminalAiCompletionAvailable,
} from '../api/terminalAiCompletionGateway'
import { TerminalAiCompletionRuntime } from '../model/terminalAiCompletionRuntime'
import { terminalAiAppendState } from '../model/terminalAiCompletion'
import { useTerminalRuntime } from './terminalRuntimeContext'

export function useTerminalAiCompletion(sessionId: string | null, active: boolean) {
  const runtime = useTerminalRuntime()
  const { subscribeSessionCompletion } = runtime
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const { t } = useTranslation()
  const controller = useMemo(() => new TerminalAiCompletionRuntime({
    sessionId: sessionId ?? '',
    captureInput: () => sessionId ? runtimeRef.current.captureSessionAiInput(sessionId) : null,
    setPaused: (paused) => {
      if (sessionId) runtimeRef.current.setSessionAiCompletionOpen(sessionId, paused)
    },
    generate: generateTerminalAiCompletion,
    cancel: (requestId) => cancelTerminalAiCompletion(sessionId ?? '', requestId),
  }), [sessionId])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const enabled = runtime.aiCompletionEnabled && active

  useEffect(() => {
    if (!enabled) controller.close()
  }, [controller, enabled])

  useEffect(() => {
    if (!sessionId) return
    return subscribeSessionCompletion(sessionId, () => controller.inputChanged())
  }, [controller, subscribeSessionCompletion, sessionId])

  useEffect(() => () => controller.close(), [controller])

  const open = useCallback(() => enabled && controller.open(), [controller, enabled])
  const close = useCallback(() => {
    controller.close()
    if (sessionId && enabled) runtimeRef.current.focusSession(sessionId)
  }, [controller, enabled, sessionId])

  const append = useCallback(() => {
    const current = controller.getSnapshot()
    const selected = controller.getSelectedResult()
    if (!sessionId || !selected || !current.input) return
    if (runtimeRef.current.acceptSessionAiCompletion(sessionId, current.input, selected.command) === 'sent') {
      close()
    } else controller.inputChanged()
  }, [close, controller, sessionId])

  const copy = useCallback(async () => {
    const result = controller.getSelectedResult()
    if (!result) return
    if (await runtimeRef.current.copyText(result.command) !== 'copied') {
      throw new Error(t('terminal.aiCompletion.copyFailed'))
    }
  }, [controller, t])

  const bridgeAvailable = terminalAiCompletionAvailable()
  const selected = controller.getSelectedResult()
  return {
    state, enabled, bridgeAvailable, open, close, append, copy,
    cancel: () => controller.cancel(),
    generate: () => { if (enabled && bridgeAvailable) void controller.generate() },
    updatePrompt: (prompt: string) => controller.updatePrompt(prompt),
    selectResult: (requestId: string) => controller.selectResult(requestId),
    appendState: terminalAiAppendState(
      sessionId ? runtime.captureSessionAiInput(sessionId) : null,
      state.input,
      selected?.command ?? '',
    ),
    errorMessage: state.errorCode
      ? t(`terminal.aiCompletion.errors.${state.errorCode}`, {
        defaultValue: state.errorMessage || t('terminal.aiCompletion.requestFailed'),
      })
      : state.errorMessage,
  }
}

import { App as AntdApp } from 'antd'
import { SquareTerminal } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AppTheme, TerminalSettings } from '#common/contracts'
import type { CommandDispatchScope } from '#entities/command-dispatch'
import type { Session } from '#entities/session'
import type { Host } from '#entities/host'
import { TermousApiError } from '#shared/api'
import {
  buildCommandDispatchSessionOptions,
  commandDispatchUTF8ByteLength,
  containsCommandLineBreak,
  maximumCommandDispatchBytes,
  maximumCommandDispatchTargets,
  pruneCommandDispatchSelection,
  resolveCommandDispatchTargetIds,
} from '../model/commandDispatchSelection'
import { useCommandDispatchRuntime } from '../runtime/commandDispatchContext'
import { CommandDispatchTargetPicker } from './CommandDispatchTargetPicker'
import { CommandDispatchResults } from './CommandDispatchResults'
import { CommandDispatchComposer } from './CommandDispatchComposer'
import { CommandDispatchHistory } from './CommandDispatchHistory'
import styles from './CommandDispatchDock.module.scss'

interface CommandDispatchDockProps {
  sessions: Session[]
  hosts: Host[]
  activeSession: Session | null
  terminalSettings: TerminalSettings
  theme: AppTheme
  resolveSessionTitle: (session: Session) => string
  onJumpToSession: (sessionId: string) => void
}

export function CommandDispatchDock({
  sessions,
  hosts,
  activeSession,
  terminalSettings,
  theme,
  resolveSessionTitle,
  onJumpToSession,
}: CommandDispatchDockProps) {
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const runtime = useCommandDispatchRuntime()
  const { state } = runtime
  const [scope, setScope] = useState<CommandDispatchScope>('current')
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set())
  const [command, setCommand] = useState('')
  const [activeResultSessionId, setActiveResultSessionId] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const taskIdentityRef = useRef('')
  const targetOptions = useMemo(
    () => buildCommandDispatchSessionOptions(sessions, hosts, resolveSessionTitle),
    [hosts, resolveSessionTitle, sessions],
  )

  useEffect(() => {
    setSelectedSessionIds((current) => {
      const next = pruneCommandDispatchSelection(current, sessions)
      return equalSet(current, next) ? current : next
    })
  }, [sessions])

  const targetSessionIds = useMemo(() => resolveCommandDispatchTargetIds({
    scope,
    sessions,
    activeSessionId: activeSession?.id,
    selectedSessionIds,
  }), [activeSession?.id, scope, selectedSessionIds, sessions])

  const task = state.task
  useEffect(() => {
    if (!task) {
      taskIdentityRef.current = ''
      setActiveResultSessionId('')
      return
    }
    const currentExists = task.targets.some((target) => (
      target.session_id === activeResultSessionId
    ))
    if (taskIdentityRef.current !== task.id || !currentExists) {
      taskIdentityRef.current = task.id
      setActiveResultSessionId(task.targets[0]?.session_id ?? '')
    }
  }, [activeResultSessionId, task])

  const commandTooLarge = commandDispatchUTF8ByteLength(command) > maximumCommandDispatchBytes
  const tooManyTargets = targetSessionIds.length > maximumCommandDispatchTargets
  const validationMessage = tooManyTargets
    ? t('commandDispatch.tooManyTargets', {
        count: targetSessionIds.length,
        max: maximumCommandDispatchTargets,
      })
    : commandTooLarge
      ? t('commandDispatch.commandTooLarge', { max: maximumCommandDispatchBytes / 1024 })
      : ''
  const canSend = command.trim().length > 0
    && !containsCommandLineBreak(command)
    && !commandTooLarge
    && targetSessionIds.length > 0
    && !tooManyTargets
    && !state.recovering
    && !state.starting
  const changeScope = useCallback((nextScope: CommandDispatchScope) => {
    setScope(nextScope)
    if (
      nextScope === 'selected'
      && selectedSessionIds.size === 0
      && activeSession?.kind === 'ssh'
      && activeSession.status === 'connected'
    ) {
      setSelectedSessionIds(new Set([activeSession.id]))
    }
  }, [activeSession, selectedSessionIds.size])

  const submit = useCallback(async () => {
    if (!canSend) return
    try {
      const nextTask = await runtime.start({
        client_request_id: createClientRequestId(),
        scope,
        command,
        target_session_ids: [...targetSessionIds],
      })
      setActiveResultSessionId(nextTask.targets[0]?.session_id ?? '')
    } catch (error) {
      void message.error(error instanceof TermousApiError && error.code === 'COMMAND_DISPATCH_RESULT_UNKNOWN'
        ? t('commandDispatch.resultUnknown')
        : error instanceof Error ? error.message : t('commandDispatch.startFailed'))
    }
  }, [canSend, command, message, runtime, scope, t, targetSessionIds])

  const interruptAll = useCallback(() => {
    void runtime.interruptTask().catch((error) => {
      void message.error(error instanceof Error ? error.message : t('commandDispatch.interruptFailed'))
    })
  }, [message, runtime, t])

  const interruptOne = useCallback((sessionId: string) => {
    void runtime.interruptTarget(sessionId).catch((error) => {
      void message.error(error instanceof Error ? error.message : t('commandDispatch.interruptFailed'))
    })
  }, [message, runtime, t])

  return (
    <section className={styles.root} aria-label={t('commandDispatch.title')} data-command-dispatch-dock="">
      <header className={styles.header}>
        <span className={styles.title}>
          <SquareTerminal size={16} aria-hidden="true" />
          <strong>{t('commandDispatch.title')}</strong>
        </span>
        <div className={styles.segmented} role="group" aria-label={t('commandDispatch.scope')}>
          {(['current', 'selected', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={scope === value ? styles.active : ''}
              aria-pressed={scope === value}
              data-command-dispatch-scope={value}
              onClick={() => changeScope(value)}
            >
              {t(`commandDispatch.scopeValue.${value}`)}
            </button>
          ))}
        </div>
        {scope === 'selected' ? (
          <CommandDispatchTargetPicker
            options={targetOptions}
            selectedSessionIds={selectedSessionIds}
            onChange={(sessionIds) => setSelectedSessionIds(new Set(sessionIds))}
          />
        ) : null}
        <div className={styles['header-actions']}>
          {runtime.tasks.length > 0 ? (
            <CommandDispatchHistory tasks={runtime.tasks} selectedTaskId={task?.id} onSelect={runtime.selectTask} />
          ) : null}
        </div>
      </header>
      <div className={styles.workspace}>
        <CommandDispatchComposer
          value={command}
          onChange={setCommand}
          onSubmit={() => void submit()}
          inputRef={inputRef}
          canSend={canSend}
          busy={state.starting}
          invalid={commandTooLarge}
          validationMessage={validationMessage}
          targetCount={targetSessionIds.length}
        />
        <CommandDispatchResults
          state={state}
          sessions={sessions}
          activeResultSessionId={activeResultSessionId}
          terminalSettings={terminalSettings}
          theme={theme}
          resolveSessionTitle={resolveSessionTitle}
          onSelectResult={setActiveResultSessionId}
          onInterruptTarget={interruptOne}
          onInterruptTask={interruptAll}
          onReuseCommand={(value) => {
            setCommand(value)
            inputRef.current?.focus()
          }}
          onJumpToSession={onJumpToSession}
        />
      </div>
    </section>
  )
}

function equalSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function createClientRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `command-dispatch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

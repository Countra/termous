import { App as AntdApp } from 'antd'
import {
  CircleStop,
  Radio,
  Send,
  SquareTerminal,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AppTheme, TerminalSettings } from '#common/contracts'
import type {
  CommandDispatchScope,
  CommandDispatchTarget,
} from '#entities/command-dispatch'
import type { Session } from '#entities/session'
import type { Host } from '#entities/host'
import {
  buildCommandDispatchSessionOptions,
  commandDispatchUTF8ByteLength,
  containsCommandLineBreak,
  maximumCommandDispatchBytes,
  maximumCommandDispatchTargets,
  pruneCommandDispatchSelection,
  resolveCommandDispatchTargetIds,
} from '../model/commandDispatchSelection'
import {
  commandDispatchExitCodeDisplay,
  isCommandDispatchTargetTerminal,
  isCommandDispatchTaskTerminal,
} from '../model/commandDispatchTaskState'
import {
  useCommandDispatchRuntime,
  useCommandDispatchTargetOutput,
} from '../runtime/commandDispatchContext'
import { CommandDispatchTargetPicker } from './CommandDispatchTargetPicker'
import { CommandOutputViewport } from './CommandOutputViewport'
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

  const activeTarget = task?.targets.find((target) => (
    target.session_id === activeResultSessionId
  ))
  const output = useCommandDispatchTargetOutput(task?.id, activeTarget?.session_id)
  const taskRunning = Boolean(task && !isCommandDispatchTaskTerminal(task.status))
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
    && !taskRunning
  const sendLabel = state.starting
    ? t('commandDispatch.sending')
    : t('commandDispatch.sendToCount', { count: targetSessionIds.length })

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
      void message.error(error instanceof Error ? error.message : t('commandDispatch.startFailed'))
    }
  }, [canSend, command, message, runtime, scope, t, targetSessionIds])

  const rejectMultilinePaste = useCallback((event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!containsCommandLineBreak(text)) return
    event.preventDefault()
    void message.warning(t('commandDispatch.multilineRejected'))
  }, [message, t])

  const handleCommandKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }, [submit])

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
    <section
      className={styles.root}
      aria-label={t('commandDispatch.title')}
      data-command-dispatch-dock=""
    >
      <header className={styles.header}>
        <span className={styles.title}>
          <Send size={15} aria-hidden="true" />
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
        ) : (
          <span className={styles['target-summary']}>
            {t('commandDispatch.targetCount', { count: targetSessionIds.length })}
          </span>
        )}
        {taskRunning && task?.interruptible ? (
          <button
            type="button"
            className={styles['interrupt-all']}
            disabled={state.interruptingTask}
            onClick={interruptAll}
          >
            <CircleStop size={14} aria-hidden="true" />
            {state.interruptingTask
              ? t('commandDispatch.interrupting')
              : t('commandDispatch.interruptAll')}
          </button>
        ) : null}
      </header>

      <div className={styles.compose}>
        <span className={styles.prompt} aria-hidden="true">$</span>
        <input
          value={command}
          type="text"
          autoComplete="off"
          maxLength={8192}
          aria-invalid={commandTooLarge || undefined}
          spellCheck={false}
          aria-label={t('commandDispatch.commandInput')}
          placeholder={t('commandDispatch.commandPlaceholder')}
          data-command-dispatch-input=""
          onChange={(event) => setCommand(event.target.value)}
          onPaste={rejectMultilinePaste}
          onKeyDown={handleCommandKeyDown}
        />
        {validationMessage ? (
          <span className={styles['compose-error']} role="alert" title={validationMessage}>
            {validationMessage}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.send}
          disabled={!canSend}
          aria-label={sendLabel}
          data-command-dispatch-send=""
          onClick={() => void submit()}
        >
          <Send size={14} aria-hidden="true" />
          <span>{sendLabel}</span>
        </button>
      </div>

      <div className={styles.results}>
        <div
          className={styles['result-list']}
          role={task?.targets.length ? 'list' : undefined}
          aria-label={task?.targets.length ? t('commandDispatch.results') : undefined}
        >
          {task?.targets.length ? task.targets.map((target) => {
            const terminal = isCommandDispatchTargetTerminal(target.status)
            const interrupting = state.interruptingSessionIds.has(target.session_id)
            return (
              <div
                key={target.session_id}
                className={[
                  styles['result-row'],
                  target.session_id === activeTarget?.session_id ? styles.active : '',
                ].filter(Boolean).join(' ')}
                role="listitem"
                data-command-dispatch-target={target.session_id}
              >
                <button
                  type="button"
                  className={styles['result-main']}
                  onClick={() => setActiveResultSessionId(target.session_id)}
                >
                  <i className={`${styles.dot} ${statusClassName(target.status)}`} aria-hidden="true" />
                  <span>
                    <strong>{targetTitle(target, sessions, resolveSessionTitle)}</strong>
                    <small>{targetStatusLabel(target, t)}</small>
                  </span>
                  <ExitCode target={target} />
                </button>
                {!terminal && task.interruptible ? (
                  <button
                    type="button"
                    className={styles['interrupt-target']}
                    aria-label={t('commandDispatch.interruptTarget', {
                      name: targetTitle(target, sessions, resolveSessionTitle),
                    })}
                    disabled={interrupting}
                    onClick={() => interruptOne(target.session_id)}
                  >
                    <CircleStop size={13} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            )
          }) : (
            <div
              className={[
                styles['empty-state'],
                styles['empty-results'],
                state.errorMessage
                  ? styles['is-error']
                  : state.recovering
                    ? styles['is-recovering']
                    : '',
              ].filter(Boolean).join(' ')}
              aria-live="polite"
              aria-atomic="true"
              data-command-dispatch-empty="results"
            >
              <span className={styles['empty-state-icon']} aria-hidden="true">
                <Radio size={16} />
              </span>
              <span className={styles['empty-state-copy']}>
                <strong>{t('commandDispatch.results')}</strong>
                <small>{state.errorMessage
                  || (state.recovering
                    ? t('commandDispatch.recovering')
                    : t('commandDispatch.noResults'))}</small>
              </span>
            </div>
          )}
        </div>

        <section className={styles.mirror}>
          {task && activeTarget ? (
            <>
              <header className={styles['mirror-head']}>
                <span className={styles['mirror-title']}>
                  <i className={`${styles.dot} ${statusClassName(activeTarget.status)}`} aria-hidden="true" />
                  <span>
                    <strong>{targetTitle(activeTarget, sessions, resolveSessionTitle)}</strong>
                    <small>{activeTarget.endpoint || activeTarget.session_id}</small>
                  </span>
                </span>
                <span className={styles['mirror-actions']}>
                  <button type="button" onClick={() => onJumpToSession(activeTarget.session_id)}>
                    <SquareTerminal size={13} aria-hidden="true" />
                    {t('commandDispatch.openOriginalTerminal')}
                  </button>
                </span>
              </header>
              <div className={styles['mirror-body']}>
                <CommandOutputViewport
                  taskId={task.id}
                  sessionId={activeTarget.session_id}
                  terminalSettings={terminalSettings}
                  appTheme={theme}
                />
                {!output.streamEpoch && !output.ended ? (
                  <span className={styles['output-waiting']}>{t('commandDispatch.waitingOutput')}</span>
                ) : null}
                {output.gapReason || output.truncated ? (
                  <span className={styles['output-warning']} role="status">
                    {output.truncated
                      ? t('commandDispatch.outputTruncated')
                      : t('commandDispatch.outputGap')}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <div
              className={`${styles['empty-state']} ${styles['mirror-empty']}`}
              data-command-dispatch-empty="mirror"
            >
              <span className={styles['empty-state-icon']} aria-hidden="true">
                <SquareTerminal size={17} />
              </span>
              <span className={styles['empty-state-copy']}>
                <strong>{t('commandDispatch.ptyOutput')}</strong>
                <small>{t('commandDispatch.mirrorEmpty')}</small>
              </span>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

function ExitCode({ target }: { target: CommandDispatchTarget }) {
  const { t } = useTranslation()
  const display = commandDispatchExitCodeDisplay(target)
  if (display?.kind === 'unknown') {
    return (
      <span
        className={styles['exit-code']}
        data-exit-code-status="unknown"
      >
        <span aria-hidden="true">—</span>
        <span className={styles['exit-code-a11y']}>
          {t('commandDispatch.exitCodeUnavailable')}
        </span>
      </span>
    )
  }
  if (display?.kind !== 'known') return null
  return (
    <span
      className={styles['exit-code']}
      data-exit-code-status={display.code === 0 ? 'success' : 'failure'}
    >
      <span aria-hidden="true">{display.code}</span>
      <span className={styles['exit-code-a11y']}>
        {t('commandDispatch.exitCode', { code: display.code })}
      </span>
    </span>
  )
}

function targetTitle(
  target: CommandDispatchTarget,
  sessions: Session[],
  resolveSessionTitle: (session: Session) => string,
) {
  const session = sessions.find((item) => item.id === target.session_id)
  return target.session_name
    || target.host_name
    || (session ? resolveSessionTitle(session) : target.session_id)
}

function statusClassName(status: CommandDispatchTarget['status']) {
  return styles[`status-${status.replace(/_/g, '-')}`]
}

function targetStatusLabel(
  target: CommandDispatchTarget,
  t: ReturnType<typeof useTranslation>['t'],
) {
  return target.status_message
    || target.error_message
    || t(`commandDispatch.targetStatus.${target.status}`, { defaultValue: target.status })
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

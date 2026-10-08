import { Tooltip } from 'antd'
import { CircleStop, Copy, SquareTerminal, TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppTheme, TerminalSettings } from '#common/contracts'
import type { CommandDispatchTarget } from '#entities/command-dispatch'
import type { Session } from '#entities/session'
import { SessionTabStrip, uiStyles } from '#shared/ui'
import {
  commandDispatchExitCodeDisplay,
  isCommandDispatchTargetTerminal,
  isCommandDispatchTaskTerminal,
  type CommandDispatchTaskViewState,
} from '../model/commandDispatchTaskState'
import { useCommandDispatchTargetOutput } from '../runtime/commandDispatchContext'
import { CommandOutputViewport } from './CommandOutputViewport'
import styles from './CommandDispatchResults.module.scss'

const tooltipClassNames = { root: `${uiStyles.tooltip} termous-tooltip` }

interface CommandDispatchResultsProps {
  state: CommandDispatchTaskViewState
  sessions: Session[]
  activeResultSessionId: string
  terminalSettings: TerminalSettings
  theme: AppTheme
  resolveSessionTitle: (session: Session) => string
  onSelectResult: (sessionId: string) => void
  onInterruptTarget: (sessionId: string) => void
  onInterruptTask: () => void
  onReuseCommand: (command: string) => void
  onJumpToSession: (sessionId: string) => void
}

export function CommandDispatchResults({
  state,
  sessions,
  activeResultSessionId,
  terminalSettings,
  theme,
  resolveSessionTitle,
  onSelectResult,
  onInterruptTarget,
  onInterruptTask,
  onReuseCommand,
  onJumpToSession,
}: CommandDispatchResultsProps) {
  const { t } = useTranslation()
  const resultId = useId()
  const task = state.task
  const activeTarget = task?.targets.find(target => target.session_id === activeResultSessionId)
  const running = task && !isCommandDispatchTaskTerminal(task.status)
  const activeIndex = task?.targets.findIndex(target => target.session_id === activeResultSessionId) ?? -1
  const resultUnknown = state.errorCode === 'COMMAND_DISPATCH_RESULT_UNKNOWN'
  const emptyTitle = resultUnknown
    ? t('commandDispatch.resultNotConfirmed')
    : state.errorMessage
      ? t('commandDispatch.startFailed')
      : t(state.recovering ? 'commandDispatch.recovering' : 'commandDispatch.ready')
  const emptyDescription = resultUnknown
    ? t('commandDispatch.resultUnknown')
    : state.errorMessage || t(state.recovering ? 'commandDispatch.recoveryHint' : 'commandDispatch.noResults')
  const outputActions = activeTarget ? (
    <div className={styles['output-actions']}>
      {task ? <OutputWarning taskId={task.id} sessionId={activeTarget.session_id} /> : null}
      {!isCommandDispatchTargetTerminal(activeTarget.status) && task?.interruptible ? (
        <Tooltip title={t('commandDispatch.interruptTarget', { name: targetTitle(activeTarget, sessions, resolveSessionTitle) })} classNames={tooltipClassNames} trigger={['hover', 'focus']}>
          <button
            type="button"
            className={styles['stop-task']}
            disabled={state.interruptingSessionIds.has(activeTarget.session_id)}
            aria-label={t('commandDispatch.interruptTarget', { name: targetTitle(activeTarget, sessions, resolveSessionTitle) })}
            onClick={() => onInterruptTarget(activeTarget.session_id)}
          ><CircleStop size={14} aria-hidden="true" /></button>
        </Tooltip>
      ) : null}
      <Tooltip title={t('commandDispatch.openOriginalTerminal')} classNames={tooltipClassNames} trigger={['hover', 'focus']}>
        <button
          type="button"
          className={styles['icon-action']}
          aria-label={t('commandDispatch.openOriginalTerminal')}
          onClick={() => onJumpToSession(activeTarget.session_id)}
        >
          <SquareTerminal size={15} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  ) : null
  return (
    <section className={styles.results} aria-label={t('commandDispatch.results')}>
      {task?.targets.length ? (
        <>
          <header className={styles['task-head']}>
            <Tooltip title={task.command} classNames={tooltipClassNames}>
              <code className={styles['task-command']}>{task.command}</code>
            </Tooltip>
            <span className={styles['task-status']} data-status={task.status}>{t(`commandDispatch.status.${task.status}`)}</span>
            <Tooltip title={t('commandDispatch.progress', { completed: task.completed_targets, total: task.total_targets })} classNames={tooltipClassNames}>
              <span className={styles.progress}>{task.completed_targets}/{task.total_targets}</span>
            </Tooltip>
            <Tooltip title={t('commandDispatch.reuseCommand')} classNames={tooltipClassNames} trigger={['hover', 'focus']}>
              <button
                type="button"
                className={styles['icon-action']}
                aria-label={t('commandDispatch.reuseCommand')}
                disabled={state.starting}
                onClick={() => onReuseCommand(task.command)}
              >
                <Copy size={14} aria-hidden="true" />
                <span>{t('commandDispatch.reuseCommand')}</span>
              </button>
            </Tooltip>
            {running && task.interruptible ? (
              <Tooltip title={t('commandDispatch.interruptAll')} classNames={tooltipClassNames} trigger={['hover', 'focus']}>
                <button
                  type="button"
                  className={styles['stop-task']}
                  aria-label={state.interruptingTask ? t('commandDispatch.interrupting') : t('commandDispatch.interruptAll')}
                  disabled={state.interruptingTask}
                  onClick={onInterruptTask}
                >
                  <CircleStop size={14} aria-hidden="true" />
                  <span>{t('commandDispatch.interruptAll')}</span>
                </button>
              </Tooltip>
            ) : null}
          </header>
          <SessionTabStrip
            className={styles['target-strip']}
            ariaLabel={t('commandDispatch.results')}
            activeId={activeResultSessionId}
            contentKey={task.id + ':' + task.targets.map(target => target.session_id).join(',')}
            scrollLeftLabel={t('commandDispatch.scrollResultsLeft')}
            scrollRightLabel={t('commandDispatch.scrollResultsRight')}
            trailing={outputActions}
          >
            {task.targets.map((target, index) => (
              <Tooltip
                key={target.session_id}
                title={<>{targetTitle(target, sessions, resolveSessionTitle)}<br />{target.endpoint}<br />{targetStatusLabel(target, t)}</>}
                classNames={tooltipClassNames}
                trigger={['hover', 'focus']}
              >
                <button
                  id={`${resultId}-target-${index}`}
                  type="button"
                  className={styles['target-tab']}
                  role="tab"
                  aria-selected={target.session_id === activeResultSessionId}
                  aria-controls={`${resultId}-output`}
                  tabIndex={target.session_id === activeResultSessionId ? 0 : -1}
                  data-session-tab-id={target.session_id}
                  data-command-dispatch-target={target.session_id}
                  onClick={() => onSelectResult(target.session_id)}
                >
                  <i className={`${styles.dot} ${statusClassName(target.status)}`} aria-hidden="true" />
                  <span>{targetTitle(target, sessions, resolveSessionTitle)}</span>
                  <ExitCode target={target} />
                  <span className={styles['target-status-a11y']}>{targetStatusLabel(target, t)}</span>
                </button>
              </Tooltip>
            ))}
          </SessionTabStrip>
          <div className={styles['target-detail']}>
            <span>{activeTarget?.endpoint || (activeTarget ? targetTitle(activeTarget, sessions, resolveSessionTitle) : '')}</span>
            {activeTarget ? <Tooltip title={targetStatusLabel(activeTarget, t)} classNames={tooltipClassNames}><small>{targetStatusLabel(activeTarget, t)}</small></Tooltip> : null}
          </div>
          <section
            id={`${resultId}-output`}
            className={styles['mirror-body']}
            role="tabpanel"
            aria-labelledby={activeIndex >= 0 ? `${resultId}-target-${activeIndex}` : undefined}
          >
            {activeTarget ? (
              <>
                <CommandOutputViewport taskId={task.id} sessionId={activeTarget.session_id} terminalSettings={terminalSettings} appTheme={theme} />
                <OutputWaiting taskId={task.id} sessionId={activeTarget.session_id} />
              </>
            ) : null}
          </section>
        </>
      ) : (
        <div className={styles['empty-state']} aria-live="polite" aria-atomic="true" data-command-dispatch-empty="results">
          <span className={styles['empty-icon']} data-error={Boolean(state.errorMessage)} aria-hidden="true"><SquareTerminal size={21} /></span>
          <strong>{emptyTitle}</strong>
          <p>{emptyDescription}</p>
        </div>
      )}
    </section>
  )
}

// 输出流的提示独立订阅，避免每个数据块都重绘会话标签和任务操作。
function OutputWarning({ taskId, sessionId }: { taskId: string; sessionId: string }) {
  const { t } = useTranslation()
  const output = useCommandDispatchTargetOutput(taskId, sessionId)
  const warning = output.truncated ? t('commandDispatch.outputTruncated')
    : output.gapReason ? t('commandDispatch.outputGap') : ''
  if (!warning) return null
  return (
    <Tooltip title={warning} classNames={tooltipClassNames} trigger={['hover', 'focus']}>
      <span className={styles['output-warning']} role="status" tabIndex={0}>
        <TriangleAlert size={14} aria-hidden="true" />
        <span className={styles['warning-message']}>{warning}</span>
      </span>
    </Tooltip>
  )
}

function OutputWaiting({ taskId, sessionId }: { taskId: string; sessionId: string }) {
  const { t } = useTranslation()
  const output = useCommandDispatchTargetOutput(taskId, sessionId)
  return !output.streamEpoch && !output.ended
    ? <span className={styles['output-waiting']}>{t('commandDispatch.waitingOutput')}</span>
    : null
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

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderOpen,
  LoaderCircle,
  Minimize2,
  Search,
  Server,
  TerminalSquare,
  UserRoundCog,
} from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentSlashCandidate, AgentSlashCommandId } from '#entities/agent'
import { agentSlashMenuAvailableHeight } from '../model/agentSlashCommands.ts'
import {
  agentSlashOptionId,
  type AgentSlashCommandController,
} from '../model/useAgentSlashCommands.ts'
import styles from './AgentSlashCommandMenu.module.scss'

export function AgentSlashCommandMenu({
  controller,
  onFocusComposer,
}: {
  controller: AgentSlashCommandController
  onFocusComposer: () => void
}) {
  const { t } = useTranslation()
  const kindListRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const previousLevelRef = useRef(controller.state.level)
  const pointerRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const { state } = controller
  const { takeFocusRestore } = controller

  useEffect(() => {
    const previousLevel = previousLevelRef.current
    previousLevelRef.current = state.level
    pointerRef.current = undefined
    if (state.level === 'kind') kindListRef.current?.focus({ preventScroll: true })
    else if (state.level === 'resource') searchRef.current?.focus({ preventScroll: true })
    else if (state.level === 'root' && previousLevel !== 'closed') onFocusComposer()
    else if (state.level === 'closed' && previousLevel !== 'closed' && takeFocusRestore()) {
      onFocusComposer()
    }
  }, [onFocusComposer, state.level, takeFocusRestore])

  useEffect(() => {
    if (!controller.activeOptionId) return
    document.getElementById(controller.activeOptionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [controller.activeOptionId])

  useLayoutEffect(() => {
    const menu = menuRef.current
    const anchor = menu?.parentElement
    if (!menu || !anchor || state.level === 'closed') return
    const composer = anchor.parentElement
    const workspace = menu.closest<HTMLElement>('[data-agent-workspace]')
    const update = () => {
      const available = agentSlashMenuAvailableHeight(
        anchor.getBoundingClientRect().top,
        workspace?.getBoundingClientRect().top ?? 0,
      )
      menu.style.setProperty('--agent-slash-available-height', `${available}px`)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(anchor)
    if (composer) observer?.observe(composer)
    if (workspace) observer?.observe(workspace)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [state.level])

  if (state.level === 'closed') return null

  const listId = `${controller.menuId}-list`
  const resourceStatusId = `${controller.menuId}-resource-status`
  const resourceCommandIds = controller.rootCommandIds.filter((commandId) => commandId !== 'compact')
  const activeResourceKindAvailability = state.level === 'resource'
    ? controller.resourceKindAvailability(state.command_id, state.resource_kind)
    : undefined
  const resourceKindDisabledReason = activeResourceKindAvailability?.enabled === false
    ? activeResourceKindAvailability.disabled_reason ?? 'resource_busy'
    : undefined
  const resourceStatusText = state.level !== 'resource'
    ? undefined
    : controller.executing
      ? t('agent.slash.processing')
      : resourceKindDisabledReason
        ? disabledReason(resourceKindDisabledReason, t)
        : undefined
  const onPointerMove = (activeId: string, event: ReactPointerEvent, selectable = true) => {
    const previous = pointerRef.current
    pointerRef.current = { x: event.clientX, y: event.clientY }
    if (!selectable || !previous || (previous.x === event.clientX && previous.y === event.clientY)) return
    controller.onSetActive(activeId)
  }

  return (
    <div ref={menuRef} className={styles.menu} data-level={state.level} aria-label={t('agent.slash.title')}>
      {state.level !== 'root' ? (
        <div className={styles.header}>
          <button
            type="button"
            className={styles.back}
            aria-label={t('app.back')}
            onClick={controller.back}
          >
            <ChevronLeft size={15} />
          </button>
          <span className={styles['header-copy']}>
            <span className={styles['header-path']}>/{state.command_id}</span>
            <strong>{levelTitle(state.level, state.command_id, t)}</strong>
          </span>
          {controller.executing ? <LoaderCircle className={styles.spinner} size={14} aria-hidden="true" /> : null}
        </div>
      ) : null}

      {state.level === 'root' ? (
        <div
          id={listId}
          className={styles.list}
          role="listbox"
          aria-label={t('agent.slash.commands.title')}
        >
          {resourceCommandIds.length > 0 ? (
            <>
              <div className={styles['group-label']} aria-hidden="true">{t('agent.slash.groups.resources')}</div>
              {resourceCommandIds.map((commandId) => (
                <RootCommandOption
                  key={commandId}
                  commandId={commandId}
                  controller={controller}
                  selected={state.active_id === commandId}
                  executing={controller.executing}
                  onPointerMove={onPointerMove}
                  onSelect={controller.onSelectCommand}
                />
              ))}
            </>
          ) : null}
          {controller.rootCommandIds.includes('compact') ? (
            <Fragment>
              <div className={`${styles['group-label']} ${styles['group-label-secondary']}`} aria-hidden="true">
                {t('agent.slash.groups.context')}
              </div>
              <RootCommandOption
                commandId="compact"
                controller={controller}
                selected={state.active_id === 'compact'}
                executing={controller.executing}
                onPointerMove={onPointerMove}
                onSelect={controller.onSelectCommand}
              />
            </Fragment>
          ) : null}
        </div>
      ) : null}

      {state.level === 'kind' ? (
        <div
          ref={kindListRef}
          id={listId}
          className={styles.list}
          role="listbox"
          tabIndex={-1}
          aria-label={t('agent.slash.resourceKind.title')}
          aria-activedescendant={controller.activeOptionId}
          onKeyDown={controller.onMenuKeyDown}
        >
          {(['ssh', 'file'] as const).map((resourceKind) => {
            const kindAvailability = controller.resourceKindAvailability(state.command_id, resourceKind)
            const disabled = !kindAvailability.enabled || controller.executing
            return (
              <button
                key={resourceKind}
                id={agentSlashOptionId(controller.menuId, 'kind', resourceKind)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={state.active_id === resourceKind}
                aria-disabled={disabled}
                className={styles.option}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={(event) => onPointerMove(resourceKind, event, !disabled)}
                onClick={disabled ? undefined : () => controller.onSelectKind(resourceKind)}
              >
                <span className={styles.icon} aria-hidden="true">
                  {resourceKind === 'ssh' ? <Server size={15} /> : <FolderOpen size={15} />}
                </span>
                <span className={styles.copy}>
                  <strong>{t(`agent.slash.resourceKind.${resourceKind}.title`)}</strong>
                  <small>{disabled && kindAvailability.disabled_reason
                    ? disabledReason(kindAvailability.disabled_reason, t)
                    : t(`agent.slash.resourceKind.${resourceKind}.description`)}</small>
                </span>
                <ChevronRight className={styles.chevron} size={14} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      ) : null}

      {state.level === 'resource' ? (
        <>
          <label className={styles.search}>
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              value={state.query}
              placeholder={t('agent.slash.search')}
              aria-label={t('agent.slash.search')}
              aria-controls={listId}
              aria-activedescendant={controller.activeOptionId}
              onChange={(event) => controller.onSearch(event.currentTarget.value)}
              onKeyDown={controller.onMenuKeyDown}
            />
          </label>
          {resourceStatusText ? (
            <div id={resourceStatusId} className={styles['resource-status']} role="status">
              {controller.executing
                ? <LoaderCircle className={styles.spinner} size={13} aria-hidden="true" />
                : <Clock3 size={13} aria-hidden="true" />}
              <span>{resourceStatusText}</span>
            </div>
          ) : null}
          <div
            id={listId}
            className={`${styles.list} ${styles.resources}`}
            role="listbox"
            aria-label={t('agent.slash.resources.title')}
            aria-describedby={resourceStatusText ? resourceStatusId : undefined}
          >
            {controller.resourceCandidates.length > 0 ? controller.resourceCandidates.map((candidate) => {
              const optionDisabled = Boolean(candidate.disabled_reason || resourceKindDisabledReason)
                || controller.executing
              return (
                <CandidateOption
                  key={candidate.id}
                  candidate={candidate}
                  optionId={agentSlashOptionId(controller.menuId, 'resource', candidate.id)}
                  selected={state.active_id === candidate.id}
                  disabled={optionDisabled}
                  disabledReasonCode={candidate.disabled_reason}
                  onPointerMove={(activeId, event) => onPointerMove(activeId, event, !optionDisabled)}
                  onSelect={controller.onSelectCandidate}
                />
              )
            }) : (
              <div className={styles.empty}>{t(state.query ? 'agent.slash.searchEmpty' : 'agent.slash.resources.empty')}</div>
            )}
          </div>
        </>
      ) : null}

      <span className={styles.live} aria-live="polite">
        {t('agent.slash.results', {
          count: state.level === 'root'
            ? controller.rootCommandIds.length
            : state.level === 'kind' ? 2 : controller.resourceCandidates.length,
        })}
      </span>
    </div>
  )
}

function RootCommandOption({
  commandId,
  controller,
  selected,
  executing,
  onPointerMove,
  onSelect,
}: {
  commandId: AgentSlashCommandId
  controller: AgentSlashCommandController
  selected: boolean
  executing: boolean
  onPointerMove: (activeId: string, event: ReactPointerEvent, selectable?: boolean) => void
  onSelect: (commandId: AgentSlashCommandId) => void
}) {
  const { t } = useTranslation()
  const option = commandPresentation(commandId)
  const availability = controller.availability?.[commandId]
  const disabled = !availability?.enabled || executing
  return (
    <button
      id={agentSlashOptionId(controller.menuId, 'root', commandId)}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={disabled}
      className={`${styles.option} ${styles.command}`}
      onPointerDown={(event) => event.preventDefault()}
      onPointerMove={(event) => onPointerMove(commandId, event, !disabled)}
      onClick={disabled ? undefined : () => onSelect(commandId)}
    >
      <span className={styles.icon} aria-hidden="true">{option.icon}</span>
      <span className={styles.copy}>
        <strong>{`/${commandId}`}</strong>
        <small>{disabled && availability?.disabled_reason
          ? disabledReason(availability.disabled_reason, t)
          : t(option.descriptionKey)}</small>
      </span>
      {executing && selected ? (
        <LoaderCircle className={styles.spinner} size={14} aria-hidden="true" />
      ) : commandId === 'compact' ? null : (
        <ChevronRight className={styles.chevron} size={14} aria-hidden="true" />
      )}
    </button>
  )
}

function CandidateOption({
  candidate,
  optionId,
  selected,
  disabled,
  disabledReasonCode,
  onPointerMove,
  onSelect,
}: {
  candidate: AgentSlashCandidate
  optionId: string
  selected: boolean
  disabled: boolean
  disabledReasonCode?: string
  onPointerMove: (activeId: string, event: ReactPointerEvent) => void
  onSelect: (candidate: AgentSlashCandidate) => void
}) {
  const { t, i18n } = useTranslation()
  const status = t(`agent.slash.status.${candidate.status}`)
  return (
    <button
      id={optionId}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={disabled}
      className={`${styles.option} ${styles.resource}`}
      onPointerDown={(event) => event.preventDefault()}
      onPointerMove={(event) => onPointerMove(candidate.id, event)}
      onClick={disabled ? undefined : () => onSelect(candidate)}
    >
      <span className={styles.icon} aria-hidden="true">
        {candidate.resource_kind === 'ssh' ? <Server size={15} /> : <FolderOpen size={15} />}
      </span>
      <span className={styles.copy}>
        <strong>{candidate.host_name}</strong>
        <small>{candidate.profile_name}{candidate.kind === 'file_session' ? '' : ` · ${status}`}</small>
        {candidate.kind === 'ssh_session' ? (
          <small>{formatCandidateTime(candidate.started_at, i18n.resolvedLanguage ?? i18n.language)}{` · ${shortID(candidate.session_id)}`}</small>
        ) : candidate.kind === 'file_session' ? (
          <small>{t('agent.slash.sessionCount', { count: candidate.session_count })}{` · ${status}`}</small>
        ) : null}
        {disabledReasonCode ? <small className={styles.reason}>{disabledReason(disabledReasonCode, t)}</small> : null}
      </span>
      {candidate.current
        ? <Check className={styles.current} size={14} aria-label={t('agent.slash.current')} />
        : null}
    </button>
  )
}

function commandPresentation(commandId: AgentSlashCommandId) {
  if (commandId === 'session') {
    return { icon: <TerminalSquare size={15} />, descriptionKey: 'agent.slash.commands.session.description' }
  }
  if (commandId === 'profile') {
    return { icon: <UserRoundCog size={15} />, descriptionKey: 'agent.slash.commands.profile.description' }
  }
  return { icon: <Minimize2 size={15} />, descriptionKey: 'agent.slash.commands.compact.description' }
}

function levelTitle(
  level: 'root' | 'kind' | 'resource',
  commandId: Exclude<AgentSlashCommandId, 'compact'> | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (level === 'root') return t('agent.slash.commands.title')
  if (level === 'kind') return t(`agent.slash.commands.${commandId}.title`)
  return t('agent.slash.resources.title')
}

function disabledReason(
  reason: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return t(`agent.slash.disabled.${reason}`, { defaultValue: reason })
}

function shortID(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`
}

function formatCandidateTime(value: string, language: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

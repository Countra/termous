import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  Command,
  LoaderCircle,
  KeyRound,
  RotateCcw,
  Search,
  Send,
  Server,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { Alert, Button, Checkbox, Input, Modal, Progress, Skeleton, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApiError, type TermousApi } from '../../api/client'
import { AuthMethodBadge, HostAvatar } from '#entities/host'
import { ConfirmDialog } from '#shared/ui'
import type {
  AliasSyncTask,
  AliasSyncTaskSource,
  AliasSyncTarget,
  CredentialView,
  Host,
  HostGroup,
  HostReachability,
  Session,
  ShellAlias,
} from '../../types/domain'
import {
  aliasSyncCloseNeedsCancellation,
  aliasSyncProgress,
  aliasSyncTaskMatchesRequest,
  isAliasSyncStartOutcomeUnknown,
  isAliasSyncTaskTerminal,
} from './aliasSyncTaskState'
import {
  groupAliasSyncHosts,
  isAliasSyncHostSelectable,
  orderAliasSyncHosts,
  orderAliasSyncSelectionIds,
} from './aliasSyncSelection'
import { useAliasSyncTask } from './useAliasSyncTask'
import { aliasSyncErrorDescription } from './aliasPanelHelpers'
import './alias-sync-modal.css'

interface AliasSyncModalProps {
  api: TermousApi
  open: boolean
  sourceSession: Session
  sourceAliases: readonly ShellAlias[]
  sourceShell?: 'bash' | 'zsh' | 'fish'
  hosts: readonly Host[]
  groups: readonly HostGroup[]
  credentials: readonly CredentialView[]
  reachability: Readonly<Record<string, HostReachability>>
  onClose: () => void
}

export function AliasSyncModal({
  api,
  open,
  sourceSession,
  sourceAliases,
  sourceShell,
  hosts,
  groups,
  credentials,
  reachability,
  onClose,
}: AliasSyncModalProps) {
  const { t } = useTranslation()
  const sync = useAliasSyncTask({ api, enabled: open })
  const [selectedAliasIds, setSelectedAliasIds] = useState<string[]>([])
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([])
  const [aliasQuery, setAliasQuery] = useState('')
  const [hostQuery, setHostQuery] = useState('')
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [closeConfirmBusy, setCloseConfirmBusy] = useState(false)
  const pendingCloseRef = useRef(false)
  const sourceHost = useMemo(
    () => hosts.find((host) => host.id === sourceSession.host_id),
    [hosts, sourceSession.host_id],
  )
  const eligibleHosts = useMemo(
    () => orderAliasSyncHosts(hosts, groups, sourceSession.host_id),
    [groups, hosts, sourceSession.host_id],
  )
  const credentialIds = useMemo(
    () => new Set(credentials.map((credential) => credential.id)),
    [credentials],
  )
  const selectableHosts = useMemo(
    () => eligibleHosts.filter((host) => isAliasSyncHostSelectable(host, credentialIds)),
    [credentialIds, eligibleHosts],
  )
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [host.id, host])),
    [hosts],
  )
  const groupNameById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  )
  const normalizedAliasQuery = aliasQuery.trim().toLocaleLowerCase()
  const visibleAliases = useMemo(
    () => sourceAliases.filter((alias) => !normalizedAliasQuery || [
      alias.name,
      alias.command,
      alias.description ?? '',
    ].some((value) => value.toLocaleLowerCase().includes(normalizedAliasQuery))),
    [normalizedAliasQuery, sourceAliases],
  )
  const normalizedHostQuery = hostQuery.trim().toLocaleLowerCase()
  const visibleHosts = useMemo(
    () => eligibleHosts.filter((host) => {
      if (!normalizedHostQuery) {
        return true
      }
      const searchable = [
        host.name,
        host.address,
        host.username,
        groupNameById.get(host.group_id) ?? '',
        ...(host.tags ?? []),
      ].join(' ').toLocaleLowerCase()
      return searchable.includes(normalizedHostQuery)
    }),
    [eligibleHosts, groupNameById, normalizedHostQuery],
  )
  const visibleHostSections = useMemo(
    () => groupAliasSyncHosts(visibleHosts, groups),
    [groups, visibleHosts],
  )
  const orderedSelectedAliasIds = useMemo(
    () => orderAliasSyncSelectionIds(sourceAliases, selectedAliasIds),
    [selectedAliasIds, sourceAliases],
  )
  const orderedSelectedHostIds = useMemo(
    () => orderAliasSyncSelectionIds(selectableHosts, selectedHostIds),
    [selectableHosts, selectedHostIds],
  )
  const task = sync.task
  const selectionLocked = sync.recovering || sync.starting || Boolean(task)
  const allAliasesSelected = sourceAliases.length > 0 && orderedSelectedAliasIds.length === sourceAliases.length
  const allHostsSelected = selectableHosts.length > 0 && orderedSelectedHostIds.length === selectableHosts.length
  const canStart = Boolean(
    sourceSession.id &&
    sourceSession.host_id &&
    sourceShell &&
    orderedSelectedAliasIds.length > 0 &&
    orderedSelectedHostIds.length > 0 &&
    !selectionLocked,
  )
  const canSyncAgain = Boolean(
    sourceShell &&
    sourceAliases.length > 0 &&
    task?.source.session_id === sourceSession.id,
  )

  useEffect(() => {
    if (!open) {
      return
    }
    setSelectedAliasIds([])
    setSelectedHostIds([])
    setAliasQuery('')
    setHostQuery('')
    setCloseConfirmOpen(false)
    setCloseConfirmBusy(false)
    pendingCloseRef.current = false
  }, [open, sourceSession.id])

  useEffect(() => {
    const aliasIds = new Set(sourceAliases.map((alias) => alias.id))
    setSelectedAliasIds((current) => current.filter((aliasId) => aliasIds.has(aliasId)))
  }, [sourceAliases])

  useEffect(() => {
    const selectableHostIds = new Set(selectableHosts.map((host) => host.id))
    setSelectedHostIds((current) => current.filter((hostId) => selectableHostIds.has(hostId)))
  }, [selectableHosts])

  const finishClose = () => {
    pendingCloseRef.current = false
    setCloseConfirmOpen(false)
    setCloseConfirmBusy(false)
    sync.reset()
    onClose()
  }

  const requestClose = () => {
    if (closeConfirmBusy) {
      return
    }
    if (aliasSyncCloseNeedsCancellation(sync.starting, task?.status)) {
      setCloseConfirmOpen(true)
      return
    }
    finishClose()
  }

  const confirmCancelAndClose = async () => {
    if (closeConfirmBusy) {
      return
    }
    setCloseConfirmBusy(true)
    if (sync.starting && !task) {
      pendingCloseRef.current = true
      return
    }
    try {
      await sync.cancelAndWait()
      finishClose()
    } catch {
      setCloseConfirmOpen(false)
    } finally {
      setCloseConfirmBusy(false)
    }
  }

  const startSync = async () => {
    if (!canStart) {
      return
    }
    const request = {
      alias_ids: orderedSelectedAliasIds,
      target_host_ids: orderedSelectedHostIds,
    }
    let taskCreated = false
    try {
      await sync.start(sourceSession.id, request)
      taskCreated = true
      if (pendingCloseRef.current) {
        await sync.cancelAndWait()
        finishClose()
      }
    } catch (error) {
      const startOutcomeUnknown = error instanceof TermousApiError &&
        isAliasSyncStartOutcomeUnknown(error.code, error.status)
      if (pendingCloseRef.current && !taskCreated && startOutcomeUnknown) {
        try {
          const activeTask = await sync.recoverActive()
          if (activeTask && aliasSyncTaskMatchesRequest(
            activeTask,
            sourceSession.id,
            request.alias_ids,
            request.target_host_ids,
          )) {
            await sync.cancelAndWait()
          }
          finishClose()
        } catch {
          pendingCloseRef.current = false
          setCloseConfirmOpen(false)
          setCloseConfirmBusy(false)
        }
      } else if (pendingCloseRef.current) {
        pendingCloseRef.current = false
        setCloseConfirmOpen(false)
        setCloseConfirmBusy(false)
      }
    }
  }

  const resetTask = () => {
    sync.reset()
    setSelectedAliasIds([])
    setSelectedHostIds([])
  }

  const footer = task ? (
    <div className="alias-sync-modal-actions">
      <span className="alias-sync-selected-summary">{t('workbench.aliases.sync.selectedSummary', {
        aliases: task.alias_ids.length,
        hosts: task.target_host_ids.length,
      })}</span>
      <span className="alias-sync-modal-action-buttons">
        {isAliasSyncTaskTerminal(task.status) && canSyncAgain ? (
          <Button icon={<RotateCcw size={14} />} onClick={resetTask}>
            {t('workbench.aliases.sync.syncAgain')}
          </Button>
        ) : null}
        <Button type="primary" danger={!isAliasSyncTaskTerminal(task.status)} onClick={requestClose}>
          {t(isAliasSyncTaskTerminal(task.status)
            ? 'app.close'
            : 'workbench.aliases.sync.cancelSync')}
        </Button>
      </span>
    </div>
  ) : (
    <div className="alias-sync-modal-actions">
      <span className="alias-sync-selected-summary">{t('workbench.aliases.sync.selectedSummary', {
        aliases: orderedSelectedAliasIds.length,
        hosts: orderedSelectedHostIds.length,
      })}</span>
      <span className="alias-sync-modal-action-buttons">
        <Button onClick={requestClose}>
          {t('app.cancel')}
        </Button>
        <Button
          type="primary"
          icon={<Send size={14} />}
          loading={sync.starting}
          disabled={!canStart}
          onClick={() => void startSync()}
        >
          {t('workbench.aliases.sync.start')}
        </Button>
      </span>
    </div>
  )

  return (
    <>
      <Modal
        open={open}
        width="min(calc(100vw - 24px), 820px)"
        centered
        destroyOnHidden
        keyboard={!closeConfirmOpen}
        mask={{ closable: !closeConfirmOpen }}
        closable={!closeConfirmOpen}
        zIndex={3700}
        rootClassName="termous-modal-root alias-sync-modal-root"
        className="alias-sync-modal"
        title={(
          <span className="alias-sync-modal-title">
            <Send size={17} aria-hidden="true" />
            <span>{t('workbench.aliases.sync.title')}</span>
          </span>
        )}
        footer={footer}
        onCancel={requestClose}
      >
        <div className="alias-sync-modal-body">
          <SourceSummary
            api={api}
            host={task
              ? task.source.host_id ? hostById.get(task.source.host_id) : undefined
              : sourceHost}
            snapshot={task?.source}
            shell={task ? task.source.shell : sourceShell}
            totalAliases={task ? task.alias_ids.length : sourceAliases.length}
          />

          {sync.errorMessage ? (
            <Alert
              type="error"
              showIcon
              message={t('workbench.aliases.sync.errorTitle')}
              description={aliasSyncErrorDescription(sync.errorCode, sync.errorMessage, t)}
              className="alias-sync-alert"
            />
          ) : null}

          {sync.recovering && !task ? (
            <div className="alias-sync-recovering" role="status" aria-label={t('workbench.aliases.sync.recovering')}>
              <Skeleton active title={{ width: '38%' }} paragraph={{ rows: 7 }} />
            </div>
          ) : task ? (
            <AliasSyncProgressView task={task} hosts={hostById} api={api} />
          ) : (
            <div className="alias-sync-picker-grid">
              <SelectionColumn
                icon={<Command size={15} />}
                title={t('workbench.aliases.sync.aliasesTitle')}
                count={orderedSelectedAliasIds.length}
                total={sourceAliases.length}
                query={aliasQuery}
                queryPlaceholder={t('workbench.aliases.sync.aliasSearchPlaceholder')}
                allSelected={allAliasesSelected}
                indeterminate={orderedSelectedAliasIds.length > 0 && !allAliasesSelected}
                disabled={selectionLocked || sourceAliases.length === 0}
                empty={visibleAliases.length === 0}
                emptyText={t(sourceAliases.length === 0
                  ? 'workbench.aliases.sync.noAliases'
                  : 'workbench.aliases.sync.noAliasResults')}
                onQueryChange={setAliasQuery}
                onSelectAll={(checked) => setSelectedAliasIds(
                  checked ? sourceAliases.map((alias) => alias.id) : [],
                )}
              >
                {visibleAliases.map((alias) => (
                  <Checkbox
                    key={alias.id}
                    className="alias-sync-select-row alias-sync-alias-row"
                    checked={selectedAliasIds.includes(alias.id)}
                    disabled={selectionLocked}
                    onChange={(event) => setSelectedAliasIds((current) => toggleID(
                      current,
                      alias.id,
                      event.target.checked,
                    ))}
                  >
                    <span className="alias-sync-row-copy">
                      <strong>{alias.name}</strong>
                      <code>{alias.command}</code>
                    </span>
                    <span className={`alias-sync-enabled-dot ${alias.enabled ? 'is-enabled' : ''}`} title={t(alias.enabled
                      ? 'workbench.aliases.enabledStatus'
                      : 'workbench.aliases.disabledStatus')} />
                  </Checkbox>
                ))}
              </SelectionColumn>

              <SelectionColumn
                icon={<Server size={15} />}
                title={t('workbench.aliases.sync.hostsTitle')}
                count={orderedSelectedHostIds.length}
                total={eligibleHosts.length}
                query={hostQuery}
                queryPlaceholder={t('workbench.aliases.sync.hostSearchPlaceholder')}
                allSelected={allHostsSelected}
                indeterminate={orderedSelectedHostIds.length > 0 && !allHostsSelected}
                disabled={selectionLocked || selectableHosts.length === 0}
                empty={visibleHosts.length === 0}
                emptyText={t(eligibleHosts.length === 0
                  ? 'workbench.aliases.sync.noHosts'
                  : 'workbench.aliases.sync.noHostResults')}
                onQueryChange={setHostQuery}
                onSelectAll={(checked) => setSelectedHostIds(
                  checked ? selectableHosts.map((host) => host.id) : [],
                )}
              >
                {visibleHostSections.map((section) => (
                  <section key={section.id || 'ungrouped'} className="alias-sync-host-section">
                    <header>
                      <strong>{section.name || t('workbench.aliases.sync.ungroupedHosts')}</strong>
                      <span>{section.hosts.length}</span>
                    </header>
                    {section.hosts.map((host) => {
                      const missingCredential = !isAliasSyncHostSelectable(host, credentialIds)
                      return (
                        <SelectableHostRow
                          key={host.id}
                          api={api}
                          host={host}
                          reachability={reachability[host.id]}
                          checked={selectedHostIds.includes(host.id)}
                          disabled={selectionLocked}
                          missingCredential={missingCredential}
                          onChange={(checked) => setSelectedHostIds((current) => toggleID(
                            current,
                            host.id,
                            checked,
                          ))}
                        />
                      )
                    })}
                  </section>
                ))}
              </SelectionColumn>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={closeConfirmOpen}
        zIndex={3900}
        danger
        title={t('workbench.aliases.sync.cancelTitle')}
        description={t('workbench.aliases.sync.cancelDescription')}
        confirmLabel={t('workbench.aliases.sync.cancelAndClose')}
        confirmLoading={closeConfirmBusy}
        onConfirm={() => void confirmCancelAndClose()}
        onCancel={() => {
          if (!closeConfirmBusy) {
            setCloseConfirmOpen(false)
          }
        }}
      />
    </>
  )
}

interface SourceSummaryProps {
  api: TermousApi
  host?: Host
  snapshot?: AliasSyncTaskSource
  shell?: 'bash' | 'zsh' | 'fish'
  totalAliases: number
}

function SourceSummary({ api, host, snapshot, shell, totalAliases }: SourceSummaryProps) {
  const { t } = useTranslation()
  const displayName = snapshot?.host_name ?? host?.name ?? t('workbench.aliases.sync.unknownSource')
  const address = snapshot?.address ?? host?.address
  const port = snapshot?.port ?? host?.port
  const username = snapshot?.username ?? host?.username
  return (
    <div className="alias-sync-source-summary">
      <HostAvatar
        host={host ?? (displayName ? { name: displayName } : undefined)}
        getIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
        size={34}
      />
      <span className="alias-sync-source-copy">
        <small>{t('workbench.aliases.sync.source')}</small>
        <strong>{displayName}</strong>
        {address ? <span>{username ? `${username}@` : ''}{address}{port ? `:${port}` : ''}</span> : null}
      </span>
      <span className="alias-sync-source-metric">
        <strong>{shell ?? '—'}</strong>
        <small>{t('workbench.aliases.sync.shellMetric')}</small>
      </span>
      <span className="alias-sync-source-metric">
        <strong>{totalAliases}</strong>
        <small>{t('workbench.aliases.sync.aliasTotalMetric')}</small>
      </span>
    </div>
  )
}

interface SelectionColumnProps {
  icon: ReactNode
  title: string
  count: number
  total: number
  query: string
  queryPlaceholder: string
  allSelected: boolean
  indeterminate: boolean
  disabled: boolean
  empty: boolean
  emptyText: string
  children: ReactNode
  onQueryChange: (value: string) => void
  onSelectAll: (checked: boolean) => void
}

function SelectionColumn({
  icon,
  title,
  count,
  total,
  query,
  queryPlaceholder,
  allSelected,
  indeterminate,
  disabled,
  empty,
  emptyText,
  children,
  onQueryChange,
  onSelectAll,
}: SelectionColumnProps) {
  const { t } = useTranslation()
  return (
    <section className="alias-sync-selection-column">
      <header>
        <span className="alias-sync-selection-heading">{icon}<strong>{title}</strong></span>
        <span className="alias-sync-selection-count">{count} / {total}</span>
      </header>
      <div className="alias-sync-selection-tools">
        <Input
          value={query}
          allowClear
          prefix={<Search size={14} aria-hidden="true" />}
          placeholder={queryPlaceholder}
          disabled={disabled}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <Checkbox
          checked={allSelected}
          indeterminate={indeterminate}
          disabled={disabled}
          onChange={(event) => onSelectAll(event.target.checked)}
        >
          {t('workbench.aliases.sync.selectAll')}
        </Checkbox>
      </div>
      <div className={`alias-sync-selection-list ${empty ? 'is-empty' : ''}`}>
        {empty ? (
          <div className="alias-sync-selection-empty">{emptyText}</div>
        ) : children}
      </div>
    </section>
  )
}

interface SelectableHostRowProps {
  api: TermousApi
  host: Host
  reachability?: HostReachability
  checked: boolean
  disabled: boolean
  missingCredential: boolean
  onChange: (checked: boolean) => void
}

function SelectableHostRow({
  api,
  host,
  reachability,
  checked,
  disabled,
  missingCredential,
  onChange,
}: SelectableHostRowProps) {
  const { t } = useTranslation()
  const offline = reachability?.status === 'offline'
  const tooltip = missingCredential
    ? t('workbench.aliases.sync.missingCredential')
    : offline
      ? t('workbench.aliases.sync.offlineHint')
      : undefined
  return (
    <Tooltip
      title={tooltip}
      zIndex={3800}
      classNames={{ root: 'termous-tooltip alias-sync-host-tooltip' }}
    >
      <Checkbox
        className={`alias-sync-select-row alias-sync-host-row ${missingCredential ? 'is-disabled' : ''}`}
        checked={checked}
        disabled={disabled || missingCredential}
        onChange={(event) => onChange(event.target.checked)}
      >
        <HostAvatar
          host={host}
          getIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
          size={27}
        />
        <span className="alias-sync-row-copy">
          <strong>{host.name}</strong>
          <span>{host.username}@{host.address}:{host.port}</span>
        </span>
        <span className="alias-sync-host-trailing">
          <span className="alias-sync-host-state">
            {missingCredential
              ? <KeyRound size={13} className="is-blocked" aria-label={t('workbench.aliases.sync.missingCredential')} />
              : offline
                ? <WifiOff size={13} className="is-offline" aria-label={t('workbench.aliases.sync.offlineHint')} />
                : null}
          </span>
          <span className="alias-sync-host-auth">
            <AuthMethodBadge method={host.auth_method} />
          </span>
        </span>
      </Checkbox>
    </Tooltip>
  )
}

interface AliasSyncProgressViewProps {
  task: AliasSyncTask
  hosts: ReadonlyMap<string, Host>
  api: TermousApi
}

function AliasSyncProgressView({ task, hosts, api }: AliasSyncProgressViewProps) {
  const { t } = useTranslation()
  const progress = aliasSyncProgress(task)
  const terminal = isAliasSyncTaskTerminal(task.status)
  const progressStatus = task.status === 'completed'
    ? 'success'
    : task.status === 'cancelled'
      ? 'normal'
      : terminal
      ? 'exception'
      : 'active'
  const currentTarget = task.current_target_index === undefined
    ? undefined
    : task.targets[task.current_target_index]
  const summary = task.error_code
    ? aliasSyncErrorDescription(task.error_code, task.error_message ?? '', t)
    : task.error_message
      ? task.error_message
    : currentTarget?.phase
      ? t(`workbench.aliases.sync.targetPhase.${currentTarget.phase}`)
      : isAliasSyncTaskTerminal(task.status)
        ? t(`workbench.aliases.sync.taskStatus.${task.status}`)
        : t('workbench.aliases.sync.progressSummary', {
          completed: task.completed_targets,
          total: task.total_targets,
        })
  return (
    <section className="alias-sync-progress-view" aria-live="polite">
      <div className="alias-sync-progress-head">
        <div>
          <span className={`alias-sync-task-status is-${taskStatusTone(task.status)}`}>
            {taskStatusIcon(task.status)}
            {t(`workbench.aliases.sync.taskStatus.${task.status}`)}
          </span>
          <strong>{t('workbench.aliases.sync.progressTitle')}</strong>
          <small>{summary}</small>
        </div>
        <span className="alias-sync-progress-value">{progress}%</span>
      </div>
      <Progress percent={progress} status={progressStatus} showInfo={false} />
      <div className="alias-sync-result-metrics">
        <ResultMetric value={task.succeeded_targets} label={t('workbench.aliases.sync.succeeded')} tone="success" />
        <ResultMetric value={task.skipped_targets} label={t('workbench.aliases.sync.skipped')} tone="muted" />
        <ResultMetric value={task.failed_targets} label={t('workbench.aliases.sync.failed')} tone="danger" />
        <ResultMetric value={task.uncertain_targets} label={t('workbench.aliases.sync.uncertain')} tone="danger" />
        <ResultMetric value={task.cancelled_targets} label={t('workbench.aliases.sync.cancelled')} tone="muted" />
        <ResultMetric value={Math.max(0, task.total_targets - task.completed_targets)} label={t('workbench.aliases.sync.remaining')} tone="active" />
      </div>
      <div className="alias-sync-target-list" role="list" aria-label={t('workbench.aliases.sync.targetList')}>
        {task.targets.map((target) => (
          <TargetResultRow
            key={target.id || `${target.host_id}-${target.index}`}
            target={target}
            host={hosts.get(target.host_id)}
            api={api}
          />
        ))}
      </div>
    </section>
  )
}

function ResultMetric({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <span className={`alias-sync-result-metric is-${tone}`}>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  )
}

function TargetResultRow({ target, host, api }: { target: AliasSyncTarget; host?: Host; api: TermousApi }) {
  const { t } = useTranslation()
  const tone = targetStatusTone(target.status)
  const resultDetails: string[] = []
  if (target.error_code) {
    resultDetails.push(aliasSyncErrorDescription(target.error_code, target.error_message ?? '', t))
  } else if (target.error_message) {
    resultDetails.push(target.error_message)
  } else if (target.skip_reason) {
    resultDetails.push(t(`workbench.aliases.sync.skipReason.${target.skip_reason}`))
  } else {
    if (target.added_count > 0) {
      resultDetails.push(t(target.added_names.length > 0
        ? 'workbench.aliases.sync.addedAliases'
        : 'workbench.aliases.sync.addedCount', {
        count: target.added_count,
        names: target.added_names.join(', '),
      }))
    }
    if (target.skipped_count > 0) {
      resultDetails.push(t(target.skipped_names.length > 0
        ? 'workbench.aliases.sync.skippedAliases'
        : 'workbench.aliases.sync.skippedCount', {
        count: target.skipped_count,
        names: target.skipped_names.join(', '),
      }))
    }
    if (resultDetails.length === 0) {
      resultDetails.push(target.phase
        ? t(`workbench.aliases.sync.targetPhase.${target.phase}`)
        : t(`workbench.aliases.sync.targetStatus.${target.status}`))
    }
  }
  const applyStatusDetail = target.status === 'succeeded' && target.apply_status
    ? t(`workbench.aliases.sync.applyStatus.${target.apply_status}`)
    : ''
  const detail = [...resultDetails, applyStatusDetail].filter(Boolean).join(' · ')
  return (
    <article className={`alias-sync-target-row is-${tone}`} role="listitem">
      <span className="alias-sync-target-state" aria-hidden="true">{targetStatusIcon(target.status)}</span>
      <HostAvatar
        host={host ?? (target.host_name ? { name: target.host_name } : undefined)}
        getIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
        size={29}
      />
      <span className="alias-sync-target-copy">
        <strong>{target.host_name ?? host?.name ?? target.host_id}</strong>
        {target.address || host?.address ? (
          <span className="alias-sync-target-endpoint">
            {target.username || host?.username ? `${target.username ?? host?.username}@` : ''}
            {target.address ?? host?.address}
            {target.port || host?.port ? `:${target.port || host?.port}` : ''}
            {target.detected_shell ? ` · ${target.detected_shell}` : ''}
          </span>
        ) : null}
        <small>{detail}</small>
      </span>
      <span className="alias-sync-target-status-label">
        {t(`workbench.aliases.sync.targetStatus.${target.status}`)}
      </span>
    </article>
  )
}

function toggleID(current: string[], id: string, checked: boolean) {
  if (checked) {
    return current.includes(id) ? current : [...current, id]
  }
  return current.filter((item) => item !== id)
}

function taskStatusTone(status: string) {
  if (status === 'completed') return 'success'
  if (status === 'cancelled') return 'muted'
  if (status === 'failed' || status === 'partial_failed') return 'danger'
  return 'active'
}

function targetStatusTone(status: string) {
  if (status === 'succeeded' || status === 'skipped') return 'success'
  if (status === 'failed' || status === 'uncertain') return 'danger'
  if (status === 'cancelled') return 'muted'
  return 'active'
}

function taskStatusIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 size={14} />
  if (status === 'failed' || status === 'partial_failed') return <AlertTriangle size={14} />
  if (status === 'cancelled') return <XCircle size={14} />
  if (status === 'queued') return <Clock3 size={14} />
  return <LoaderCircle className="is-spinning" size={14} />
}

function targetStatusIcon(status: string) {
  if (status === 'succeeded' || status === 'skipped') return <CheckCircle2 size={15} />
  if (status === 'failed' || status === 'uncertain') return <AlertTriangle size={15} />
  if (status === 'cancelled') return <XCircle size={15} />
  if (status === 'running') return <LoaderCircle className="is-spinning" size={15} />
  return <Circle size={15} />
}

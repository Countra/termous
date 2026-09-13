import { Button, Select, Tooltip } from 'antd'
import { Check, FolderOpen, Link2Off, RefreshCw, ServerCog, TerminalSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog, ConnectionActionButton, FilterPopover, customSelectStyles, uiStyles } from '#shared/ui'
import { resourceReference, resourceReferenceId, resourceProfileName, resourceBindingMatchesSource, sameAgentResourceSource,
  type AgentResourceReference, type AgentResourceState } from '#entities/agent'
import type { AgentWorkspaceResourceContext, AgentWorkspaceSSHProfileAssociationMode } from '../model/types.ts'
import styles from './AgentResourceBindingControl.module.scss'
import { AgentResourceRecoveryActions } from './AgentResourceRecoveryActions.tsx'

const resourceTooltipClassNames = { root: `${uiStyles.tooltip} termous-tooltip` }

export function AgentResourceBindingControl({
  context,
  disabled,
  onReplace,
  onRemove,
  sshProfileAssociationMode = 'on_demand',
  recoveryDisabled = false,
  onRecover,
  onCancelRecovery,
}: {
  context: AgentWorkspaceResourceContext
  disabled: boolean
  onReplace: (reference: AgentResourceReference) => Promise<boolean>
  onRemove: () => Promise<boolean>
  sshProfileAssociationMode?: AgentWorkspaceSSHProfileAssociationMode
  recoveryDisabled?: boolean
  onRecover?: () => Promise<boolean>
  onCancelRecovery?: () => Promise<boolean>
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const tooltipSuppressedRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [detachOpen, setDetachOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [candidateSource, setCandidateSource] = useState<AgentResourceState>()
  const bindingId = resourceReferenceId(resourceReference(context.binding))
  const file = context.binding.kind === 'file_profile'
  const profile = context.binding.kind === 'ssh_profile'
  const hasRecovery = context.binding.kind === 'ssh_session' && Boolean(onRecover && onCancelRecovery)
  const ResourceIcon = profile ? ServerCog : file ? FolderOpen : TerminalSquare
  const copy = file ? 'agent.fileResource' : profile ? 'agent.sshProfileResource' : 'agent.resource'
  const candidates = useMemo(
    () => context.candidates.filter((candidate) => resourceReference(candidate).kind === context.binding.kind
      && !resourceBindingMatchesSource(context.binding, candidate)),
    [context.binding, context.candidates],
  )
  const candidate = candidateSource && candidates.find((source) => sameAgentResourceSource(candidateSource, source))
  const candidateId = candidate ? resourceReferenceId(resourceReference(candidate)) : undefined

  useEffect(() => {
    if (!open) {
      setEditing(false)
      setCandidateSource(undefined)
    }
  }, [open])

  useEffect(() => {
    if (candidateSource && !candidate) {
      setCandidateSource(undefined)
    }
  }, [candidateSource, candidate])

  useEffect(() => {
    if (!disabled || pending) return
    setEditing(false)
    setCandidateSource(undefined)
    setDetachOpen(false)
  }, [disabled, pending])

  const suppressTooltip = () => {
    tooltipSuppressedRef.current = true
    setTooltipOpen(false)
  }
  const run = async (operation: () => Promise<boolean>, after: () => void) => {
    if (pending || disabled) return
    suppressTooltip()
    setPending(true)
    try {
      if (await operation()) after()
    } finally {
      setPending(false)
    }
  }
  const live = context.live_resource
  const candidateReady = Boolean(candidate)
  const statusLabel = t(profile ? `${copy}.status.${context.status}` : `agent.resource.status.${context.status}`)
  const sessionLabel = shortID(bindingId)
  const handlePopoverOpenChange = (nextOpen: boolean) => {
    suppressTooltip()
    setOpen(nextOpen)
  }
  const content = (
    <div className={styles.popover} role="group" aria-label={t(`${copy}.details`)}>
      <div className={styles.heading}>
        <span className={styles.icon}><ResourceIcon size={17} aria-hidden="true" /></span>
        <span><strong>{context.binding.host_name}</strong><small>{statusLabel}</small></span>
      </div>
      <dl className={styles.details}>
        <div><dt>{t('agent.resource.host')}</dt><dd>{live?.host_name ?? context.binding.host_name}</dd></div>
        <div><dt>{t(`${copy}.profile`)}</dt><dd>{live ? resourceProfileName(live) : context.binding.kind === 'file_profile'
          ? context.binding.file_access_profile_name
          : context.binding.kind === 'ssh_profile' ? context.binding.ssh_profile_name : context.binding.ssh_profile_id}</dd></div>
        {!profile ? (
          <div><dt>{t(`${copy}.session`)}</dt><dd title={bindingId}>{sessionLabel}</dd></div>
        ) : null}
        <div><dt>{t('agent.resource.boundAt')}</dt><dd>{formatDate(context.binding.bound_at, i18n.language)}</dd></div>
      </dl>
      {context.status !== 'ready' && !hasRecovery ? (
        <p className={styles.warning} role="status">{t(`${copy}.hint.${context.status}`)}</p>
      ) : null}
      {context.binding.kind === 'ssh_session' && onRecover && onCancelRecovery
        && (context.status !== 'ready' || context.recovery?.view?.operation) ? (
          <AgentResourceRecoveryActions binding={context.binding} state={context.recovery}
            disabled={recoveryDisabled} connectionReady={context.status === 'ready'} onRecover={onRecover} onCancel={onCancelRecovery} />
        ) : null}
      {editing ? (
        <div className={styles.rebind}>
          <Select
            value={candidateId}
            className={`${customSelectStyles.select} ${styles.select} termous-select`}
            classNames={{
              popup: {
                root: `${customSelectStyles['select-popup']} termous-select-popup`,
              },
            }}
            disabled={pending || disabled}
            placeholder={t(`${copy}.selectPlaceholder`)}
            aria-label={t(`${copy}.selectLabel`)}
            options={candidates.map((candidate) => ({
              value: resourceReferenceId(resourceReference(candidate)),
              label: [candidate.host_name, resourceProfileName(candidate),
                ...('started_at' in candidate ? [formatCandidateTime(candidate.started_at, i18n.language)] : []),
                shortID(resourceReferenceId(resourceReference(candidate)))].join(' · '),
            }))}
            notFoundContent={t(`${copy}.noCandidates`)}
            onChange={(id: string) => setCandidateSource(candidates.find((source) => resourceReferenceId(resourceReference(source)) === id))}
          />
          <div className={styles['rebind-actions']}>
            <Button size="small" className={`${uiStyles['secondary-button']} ${styles['action-button']}`} disabled={pending} onClick={() => setEditing(false)}>{t('app.cancel')}</Button>
            <ConnectionActionButton
              size="small"
              className={styles['action-button']}
              icon={<Check size={13} />}
              loading={pending}
              disabled={!candidateReady || disabled}
              onClick={() => candidate && void run(
                () => onReplace(resourceReference(candidate)),
                () => { setOpen(false); setEditing(false); setCandidateSource(undefined) },
              )}
            >{t(profile
              ? `${copy}.${sshProfileAssociationMode === 'immediate' ? 'confirmReplaceImmediate' : 'confirmReplaceOnDemand'}`
              : 'agent.resource.confirmReplace')}</ConnectionActionButton>
          </div>
        </div>
      ) : (
        <div className={styles['footer-actions']}>
          <Button
            size="small"
            className={`${uiStyles['secondary-button']} ${styles['action-button']}`}
            icon={<RefreshCw size={13} />}
            disabled={disabled || pending || candidates.length === 0}
            onClick={() => setEditing(true)}
          >{t(profile ? `${copy}.replace` : 'agent.resource.replace')}</Button>
          <Button
            size="small"
            className={`${uiStyles['danger-button']} ${styles['action-button']}`}
            danger
            icon={<Link2Off size={13} />}
            disabled={disabled || pending}
            onClick={() => {
              suppressTooltip()
              setOpen(false)
              setDetachOpen(true)
            }}
          >{t(profile ? `${copy}.remove` : 'agent.resource.remove')}</Button>
        </div>
      )}
      {disabled ? <small className={styles.disabled}>{t('agent.resource.activeRunLocked')}</small> : null}
    </div>
  )

  return (
    <>
      <Tooltip
        title={t(`${copy}.tooltip`, { host: context.binding.host_name, status: statusLabel })}
        open={tooltipOpen && !open && !detachOpen && !pending}
        mouseEnterDelay={0.45}
        mouseLeaveDelay={0}
        destroyOnHidden
        classNames={resourceTooltipClassNames}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setTooltipOpen(false)
          } else if (!open && !detachOpen && !pending && !tooltipSuppressedRef.current) {
            setTooltipOpen(true)
          }
        }}
      >
        <FilterPopover
          open={open}
          placement="topLeft"
          content={content}
          destroyOnHidden
          getPopupContainer={() => document.body}
          onOpenChange={handlePopoverOpenChange}
        >
          <button
            type="button"
            className={styles.chip}
            data-resource-kind={context.binding.kind}
            data-resource-status={context.status}
            aria-label={t(`${copy}.aria`, {
              host: context.binding.host_name,
              status: statusLabel,
            })}
            aria-expanded={open}
            onMouseEnter={() => { tooltipSuppressedRef.current = false }}
            onMouseLeave={() => {
              tooltipSuppressedRef.current = false
              setTooltipOpen(false)
            }}
            onClick={suppressTooltip}
          >
            <ResourceIcon size={14} aria-hidden="true" />
            <span>{context.binding.host_name}</span>
            {!profile || context.status !== 'ready' ? <i aria-hidden="true" /> : null}
          </button>
        </FilterPopover>
      </Tooltip>
      <ConfirmDialog
        open={detachOpen && !disabled}
        title={t(`${copy}.removeTitle`)}
        description={t(`${copy}.removeDescription`, { host: context.binding.host_name })}
        confirmLabel={t(profile ? `${copy}.remove` : 'agent.resource.remove')}
        confirmLoading={pending}
        onCancel={() => setDetachOpen(false)}
        onConfirm={() => void run(onRemove, () => setDetachOpen(false))}
      />
    </>
  )
}

function shortID(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`
}

function formatDate(value: string, language: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function formatCandidateTime(value: string, language: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

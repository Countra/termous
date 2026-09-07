import { Button, Select, Tooltip } from 'antd'
import { Check, Link2Off, RefreshCw, TerminalSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog, FilterPopover, uiStyles } from '#shared/ui'
import type { AgentWorkspaceResourceContext } from '../model/types.ts'
import styles from './AgentResourceBindingControl.module.scss'

const resourceTooltipClassNames = { root: `${uiStyles.tooltip} termous-tooltip` }

export function AgentResourceBindingControl({
  context,
  disabled,
  onReplace,
  onRemove,
}: {
  context: AgentWorkspaceResourceContext
  disabled: boolean
  onReplace: (sessionId: string) => Promise<boolean>
  onRemove: () => Promise<boolean>
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const tooltipSuppressedRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [detachOpen, setDetachOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [candidateId, setCandidateId] = useState<string>()
  const candidates = useMemo(
    () => context.candidates.filter(({ session_id }) => session_id !== context.binding.session_id),
    [context.binding.session_id, context.candidates],
  )

  useEffect(() => {
    if (!open) {
      setEditing(false)
      setCandidateId(undefined)
    }
  }, [open])

  useEffect(() => {
    if (candidateId && !candidates.some(({ session_id }) => session_id === candidateId)) {
      setCandidateId(undefined)
    }
  }, [candidateId, candidates])

  useEffect(() => {
    if (!disabled || pending) return
    setEditing(false)
    setCandidateId(undefined)
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
  const candidateReady = candidates.some(({ session_id }) => session_id === candidateId)
  const statusLabel = t(`agent.resource.status.${context.status}`)
  const sessionLabel = shortID(context.binding.session_id)
  const handlePopoverOpenChange = (nextOpen: boolean) => {
    suppressTooltip()
    setOpen(nextOpen)
  }
  const content = (
    <div className={styles.popover} role="group" aria-label={t('agent.resource.details')}>
      <div className={styles.heading}>
        <span className={styles.icon}><TerminalSquare size={17} aria-hidden="true" /></span>
        <span><strong>{context.binding.host_name}</strong><small>{statusLabel}</small></span>
      </div>
      <dl className={styles.details}>
        <div><dt>{t('agent.resource.host')}</dt><dd>{live?.host_name ?? context.binding.host_name}</dd></div>
        <div><dt>{t('agent.resource.profile')}</dt><dd>{live?.ssh_profile_name ?? context.binding.ssh_profile_id}</dd></div>
        <div><dt>{t('agent.resource.session')}</dt><dd title={context.binding.session_id}>{sessionLabel}</dd></div>
        <div><dt>{t('agent.resource.boundAt')}</dt><dd>{formatDate(context.binding.bound_at, i18n.language)}</dd></div>
      </dl>
      {context.status !== 'ready' ? (
        <p className={styles.warning} role="status">{t(`agent.resource.hint.${context.status}`)}</p>
      ) : null}
      {editing ? (
        <div className={styles.rebind}>
          <Select
            value={candidateId}
            className={styles.select}
            disabled={pending || disabled}
            placeholder={t('agent.resource.selectPlaceholder')}
            aria-label={t('agent.resource.selectLabel')}
            options={candidates.map((candidate) => ({
              value: candidate.session_id,
              label: `${candidate.host_name} · ${candidate.ssh_profile_name} · ${formatCandidateTime(candidate.started_at, i18n.language)} · ${shortID(candidate.session_id)}`,
            }))}
            notFoundContent={t('agent.resource.noCandidates')}
            onChange={setCandidateId}
          />
          <div className={styles['rebind-actions']}>
            <Button size="small" disabled={pending} onClick={() => setEditing(false)}>{t('app.cancel')}</Button>
            <Button
              size="small"
              type="primary"
              icon={<Check size={13} />}
              loading={pending}
              disabled={!candidateReady || disabled}
              onClick={() => candidateId && candidateReady && void run(
                () => onReplace(candidateId),
                () => { setOpen(false); setEditing(false); setCandidateId(undefined) },
              )}
            >{t('agent.resource.confirmReplace')}</Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button
            size="small"
            icon={<RefreshCw size={13} />}
            disabled={disabled || pending || candidates.length === 0}
            onClick={() => setEditing(true)}
          >{t('agent.resource.replace')}</Button>
          <Button
            size="small"
            danger
            icon={<Link2Off size={13} />}
            disabled={disabled || pending}
            onClick={() => {
              suppressTooltip()
              setOpen(false)
              setDetachOpen(true)
            }}
          >{t('agent.resource.remove')}</Button>
        </div>
      )}
      {disabled ? <small className={styles.disabled}>{t('agent.resource.activeRunLocked')}</small> : null}
    </div>
  )

  return (
    <>
      <Tooltip
        title={t('agent.resource.tooltip', { host: context.binding.host_name, status: statusLabel })}
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
            data-resource-status={context.status}
            aria-label={t('agent.resource.aria', {
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
            <TerminalSquare size={14} aria-hidden="true" />
            <span>{context.binding.host_name}</span>
            <i aria-hidden="true" />
          </button>
        </FilterPopover>
      </Tooltip>
      <ConfirmDialog
        open={detachOpen && !disabled}
        title={t('agent.resource.removeTitle')}
        description={t('agent.resource.removeDescription', { host: context.binding.host_name })}
        confirmLabel={t('agent.resource.remove')}
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

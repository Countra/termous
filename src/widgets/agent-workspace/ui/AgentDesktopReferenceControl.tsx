import { Button, Select } from 'antd'
import { Link2Off, Monitor, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resourceBindingMatchesSource, resourceProfileName, resourceReference, resourceReferenceId, sameAgentResourceSource,
  type AgentDesktopResourceBinding, type AgentResourceReference, type AgentResourceState } from '#entities/agent'
import { ConfirmDialog, FilterPopover, customSelectStyles, uiStyles } from '#shared/ui'
import type { AgentWorkspaceResourceContext } from '../model/types.ts'
import styles from './AgentResourceBindingControl.module.scss'

export function AgentDesktopReferenceControl({ context, binding, disabled, onReplace, onRemove }: {
  context: AgentWorkspaceResourceContext; binding: AgentDesktopResourceBinding; disabled: boolean
  onReplace: (reference: AgentResourceReference) => Promise<boolean>; onRemove: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [pending, setPending] = useState(false)
  const [selected, setSelected] = useState<AgentResourceState>()
  const workflow = binding.kind === 'desktop_workflow'
  const Icon = workflow ? Workflow : Monitor
  const label = workflow ? `${binding.workflow_name} · v${binding.workflow_version}` : `${binding.host_name} · ${binding.desktop_profile_name}`
  const candidates = context.candidates.filter((source) => !resourceBindingMatchesSource(binding, source))
  const candidate = selected && candidates.find((source) => sameAgentResourceSource(selected, source))
  const key = (source: AgentResourceState) => JSON.stringify(resourceReference(source))
  const status = t(`agent.desktopResource.status.${context.status}`)

  useEffect(() => {
    if (selected && !candidate) setSelected(undefined)
  }, [candidate, selected])

  useEffect(() => {
    if (!disabled || pending) return
    setSelected(undefined)
    setRemoving(false)
  }, [disabled, pending])

  const mutate = async (operation: () => Promise<boolean>) => {
    if (disabled || pending) return
    setPending(true)
    try { if (await operation()) { setOpen(false); setRemoving(false); setSelected(undefined) } }
    finally { setPending(false) }
  }
  return <>
    <FilterPopover open={open} placement="topLeft" destroyOnHidden getPopupContainer={() => document.body}
      onOpenChange={(value) => { setOpen(value); setSelected(undefined) }} content={(
        <div className={styles.popover} role="group" aria-label={t('agent.desktopResource.details')}>
          <div className={styles.heading}><span className={styles.icon}><Icon size={17} /></span><span><strong>{label}</strong><small>{status}</small></span></div>
          <dl className={styles.details}>
            <div><dt>{t('agent.desktopResource.type')}</dt><dd>{t(`agent.message.resourceKind.${binding.kind}`)}</dd></div>
            <div><dt>ID</dt><dd>{resourceReferenceId(resourceReference(binding))}</dd></div>
            {!workflow && <div><dt>{t('agent.desktopResource.protocol')}</dt><dd>{binding.protocol.toUpperCase()}</dd></div>}
          </dl>
          <p className={context.status === 'unavailable' || context.status === 'stale' ? styles.warning : styles['reference-hint']} role="status">{t(context.status === 'checking' ? 'agent.desktopResource.status.checking'
            : context.status !== 'ready' ? 'agent.desktopResource.unavailable' : workflow ? 'agent.desktopResource.fixedVersion' : 'agent.desktopResource.referenceOnly')}</p>
          <Select className={`${customSelectStyles.select} ${styles.select} termous-select`}
            classNames={{ popup: { root: `${customSelectStyles['select-popup']} termous-select-popup` } }}
            showSearch optionFilterProp="label" value={candidate ? key(candidate) : undefined} disabled={disabled || pending}
            aria-label={t('agent.desktopResource.select')} placeholder={t('agent.desktopResource.select')}
            notFoundContent={t('agent.slash.resources.empty')}
            options={candidates.map((source) => ({ value: key(source), label: [source.host_name, resourceProfileName(source),
              ...('kind' in source && source.kind === 'desktop_session' ? [source.session_id] : [])].filter(Boolean).join(' · ') }))}
            onChange={(value: string) => setSelected(candidates.find((source) => key(source) === value))} />
          <div className={styles['footer-actions']}>
            <Button size="small" className={uiStyles['secondary-button']} disabled={disabled || pending || !candidate}
              onClick={() => candidate && void mutate(() => onReplace(resourceReference(candidate)))}>{t('agent.resource.confirmReplace')}</Button>
            <Button size="small" danger icon={<Link2Off size={13} />} disabled={disabled || pending}
              className={uiStyles['danger-button']} onClick={() => { setOpen(false); setRemoving(true) }}>{t('agent.resource.remove')}</Button>
          </div>
          {disabled && <small className={styles.disabled}>{t('agent.resource.activeRunLocked')}</small>}
        </div>
      )}>
      <button type="button" className={styles.chip} data-resource-kind={binding.kind} data-resource-status={context.status}
        aria-label={`${t(`agent.message.resourceKind.${binding.kind}`)} · ${label} · ${status}`} aria-expanded={open}>
        <Icon size={14} aria-hidden="true" /><span>{label}</span>{context.status !== 'ready' && <i aria-hidden="true" />}
      </button>
    </FilterPopover>
    <ConfirmDialog open={removing && !disabled} title={t('agent.desktopResource.removeTitle')}
      description={t('agent.desktopResource.removeDescription')} confirmLabel={t('agent.resource.remove')}
      confirmLoading={pending} onCancel={() => setRemoving(false)} onConfirm={() => void mutate(onRemove)} />
  </>
}

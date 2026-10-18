import { Alert, Checkbox, Input, InputNumber, Modal, Segmented, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import { Monitor, Play, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { workflowError } from '../../model/messages'
import { isTargetAvailable, sessionTarget, type WorkflowTarget } from '../../model/target'
import type { WorkflowEnvironment, WorkflowLaunch } from '../../model/workspace/types'
import styles from '../shared/WorkflowForms.module.scss'
import layout from './RunDialog.module.scss'

export function RunDialogView({ launch, environment: { sessions, profiles }, onTargetChange, onChange, onSubmit, onClose }: {
  launch: WorkflowLaunch; environment: WorkflowEnvironment; onTargetChange: (target: WorkflowTarget) => void
  onChange: (patch: Partial<Pick<WorkflowLaunch, 'takeover' | 'keep' | 'parameters'>>) => void; onSubmit: () => Promise<void>; onClose: () => void
}) {
  const { t } = useTranslation()
  const { target: selection, script, definition, debug, takeover, keep, parameters, busy, error } = launch
  const { mode, id: target } = selection
  const available = isTargetAvailable(selection, sessions, profiles)
  const setTarget = (id?: string) => onTargetChange(mode === 'session' ? sessionTarget(sessions, id) : { mode, id })
  const unconfirmed = !!launch.request && !busy
  const setTakeover = (takeover: boolean) => onChange({ takeover })
  const setKeep = (keep: boolean) => onChange({ keep })
  const setParameters = (parameters: WorkflowLaunch['parameters']) => onChange({ parameters })
  return <Modal open width={560} title={t(debug ? 'desktopWorkflow.debugRun' : 'desktopWorkflow.startRun')} onCancel={onClose} onOk={() => void onSubmit()} confirmLoading={busy} okText={t('desktopWorkflow.run')} okButtonProps={{ disabled: !available && !unconfirmed }} closable={!busy} mask={{ closable: !busy }} cancelButtonProps={{ disabled: busy }}>
    <div className={layout.content}>
      <div className={layout.identity}><Play size={18} /><strong>{script.name}</strong><span>v{script.revision}</span></div>
      <section className={layout.section}>
      <h4><Monitor size={15} />{t('desktopWorkflow.runTarget')}</h4>
      <Segmented<'session' | 'profile'> block disabled={busy || unconfirmed} value={mode} options={[{ value: 'session', label: t('desktopWorkflow.existingSession') }, { value: 'profile', label: t('desktopWorkflow.savedProfile') }]} onChange={(value) => onTargetChange({ mode: value })} />
      <Select aria-label={t('desktopWorkflow.selectTarget')} disabled={busy || unconfirmed} placeholder={t('desktopWorkflow.selectTarget')} value={target} onSelect={setTarget} options={mode === 'session' ? sessions.filter((s) => s.connection_generation > 0 && !['stopping', 'failed'].includes(s.status)).map((s) => ({ value: s.id, label: `${s.profile_name} · ${s.protocol.toUpperCase()} · ${s.id.slice(-8)}` })) : profiles.map((p) => ({ value: p.id, label: `${p.name} · ${p.protocol.toUpperCase()}` }))} />
      {target && !available && <Alert type="warning" title={t('desktopWorkflow.targetUnavailable')} />}
      {mode === 'profile' && <Alert type="info" title={t('desktopWorkflow.reuseConnection')} description={t('desktopWorkflow.temporaryConnectionHint')} />}
      </section>
      <section className={layout.section}>
      <h4><ShieldCheck size={15} />{t('desktopWorkflow.runConsent')}</h4>
      <p className={styles.hint}>{t('desktopWorkflow.runLimits')}</p>
      <Checkbox disabled={busy || unconfirmed} checked={takeover} onChange={(e) => setTakeover(e.target.checked)}>{t('desktopWorkflow.allowTakeover')}</Checkbox>
      {mode === 'profile' && <Checkbox disabled={busy || unconfirmed} checked={keep} onChange={(e) => setKeep(e.target.checked)}>{t('desktopWorkflow.keepConnection')}</Checkbox>}
      </section>
      {definition.parameters.length > 0 && <section className={layout.section}>
      <h4><SlidersHorizontal size={15} />{t('desktopWorkflow.parameters')}</h4>
      {definition.parameters.map((p) => <label key={p.id}>{p.name || p.id}{p.sensitive && <span className={styles.hint}> · {t('desktopWorkflow.runtimeOnly')}</span>}
        {p.type === 'boolean' ? <Switch disabled={busy || unconfirmed} checked={parameters[p.id] === true} onChange={(v) => setParameters({ ...parameters, [p.id]: v })} /> : p.type === 'number' ? <InputNumber disabled={busy || unconfirmed} precision={0} min={-2147483647} max={2147483647} value={Number(parameters[p.id])} onChange={(v) => setParameters({ ...parameters, [p.id]: v ?? 0 })} /> : p.sensitive ? <Input.Password disabled={busy || unconfirmed} autoComplete="off" value={String(parameters[p.id] ?? '')} onChange={(e) => setParameters({ ...parameters, [p.id]: e.target.value })} /> : <Input disabled={busy || unconfirmed} value={String(parameters[p.id] ?? '')} onChange={(e) => setParameters({ ...parameters, [p.id]: e.target.value })} />}
      </label>)}
      </section>}
      {unconfirmed && <Alert type="warning" title={t('desktopWorkflow.requestUnconfirmed')} />}
      {error != null && <Alert type="error" title={workflowError(error, t)} />}
    </div>
  </Modal>
}

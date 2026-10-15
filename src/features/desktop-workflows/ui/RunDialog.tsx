import { Alert, Checkbox, Input, InputNumber, Modal, Segmented, Select, Switch } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Definition, Run, Script, StartInput, WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import { wasRequestRejected, workflowError } from '../model/messages'
import { isTargetAvailable, sessionTarget, type WorkflowTarget } from '../model/target'
import styles from './WorkflowWorkspace.module.scss'

interface Props { target: WorkflowTarget; onTargetChange: (target: WorkflowTarget) => void; gateway: WorkflowGateway; script: Script; definition: Definition; sessions: RemoteDesktopSession[]; profiles: RemoteDesktopAccessProfile[]; debug: boolean; onStarted: (run: Run) => void; onClose: () => void }
export function RunDialog({ target: selection, onTargetChange, gateway, script, definition, sessions, profiles, debug, onStarted, onClose }: Props) {
  const { t } = useTranslation()
  const { mode, id: target } = selection
  const available = isTargetAvailable(selection, sessions, profiles)
  const setTarget = (id?: string) => onTargetChange(mode === 'session' ? sessionTarget(sessions, id) : { mode, id })
  const [takeover, setTakeover] = useState(false)
  const [keep, setKeep] = useState(true)
  const [parameters, setParameters] = useState<Record<string, string | number | boolean>>(() => Object.fromEntries(definition.parameters.map((p) => [p.id, p.sensitive ? '' : p.default ?? (p.type === 'boolean' ? false : p.type === 'number' ? 0 : '')])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const request = useRef<StartInput | undefined>(undefined)
  const inFlight = useRef(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const started = useRef(false)
  const submit = async () => {
    if ((!available && !request.current) || inFlight.current || started.current) return
    const input: Omit<StartInput, 'request_id'> = { script_id: script.id, version: script.revision, parameters, takeover, keep_connection: keep, debug,
      ...(mode === 'session' ? { session_id: target, connection_generation: selection.connectionGeneration } : { profile_id: target }) }
    request.current ??= { ...input, request_id: crypto.randomUUID() }
    inFlight.current = true
    setBusy(true); setError(undefined)
    try { const run = await gateway.start(request.current); started.current = true; onStarted(run) }
    catch (reason) { if (wasRequestRejected(reason)) request.current = undefined; setUnconfirmed(!!request.current); setError(reason) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <Modal open title={t(debug ? 'desktopWorkflow.debugRun' : 'desktopWorkflow.startRun')} onCancel={onClose} onOk={() => void submit()} confirmLoading={busy} okText={t('desktopWorkflow.run')} okButtonProps={{ disabled: !available && !unconfirmed }} closable={!busy} maskClosable={!busy} cancelButtonProps={{ disabled: busy }}>
    <div className={styles.properties}>
      <strong>{script.name} · v{script.revision}</strong>
      <Segmented<'session' | 'profile'> disabled={busy || unconfirmed} value={mode} options={[{ value: 'session', label: t('desktopWorkflow.existingSession') }, { value: 'profile', label: t('desktopWorkflow.savedProfile') }]} onChange={(value) => onTargetChange({ mode: value })} />
      <Select disabled={busy || unconfirmed} placeholder={t('desktopWorkflow.selectTarget')} value={target} onSelect={setTarget} options={mode === 'session' ? sessions.filter((s) => s.connection_generation > 0 && !['stopping', 'failed'].includes(s.status)).map((s) => ({ value: s.id, label: `${s.profile_name} · ${s.protocol.toUpperCase()} · ${s.id.slice(-8)}` })) : profiles.map((p) => ({ value: p.id, label: `${p.name} · ${p.protocol.toUpperCase()}` }))} />
      {target && !available && <Alert type="warning" title={t('desktopWorkflow.targetUnavailable')} />}
      {mode === 'profile' && <Alert type="info" title={t('desktopWorkflow.reuseConnection')} description={t('desktopWorkflow.temporaryConnectionHint')} />}
      <Alert type="info" title={t('desktopWorkflow.runConsent')} description={t('desktopWorkflow.runLimits')} />
      <Checkbox disabled={busy || unconfirmed} checked={takeover} onChange={(e) => setTakeover(e.target.checked)}>{t('desktopWorkflow.allowTakeover')}</Checkbox>
      {mode === 'profile' && <Checkbox disabled={busy || unconfirmed} checked={keep} onChange={(e) => setKeep(e.target.checked)}>{t('desktopWorkflow.keepConnection')}</Checkbox>}
      {definition.parameters.map((p) => <label key={p.id}>{p.name || p.id}{p.sensitive && <span className={styles.hint}> · {t('desktopWorkflow.runtimeOnly')}</span>}
        {p.type === 'boolean' ? <Switch disabled={busy || unconfirmed} checked={parameters[p.id] === true} onChange={(v) => setParameters({ ...parameters, [p.id]: v })} /> : p.type === 'number' ? <InputNumber disabled={busy || unconfirmed} precision={0} min={-2147483647} max={2147483647} value={Number(parameters[p.id])} onChange={(v) => setParameters({ ...parameters, [p.id]: v ?? 0 })} /> : p.sensitive ? <Input.Password disabled={busy || unconfirmed} autoComplete="off" value={String(parameters[p.id] ?? '')} onChange={(e) => setParameters({ ...parameters, [p.id]: e.target.value })} /> : <Input disabled={busy || unconfirmed} value={String(parameters[p.id] ?? '')} onChange={(e) => setParameters({ ...parameters, [p.id]: e.target.value })} />}
      </label>)}
      {unconfirmed && <Alert type="warning" title={t('desktopWorkflow.requestUnconfirmed')} />}
      {error != null && <Alert type="error" title={workflowError(error, t)} />}
    </div>
  </Modal>
}

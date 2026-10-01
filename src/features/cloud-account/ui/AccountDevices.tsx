import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, Modal, Tag, Tooltip } from 'antd'
import { Laptop, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudAuthorizationTarget, CloudDevice, CloudMFAProof, CloudMFAMethod, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { WorkspaceEmptyState } from '#shared/ui'
import { useCloudReconnect } from '../model/useCloudReconnect'
import { useCloudAuthorization } from '../model/useCloudAuthorization'
import { AccountAuthorization } from './AccountAuthorization'
import { AccountPersonalAuthorize } from './AccountPersonalAuthorize'
import { AccountWorkspaceRestart } from './AccountWorkspaceRestart'
import { AccountMFAFields } from './AccountMFAFields'
import { AccountLoading, AccountSection } from './AccountSection'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; target?: CloudAuthorizationTarget; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountDevices({ api, status, busy, run, target }: Props) {
  const { t } = useTranslation()
  const [devices, setDevices] = useState<CloudDevice[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<CloudDevice>()
  const [selected, setSelected] = useState<CloudAuthorization>()
  const [switching, setSwitching] = useState<{ from: CloudAuthorization; kind: 'approval' | 'recovery' }>()
  const [initialize, setInitialize] = useState(false)
  const [choosingRecovery, setChoosingRecovery] = useState(false)
  const [replacementIds, setReplacementIds] = useState<string[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [proof] = Form.useForm<CloudMFAProof>()
  const [method, setMethod] = useState<CloudMFAMethod>('totp')
  const [targetError, setTargetError] = useState(false)
  const generation = status.generation
  const authorization = useCloudAuthorization(api, generation)
  const lifetime = useRef<{ controller: AbortController; request: number } | null>(null)
  const load = useCallback(async () => {
    const scope = lifetime.current
    if (!scope || scope.controller.signal.aborted) return
    const request = ++scope.request
    setLoading(true)
    try {
      const items = await api.devices()
      if (!scope.controller.signal.aborted && request === scope.request && generation === api.getStatus()?.generation) { setDevices(items); setError(false) }
    } catch { if (!scope.controller.signal.aborted && request === scope.request) setError(true) }
    finally { if (!scope.controller.signal.aborted && request === scope.request) setLoading(false) }
  }, [api, generation])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = { controller, request: 0 }
    setDevices([]); setError(false); setSelected(undefined); setRevoking(undefined); setSwitching(undefined); setInitialize(false)
    void load()
    return () => { controller.abort(); if (proof.getFieldInstance('password')) proof.resetFields() }
  }, [load, proof])
  useCloudReconnect(api, generation, load)
  useEffect(() => {
    if (!target) return
    const controller = new AbortController()
    setTargetError(false)
    void api.authorization(generation, target.kind, target.id, controller.signal).then(value => {
      if (!controller.signal.aborted && generation === api.getStatus()?.generation) setSelected(value)
    }).catch(() => { if (!controller.signal.aborted) setTargetError(true) })
    return () => controller.abort()
  }, [api, generation, target])
  const reloadAuthorization = authorization.reload
  const changed = useCallback(() => { void load(); void reloadAuthorization() }, [load, reloadAuthorization])
  const create = (kind: 'approval' | 'recovery', revokes: string[] = []) => run(async () => {
    const scope = lifetime.current
    const result = kind === 'approval' ? await api.createDeviceRequest(generation) : await api.createRecovery(generation, 'recovery', revokes)
    if (!scope?.controller.signal.aborted && generation === api.getStatus()?.generation) { setSelected(result); changed() }
    return result
  })
  const outstanding = authorization.requests.filter(v => v.kind !== 'enablement' && !['cancelled', 'rejected', 'expired', 'invalidated', 'acknowledged', 'failed'].includes(v.status))
  const begin = (kind: 'approval' | 'recovery') => {
    const existing = outstanding.find(value => value.device_id === status.device_id)
    if (existing) {
      if (existing.kind === kind || !existing.allowed_actions.includes('cancel')) setSelected(existing)
      else setSwitching({ from: existing, kind })
    } else if (kind === 'recovery') { setReplacementIds([]); setChoosingRecovery(true) } else void create(kind)
  }
  return <div className={styles.section}>
    {targetError ? <Alert type="info" showIcon title={t('cloud.authorization.targetUnavailable')} /> : null}
    {authorization.error ? <Alert type="warning" showIcon title={t('cloud.authorization.readFailed')} action={<Button onClick={() => void authorization.reload()}>{t('cloud.retry')}</Button>} /> : null}
    {status.device_status === 'pending' ? <AccountSection title={t('cloud.authorizeDevice')} icon={<ShieldCheck size={18} />} description={t('cloud.authorization.chooseHint')}>
      <div className={styles.actions}>
        <Button type="primary" disabled={busy || authorization.error || authorization.loading} onClick={() => begin('approval')}>{t('cloud.authorization.useTrusted')}</Button>
        <Button disabled={busy || !authorization.security?.recovery.available || authorization.error} onClick={() => begin('recovery')}>{t('cloud.authorization.useRecovery')}</Button>
        <AccountPersonalAuthorize key={generation} api={api} status={status} devices={devices} enabled={authorization.security?.account.personal_recovery_enabled === true} busy={busy} disabled={authorization.error || authorization.loading || loading || error} run={run} onChanged={changed} outstanding={outstanding.find(value => value.device_id === status.device_id)} />
      </div>
      {!authorization.security?.recovery.available && authorization.security ? <p className={styles.hint}>{t(`cloud.authorization.reasons.${authorization.security.recovery.reason}`, { defaultValue: t('cloud.authorization.reasons.not_enabled') })}</p> : null}
      <AccountWorkspaceRestart key={generation} secondary api={api} status={status} busy={busy} mfaEnabled={authorization.security?.account.mfa_enabled} run={run} />
    </AccountSection> : null}
    {status.error_code === 'workspace_replaced' ? <AccountSection title={t('cloud.safeguards.replacedTitle')} icon={<ShieldCheck size={18} />} description={t('cloud.safeguards.replacedHint')}><Button type="primary" disabled={busy} onClick={() => void run(() => api.joinCurrentWorkspace(generation))}>{t('cloud.safeguards.joinCurrent')}</Button></AccountSection> : null}
    {status.device_status !== 'active' && status.device_status !== 'pending' && status.error_code !== 'workspace_replaced' ? <AccountSection title={t('cloud.authorizeDevice')} icon={<ShieldCheck size={18} />} description={t('cloud.safeguards.registrationBlocked')}><AccountWorkspaceRestart key={generation} secondary api={api} status={status} busy={busy} mfaEnabled={authorization.security?.account.mfa_enabled} run={run} /></AccountSection> : null}
    {authorization.security?.keys_verified && !authorization.security.membership_initialized ? <AccountSection title={t('cloud.authorization.initialize')} icon={<ShieldCheck size={18} />} description={t('cloud.authorization.initializeHint')}>
      <Button disabled={busy || loading || error || authorization.error} onClick={() => { setChecked(devices.filter(d => d.status === 'active').map(d => d.id)); setInitialize(true) }}>{t('cloud.authorization.reviewMembers')}</Button>
    </AccountSection> : null}
    <AccountSection title={t('cloud.authorization.requests')} icon={<ShieldCheck size={18} />} extra={<Button type="text" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void authorization.reload()}>{t('cloud.refresh')}</Button>}>
      {outstanding.length ? <div className={styles.list}>{outstanding.map(request => <div className={styles.row} key={request.id}>
        <div className={styles.identity}><strong>{request.name || t('cloud.currentDevice')}</strong><small>{request.platform} · {new Date(request.created_at).toLocaleString()}</small></div>
        <div className={styles.actions}><Tag>{t(`cloud.authorization.states.${request.status}`)}</Tag><Button disabled={busy} onClick={() => setSelected(request)}>{t('cloud.authorization.details')}</Button></div>
      </div>)}</div> : authorization.loading ? <AccountLoading /> : <p className={styles.hint}>{t('cloud.authorization.noRequests')}</p>}
    </AccountSection>
    <AccountSection title={t('cloud.deviceList')} icon={<Laptop size={18} />} description={t('cloud.deviceListHint')} extra={<Button icon={<RefreshCw size={15} />} loading={loading} disabled={busy || loading} onClick={() => void load()}>{t('cloud.refresh')}</Button>}>
      {error ? <Alert type="warning" showIcon title={t('cloud.devicesLoadFailed')} /> : null}
      {devices.length ? <div className={styles.list}>{devices.map(device => <div className={styles.row} key={device.id}>
        <div className={styles['list-identity']}><span className={styles['list-icon']} aria-hidden="true"><Laptop size={18} /></span><div className={styles.identity}><strong>{device.name}</strong><small><Tooltip title={device.id}><span className={styles.identifier}>{device.id}</span></Tooltip></small></div></div>
        <div className={styles.actions}><Tag>{t(`cloud.deviceStates.${device.status}`)}</Tag>{device.id === status.device_id ? <span className={styles.hint}>{t('cloud.currentDevice')}</span> : <Button size="small" danger disabled={busy || device.status !== 'active' || !authorization.security?.membership_initialized || status.device_status !== 'active'} onClick={() => setRevoking(device)}>{t('cloud.revoke')}</Button>}</div>
      </div>)}</div> : loading ? <AccountLoading /> : !error ? <WorkspaceEmptyState className={styles.empty} icon={<Laptop size={20} />} title={t('cloud.noDevices')} /> : null}
    </AccountSection>
    {selected ? <AccountAuthorization key={selected.id} api={api} generation={generation} value={selected} mfaEnabled={authorization.security?.account.mfa_enabled ?? true} busy={busy} run={run} onClose={() => setSelected(undefined)} onChanged={changed} /> : null}
    <Modal open={Boolean(switching)} title={t('cloud.authorization.switchTitle')} closable={!busy} mask={{ closable: !busy }} confirmLoading={busy} onCancel={() => setSwitching(undefined)} onOk={async () => {
      if (!switching) return
      const cancelled = await run(() => api.authorizationAction(generation, switching.from.kind, switching.from.id, 'cancel', { expected_revision: switching.from.revision }))
      if (cancelled && generation === api.getStatus()?.generation) { const kind = switching.kind; setSwitching(undefined); if (kind === 'recovery') { setReplacementIds([]); setChoosingRecovery(true) } else await create(kind) }
      changed()
    }}><p>{t('cloud.authorization.switchHint')}</p></Modal>
    <Modal open={choosingRecovery} title={t('cloud.authorization.useRecovery')} closable={!busy} mask={{ closable: !busy }} confirmLoading={busy} onCancel={() => { setChoosingRecovery(false); setReplacementIds([]) }} onOk={async () => { const result = await create('recovery', replacementIds); if (result) setChoosingRecovery(false) }}>
      <p>{t('cloud.safeguards.replaceDevicesHint')}</p>
      <Checkbox.Group aria-label={t('cloud.safeguards.replaceDevices')} value={replacementIds} onChange={values => setReplacementIds(values as string[])} options={devices.filter(device => device.status === 'active').map(device => ({ label: device.name, value: device.id }))} />
    </Modal>
    <Modal open={initialize} title={t('cloud.authorization.initialize')} footer={null} destroyOnHidden closable={!busy} mask={{ closable: !busy }} onCancel={() => { setInitialize(false); proof.resetFields() }}>
      <p>{t('cloud.authorization.initializeHint')}</p><Checkbox.Group value={checked} onChange={values => setChecked(values as string[])} options={devices.filter(d => d.status === 'active').map(d => ({ label: `${d.name} · ${d.id}`, value: d.id, disabled: d.id === status.device_id }))} />
      <Form form={proof} layout="vertical" onFinish={evidence => void run(async () => {
        const scope = lifetime.current
        try { await api.reauthenticate(generation, { ...evidence, method: authorization.security?.account.mfa_enabled ? method : undefined }); await api.initializeMembership(generation, checked); if (!scope?.controller.signal.aborted && generation === api.getStatus()?.generation) { setInitialize(false); changed() } }
        finally { proof.resetFields() }
      })}>
        <Form.Item name="password" label={t('cloud.password')} rules={[{ required: true }]}><Input.Password autoComplete="current-password" disabled={busy} /></Form.Item>
        {authorization.security?.account.mfa_enabled ? <AccountMFAFields method={method} onMethodChange={setMethod} disabled={busy} /> : null}
        <Button type="primary" htmlType="submit" loading={busy} disabled={!checked.includes(status.device_id ?? '')}>{t('cloud.mfa.confirm')}</Button>
      </Form>
    </Modal>
    <Modal open={Boolean(revoking)} title={t('cloud.revoke')} footer={null} destroyOnHidden closable={!busy} mask={{ closable: !busy }} onCancel={() => { setRevoking(undefined); proof.resetFields() }}><p>{t('cloud.revokeHint')}</p>
      <Form form={proof} layout="vertical" onFinish={evidence => void run(async () => {
        if (!revoking) return
        const scope = lifetime.current
        try { await api.reauthenticate(generation, { ...evidence, method: authorization.security?.account.mfa_enabled ? method : undefined }); await api.revokeDevice(generation, revoking.id); if (!scope?.controller.signal.aborted && generation === api.getStatus()?.generation) { setRevoking(undefined); changed() } }
        finally { proof.resetFields() }
      })}>
        <Form.Item name="password" label={t('cloud.password')} rules={[{ required: true }]}><Input.Password autoComplete="current-password" disabled={busy} /></Form.Item>
        {authorization.security?.account.mfa_enabled ? <AccountMFAFields method={method} onMethodChange={setMethod} disabled={busy} /> : null}
        <Button type="primary" danger htmlType="submit" loading={busy}>{t('cloud.revoke')}</Button>
      </Form>
    </Modal>
  </div>
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Checkbox, Form, Modal, Table, Tag, Tooltip } from 'antd'
import { Laptop, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudAuthorizationTarget, CloudDevice, CloudMFAProof, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { WorkspaceEmptyState } from '#shared/ui'
import { useCloudReconnect } from '../model/useCloudReconnect'
import { useCloudChanges } from '../model/useCloudChanges'
import { useCloudAuthorization } from '../model/useCloudAuthorization'
import { useCloudMFA } from '../model/useCloudMFA'
import { AccountAuthorization } from './AccountAuthorization'
import { AccountPersonalAuthorize } from './AccountPersonalAuthorize'
import { AccountWorkspaceRestart } from './AccountWorkspaceRestart'
import { AccountStepUpFields } from './AccountStepUpFields'
import { AccountStepUpDialog } from './AccountStepUpDialog'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { AccountOperationError } from './AccountOperationError'
import { AccountLoading, AccountSection } from './AccountSection'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; target?: CloudAuthorizationTarget; onOpenAuthorization?: (value: CloudAuthorizationTarget) => void; renderDeviceActions?: (device: CloudDevice) => ReactNode; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountDevices({ api, status, busy, run, target, onOpenAuthorization, renderDeviceActions }: Props) {
  const { t, i18n } = useTranslation()
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
  const [targetError, setTargetError] = useState(false)
  const generation = status.generation
  const mfa = useCloudMFA(api, generation)
  const initializeFeedback = useCloudOperationFeedback(api, generation, run)
  const initializeBusy = busy || initializeFeedback.working
  const authorization = useCloudAuthorization(api, generation)
  const policy = useRef({ enabled: authorization.security?.account.mfa_enabled, revision: authorization.security?.account.mfa_revision })
  useEffect(() => { policy.current = { enabled: authorization.security?.account.mfa_enabled, revision: authorization.security?.account.mfa_revision } }, [authorization.security?.account.mfa_enabled, authorization.security?.account.mfa_revision])
  const select = (value: CloudAuthorization) => {
    if (onOpenAuthorization) onOpenAuthorization({ id: value.id, kind: value.kind })
    else setSelected(value)
  }
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
    return () => { controller.abort(); proof.setFieldsValue({ password: undefined, code: undefined }) }
  }, [load, proof])
  useCloudReconnect(api, generation, load)
  useCloudChanges(api, generation, ['devices'], load)
  useEffect(() => {
    if (!target || onOpenAuthorization) return
    const controller = new AbortController()
    setTargetError(false)
    void api.authorization(generation, target.kind, target.id, controller.signal).then(value => {
      if (!controller.signal.aborted && generation === api.getStatus()?.generation) setSelected(value)
    }).catch(() => { if (!controller.signal.aborted) setTargetError(true) })
    return () => controller.abort()
  }, [api, generation, target, onOpenAuthorization])
  const reloadAuthorization = authorization.reload
  const changed = useCallback(() => { void load(); void reloadAuthorization() }, [load, reloadAuthorization])
  const create = (kind: 'approval' | 'recovery', revokes: string[] = []) => run(async () => {
    const scope = lifetime.current
    const result = kind === 'approval' ? await api.createDeviceRequest(generation) : await api.createRecovery(generation, 'recovery', revokes)
    if (!scope?.controller.signal.aborted && generation === api.getStatus()?.generation) { select(result); changed() }
    return result
  })
  const outstanding = authorization.requests.filter(v => v.kind !== 'enablement' && !['cancelled', 'rejected', 'expired', 'invalidated', 'failed'].includes(v.status)
    && (v.status !== 'acknowledged' || v.device_id === status.device_id && !v.keys_verified && v.allowed_actions.includes('claim')))
  const begin = (kind: 'approval' | 'recovery') => {
    const existing = outstanding.find(value => value.device_id === status.device_id)
    if (existing) {
      if (existing.kind === kind || !existing.allowed_actions.includes('cancel')) select(existing)
      else setSwitching({ from: existing, kind })
    } else if (kind === 'recovery') { setReplacementIds([]); setChoosingRecovery(true) } else void create(kind)
  }
  const requests = <AccountSection key="authorization-requests" title={t('cloud.authorization.requests')} icon={<ShieldCheck size={18} />} extra={<Button type="text" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void authorization.reload()}>{t('cloud.refresh')}</Button>}>
    {outstanding.length ? <div className={styles.list}>{outstanding.map(request => <div className={styles.row} key={request.id}>
      <div className={styles.identity}><strong>{request.name || t('cloud.currentDevice')}</strong><small>{request.platform} · {new Date(request.created_at).toLocaleString(i18n.resolvedLanguage)}</small></div>
      <div className={styles.actions}><Tag>{t(`cloud.authorization.states.${request.status}`)}</Tag><Button disabled={busy} onClick={() => select(request)}>{t('cloud.authorization.details')}</Button></div>
    </div>)}</div> : authorization.loading ? <AccountLoading /> : !authorization.error ? <p className={styles.hint}>{t('cloud.authorization.noRequests')}</p> : null}
  </AccountSection>
  // 有待处理申请时优先展示；稳定的 key 保留调整顺序后的节点和键盘焦点。
  const prioritizeRequests = outstanding.length > 0 || authorization.loading || authorization.error
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
      <AccountWorkspaceRestart key={generation} secondary api={api} status={status} busy={busy} mfaEnabled={authorization.security?.account.mfa_enabled} mfaRevision={authorization.security?.account.mfa_revision} run={run} />
    </AccountSection> : null}
    {status.error_code === 'workspace_replaced' ? <AccountSection title={t('cloud.safeguards.replacedTitle')} icon={<ShieldCheck size={18} />} description={t('cloud.safeguards.replacedHint')}><Button type="primary" disabled={busy} onClick={() => void run(() => api.joinCurrentWorkspace(generation))}>{t('cloud.safeguards.joinCurrent')}</Button></AccountSection> : null}
    {status.device_status !== 'active' && status.device_status !== 'pending' && status.error_code !== 'workspace_replaced' ? <AccountSection title={t('cloud.authorizeDevice')} icon={<ShieldCheck size={18} />} description={t('cloud.safeguards.registrationBlocked')}><AccountWorkspaceRestart key={generation} secondary api={api} status={status} busy={busy} mfaEnabled={authorization.security?.account.mfa_enabled} mfaRevision={authorization.security?.account.mfa_revision} run={run} /></AccountSection> : null}
    {authorization.security?.keys_verified && !authorization.security.membership_initialized ? <AccountSection title={t('cloud.authorization.initialize')} icon={<ShieldCheck size={18} />} description={t('cloud.authorization.initializeHint')}>
      <Button disabled={initializeBusy || loading || error || authorization.error} onClick={() => { initializeFeedback.reset(); setChecked(devices.filter(d => d.status === 'active').map(d => d.id)); setInitialize(true) }}>{t('cloud.authorization.reviewMembers')}</Button>
    </AccountSection> : null}
    {prioritizeRequests ? requests : null}
    <AccountSection title={t('cloud.deviceList')} icon={<Laptop size={18} />} description={t('cloud.deviceListHint')} extra={<Button icon={<RefreshCw size={15} />} loading={loading} disabled={busy || loading} onClick={() => void load()}>{t('cloud.refresh')}</Button>}>
      {error ? <Alert type="warning" showIcon title={t('cloud.devicesLoadFailed')} /> : null}
      {devices.length ? <Table<CloudDevice> className={styles.table} size="small" rowKey="id" pagination={false} dataSource={devices} scroll={{ x: 840 }} columns={[
        {
          title: t('cloud.deviceColumns.name'), key: 'device', width: 280,
          render: (_, device) => <div className={styles['list-identity']}>
            <span className={styles['list-icon']} aria-hidden="true"><Laptop size={18} /></span>
            <div className={styles.identity}>
              <strong>{device.name}</strong>
              <small><Tooltip title={device.id}><span className={styles.identifier}>{device.id}</span></Tooltip></small>
            </div>
          </div>,
        },
        {
          title: t('cloud.deviceColumns.authorization'), key: 'status', width: 140,
          render: (_, device) => <Tag className={styles['status-tag']} color={device.status === 'active' ? 'success' : device.status === 'pending' ? 'warning' : undefined}>{t(`cloud.deviceStates.${device.status}`)}</Tag>,
        },
        {
          title: t('cloud.deviceColumns.created'), key: 'created', width: 170,
          render: (_, device) => {
            const date = new Date(device.created_at)
            return <span className={styles['table-date']}>{Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(i18n.resolvedLanguage)}</span>
          },
        },
        {
          title: t('cloud.deviceColumns.actions'), key: 'actions',
          render: (_, device) => <div className={styles['device-actions']}>
            {renderDeviceActions?.(device)}
            {device.id === status.device_id ? <Tag className={styles['status-tag']}>{t('cloud.currentDevice')}</Tag>
              : <Button size="small" type="text" danger disabled={busy || device.status !== 'active' || !authorization.security?.membership_initialized || status.device_status !== 'active'} onClick={() => setRevoking(device)}>{t('cloud.revoke')}</Button>}
          </div>,
        },
      ]} /> : loading ? <AccountLoading /> : !error ? <WorkspaceEmptyState className={styles.empty} icon={<Laptop size={20} />} title={t('cloud.noDevices')} /> : null}
    </AccountSection>
    {!prioritizeRequests ? requests : null}
    {selected ? <AccountAuthorization key={selected.id} api={api} generation={generation} value={selected} mfaEnabled={authorization.security?.account.mfa_enabled} mfaRevision={authorization.security?.account.mfa_revision} busy={busy} run={run} onClose={() => setSelected(undefined)} onChanged={changed} /> : null}
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
    <Modal open={initialize} title={t('cloud.authorization.initialize')} footer={null} destroyOnHidden closable={!initializeBusy} mask={{ closable: !initializeBusy }} keyboard={!initializeBusy} onCancel={() => { initializeFeedback.reset(); setInitialize(false); proof.resetFields() }}>
      <p>{t('cloud.authorization.initializeHint')}</p><Checkbox.Group disabled={initializeBusy} value={checked} onChange={values => setChecked(values as string[])} options={devices.filter(d => d.status === 'active').map(d => ({ label: `${d.name} · ${d.id}`, value: d.id, disabled: d.id === status.device_id }))} />
      <AccountOperationError code={initializeFeedback.errorCode} />
      <Form form={proof} layout="vertical" onFinish={evidence => void initializeFeedback.perform(async current => {
        if (busy || authorization.error || authorization.security?.account.mfa_enabled === undefined) return
        const scope = lifetime.current
        const startedPolicy = policy.current
        try {
          await api.reauthenticate(generation, buildCloudStepUpProof(authorization.security?.account.mfa_enabled, evidence))
          if (!current() || scope?.controller.signal.aborted) return
          if (startedPolicy !== policy.current) throw new Error('mfa_revision_conflict')
          await api.initializeMembership(generation, checked)
          if (!scope?.controller.signal.aborted && generation === api.getStatus()?.generation) { setInitialize(false); changed() }
        } finally { if (!scope?.controller.signal.aborted && generation === api.getStatus()?.generation && startedPolicy === policy.current) proof.resetFields() }
      })}>
        <AccountStepUpFields enabled={authorization.security?.account.mfa_enabled} revision={authorization.security?.account.mfa_revision} disabled={initializeBusy} />
        <Button type="primary" htmlType="submit" loading={initializeBusy} disabled={!checked.includes(status.device_id ?? '') || authorization.error || authorization.security?.account.mfa_enabled === undefined}>{t('cloud.mfa.confirm')}</Button>
      </Form>
    </Modal>
    {revoking ? <AccountStepUpDialog key={`${generation}:${revoking.id}`} api={api} generation={generation} title={t('cloud.revoke')} description={t('cloud.revokeHint')} danger busy={busy} run={run}
      mfa={mfa.value} unavailable={mfa.loading || mfa.error || !mfa.value} accept={mfa.accept} reload={mfa.reload} onUncertain={changed} onClose={() => setRevoking(undefined)}
      action={async () => { await api.revokeDevice(generation, revoking.id); changed() }} /> : null}
  </div>
}

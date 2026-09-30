import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Space, Tag, Tooltip } from 'antd'
import { Check, Copy, Laptop, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudChallenge, CloudDevice, CloudStatus } from '#common/contracts'
import { decodeCloudChallenge, type CloudGateway } from '#entities/cloud'
import { WorkspaceEmptyState } from '#shared/ui'
import { useCloudReconnect } from '../model/useCloudReconnect'
import { AccountLoading, AccountSection } from './AccountSection'
import styles from './CloudAccount.module.scss'

interface Props {
  api: CloudGateway
  status: CloudStatus
  busy: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
}

export function AccountDevices({ api, status, busy, run }: Props) {
  const { t } = useTranslation()
  const [devices, setDevices] = useState<CloudDevice[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pairing, setPairing] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [root, setRoot] = useState('')
  const [request, setRequest] = useState('')
  const [candidate, setCandidate] = useState<{ challenge: CloudChallenge; fingerprint: string }>()
  const [revoking, setRevoking] = useState<CloudDevice>()
  const [approvalRoot, setApprovalRoot] = useState('')
  const [copied, setCopied] = useState(false)
  const generation = status.generation
  const lifetime = useRef<{ api: CloudGateway; generation: string; active: boolean; request: number } | null>(null)
  const load = useCallback(async () => {
    const scope = lifetime.current
    if (!scope?.active || scope.api !== api || scope.generation !== generation) return
    const request = ++scope.request
    setLoading(true)
    try {
      const items = await api.devices()
      if (scope.active && request === scope.request) { setDevices(items); setError(false) }
    } catch {
      if (scope.active && request === scope.request) setError(true)
    } finally {
      if (scope.active && request === scope.request) setLoading(false)
    }
  }, [api, generation])
  useEffect(() => {
    const scope = { api, generation, active: true, request: 0 }
    lifetime.current = scope
    setDevices([]); setError(false)
    void load()
    return () => { scope.active = false }
  }, [api, generation, load])
  useCloudReconnect(api, generation, load)

  return <div className={styles.section}>
    <AccountSection title={t('cloud.deviceList')} icon={<Laptop size={18} />} description={t('cloud.deviceListHint')} extra={
      <Button icon={<RefreshCw size={15} />} loading={loading} disabled={busy || loading} onClick={() => void run(load)}>{t('cloud.refresh')}</Button>
    }>
      {error ? <Alert type="warning" showIcon title={t('cloud.devicesLoadFailed')} /> : null}
      {devices.length ? <div className={styles.list}>{devices.map((device) => <div className={styles.row} key={device.id}>
        <div className={styles['list-identity']}><span className={styles['list-icon']} aria-hidden="true"><Laptop size={18} /></span><div className={styles.identity}><strong>{device.name}</strong><small><Tooltip title={device.id}><span className={styles.identifier}>{device.id}</span></Tooltip></small></div></div>
        <div className={styles.actions}><Tag>{t(`cloud.deviceStates.${device.status}`)}</Tag>{device.id === status.device_id ? <span className={styles.hint}>{t('cloud.currentDevice')}</span> : <Button size="small" danger disabled={busy || device.status === 'revoked' || status.device_status !== 'active'} onClick={() => setRevoking(device)}>{t('cloud.revoke')}</Button>}</div>
      </div>)}</div> : loading ? <AccountLoading /> : !error ? <WorkspaceEmptyState className={styles.empty} icon={<Laptop size={20} />} title={t('cloud.noDevices')} /> : null}
    </AccountSection>
    {status.device_status === 'pending' ? <AccountSection title={t('cloud.authorizeDevice')} icon={<ShieldCheck size={18} />} description={t('cloud.pairHint')}>
      <div className={styles.actions}><Button type="primary" icon={<Plus size={15} />} loading={busy} onClick={() => void run(async () => {
        const result = await api.pairing(status.generation)
        setPairing(JSON.stringify(result.challenge, null, 2))
        setFingerprint(result.fingerprint)
      })}>{t('cloud.pairRequest')}</Button></div>
      {pairing ? <Input.TextArea readOnly value={pairing} rows={5} aria-label={t('cloud.pairRequest')} /> : null}
      {fingerprint ? <div className={styles.identity}><strong>{t('cloud.deviceFingerprint')}</strong><code className={styles.mono}>{fingerprint}</code></div> : null}
      <label className={styles.hint} htmlFor="cloud-trust-root">{t('cloud.trustRoot')}</label>
      <Input.TextArea id="cloud-trust-root" value={root} onChange={(event) => setRoot(event.target.value)} rows={3} maxLength={8192} placeholder={t('cloud.trustRoot')} />
      <div className={styles.actions}><Button disabled={!root.trim() || busy} onClick={() => void run(() => api.accept(status.generation, root.trim()))}>{t('cloud.acceptTrust')}</Button></div>
    </AccountSection> : status.device_status === 'active' ? <AccountSection title={t('cloud.approveDevice')} icon={<ShieldCheck size={18} />} description={t('cloud.approveDeviceHint')}>
      <Input.TextArea value={request} onChange={(event) => setRequest(event.target.value)} rows={4} maxLength={16_384} aria-label={t('cloud.pairRequest')} placeholder={t('cloud.pastePairing')} />
      <div className={styles.actions}><Button disabled={!request.trim() || busy} onClick={() => void run(async () => {
        let value: CloudChallenge
        try { value = decodeCloudChallenge(JSON.parse(request)) } catch { throw new Error('pairing_invalid') }
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${value.signing_key}\0${value.recipient}`))
        const fingerprint = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
        setCandidate({ challenge: value, fingerprint })
      })}>{t('cloud.reviewDevice')}</Button></div>
      {approvalRoot ? <Alert type="success" title={t('cloud.deviceApproved')} description={<Space direction="vertical"><span>{t('cloud.returnTrustRoot')}</span><code className={styles.mono}>{approvalRoot}</code><Button icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void run(async () => { await navigator.clipboard.writeText(approvalRoot); setCopied(true) })}>{t('cloud.copy')}</Button></Space>} /> : null}
    </AccountSection> : null}
    <Modal open={Boolean(candidate)} title={t('cloud.approveDevice')} onCancel={() => setCandidate(undefined)} confirmLoading={busy} onOk={() => void run(async () => {
      if (!candidate) return
      const result = await api.approve(status.generation, candidate.challenge, candidate.fingerprint)
      setApprovalRoot(result.trust_root); setCopied(false); setCandidate(undefined); setRequest(''); await load()
    })}>
      <p>{t('cloud.confirmFingerprint')}</p><code className={styles.mono}>{candidate?.fingerprint}</code>
    </Modal>
    <Modal open={Boolean(revoking)} title={t('cloud.revoke')} onCancel={() => setRevoking(undefined)} okButtonProps={{ danger: true }} confirmLoading={busy} onOk={() => void run(async () => {
      if (!revoking) return
      await api.revokeDevice(status.generation, revoking.id); setRevoking(undefined); await load()
    })}><p>{t('cloud.revokeHint')}</p></Modal>
  </div>
}

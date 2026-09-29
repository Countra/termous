import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Space, Tag } from 'antd'
import { Check, Copy, Laptop, Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudChallenge, CloudDevice, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
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
  const [pairing, setPairing] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [root, setRoot] = useState('')
  const [request, setRequest] = useState('')
  const [candidate, setCandidate] = useState<{ challenge: CloudChallenge; fingerprint: string }>()
  const [revoking, setRevoking] = useState<CloudDevice>()
  const [approvalRoot, setApprovalRoot] = useState('')
  const [copied, setCopied] = useState(false)
  const load = async () => { setDevices(await api.devices()); setError(false) }
  useEffect(() => {
    let active = true
    void api.devices().then((items) => { if (active) setDevices(items) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [api, status.generation])

  return <section className={`${styles.surface} ${styles.section}`}>
    <div className={styles.actions}>
      <Button icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void run(load)}>{t('cloud.refresh')}</Button>
      {status.device_status === 'pending' ? <Button type="primary" icon={<Plus size={15} />} loading={busy} onClick={() => void run(async () => {
        const result = await api.pairing(status.generation)
        setPairing(JSON.stringify(result.challenge, null, 2))
        setFingerprint(result.fingerprint)
      })}>{t('cloud.pairRequest')}</Button> : null}
    </div>
    {error ? <Alert type="warning" title={t('cloud.loadFailed')} /> : null}
    {devices.length === 0 ? <Empty description={t('cloud.noDevices')} /> : devices.map((device) => <div className={styles.row} key={device.id}>
      <Space align="start"><Laptop size={18} /><div className={styles.identity}><strong>{device.name}</strong><small>{device.id}</small></div></Space>
      <Space><Tag>{t(`cloud.deviceStates.${device.status}`)}</Tag>{device.id === status.device_id ? <span className={styles.hint}>{t('cloud.currentDevice')}</span> : <Button danger disabled={busy || device.status === 'revoked' || status.device_status !== 'active'} onClick={() => setRevoking(device)}>{t('cloud.revoke')}</Button>}</Space>
    </div>)}
    {status.device_status === 'pending' ? <>
      <p className={styles.hint}>{t('cloud.pairHint')}</p>
      {pairing ? <Input.TextArea readOnly value={pairing} rows={5} aria-label={t('cloud.pairRequest')} /> : null}
      {fingerprint ? <div className={styles.identity}><strong>{t('cloud.deviceFingerprint')}</strong><code className={styles.mono}>{fingerprint}</code></div> : null}
      <Input.TextArea value={root} onChange={(event) => setRoot(event.target.value)} rows={3} maxLength={8192} aria-label={t('cloud.trustRoot')} placeholder={t('cloud.trustRoot')} />
      <Button disabled={!root || busy} onClick={() => void run(() => api.accept(status.generation, root.trim()))}>{t('cloud.acceptTrust')}</Button>
    </> : <>
      <h3>{t('cloud.approveDevice')}</h3>
      <Input.TextArea value={request} onChange={(event) => setRequest(event.target.value)} rows={4} maxLength={16_384} aria-label={t('cloud.pairRequest')} placeholder={t('cloud.pastePairing')} />
      <Button disabled={!request || busy} onClick={() => void run(async () => {
        const value: unknown = JSON.parse(request)
        if (!value || typeof value !== 'object' || !('signing_key' in value) || !('recipient' in value) || typeof value.signing_key !== 'string' || typeof value.recipient !== 'string') throw new Error('pairing_invalid')
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${value.signing_key}\0${value.recipient}`))
        const fingerprint = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
        setCandidate({ challenge: value as CloudChallenge, fingerprint })
      })}>{t('cloud.reviewDevice')}</Button>
      {approvalRoot ? <Alert type="success" title={t('cloud.deviceApproved')} description={<Space direction="vertical"><span>{t('cloud.returnTrustRoot')}</span><code className={styles.mono}>{approvalRoot}</code><Button icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void run(async () => { await navigator.clipboard.writeText(approvalRoot); setCopied(true) })}>{t('cloud.copy')}</Button></Space>} /> : null}
    </>}
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
  </section>
}

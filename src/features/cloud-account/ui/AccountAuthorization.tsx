import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, Modal, Tag } from 'antd'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudMFAProof, CloudMFAMethod } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudChanges } from '../model/useCloudChanges'
import { useCloudReconnect } from '../model/useCloudReconnect'
import { AccountMFAFields } from './AccountMFAFields'
import styles from './AccountAuthorization.module.scss'

interface Props { api: CloudGateway; generation: string; value: CloudAuthorization; mfaEnabled?: boolean; open?: boolean; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined>; onClose: () => void; onChanged: () => void }
interface ReadScope { api: CloudGateway; generation: string; kind: CloudAuthorization['kind']; id: string; controller: AbortController; active: boolean; request: number; pending: boolean; queued: boolean }

export function AccountAuthorization({ api, generation, value, mfaEnabled, open = true, busy, run, onClose, onChanged }: Props) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(value)
  const [error, setError] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [matchedDigest, setMatchedDigest] = useState('')
  const [trust, setTrust] = useState(false)
  const [method, setMethod] = useState<CloudMFAMethod>('totp')
  const [verifying, setVerifying] = useState(false)
  const [draftRevision, setDraftRevision] = useState(value.revision)
  const [form] = Form.useForm<CloudMFAProof>()
  const lifetime = useRef<ReadScope | null>(null)
  const automatic = useRef('')
  const matched = Boolean(current.fingerprint && matchedDigest === current.fingerprint)
  const read = useCallback(async (invalidate = true) => {
    const scope = lifetime.current
    if (!scope?.active || scope.api !== api || scope.generation !== generation || scope.kind !== value.kind || scope.id !== value.id || scope.controller.signal.aborted) return
    // 只读提示保留当前有效响应；操作完成后的请求序列仍阻止旧详情回写。
    if (scope.pending) { scope.queued = true; if (invalidate) scope.request++; return }
    scope.pending = true
    try {
      do {
        scope.queued = false
        const request = ++scope.request
        const active = () => scope.active && !scope.controller.signal.aborted && request === scope.request && generation === api.getStatus()?.generation
        try {
          const next = await api.authorization(generation, value.kind, value.id, scope.controller.signal)
          if (active()) { setCurrent(next); setError(false) }
        } catch { if (active()) setError(true) }
      } while (scope.queued && scope.active && !scope.controller.signal.aborted && generation === api.getStatus()?.generation)
    } finally { scope.pending = false }
  }, [api, generation, value.kind, value.id])
  const refresh = useCallback(async () => { await read(false) }, [read])
  useEffect(() => {
    const scope: ReadScope = { api, generation, kind: value.kind, id: value.id, controller: new AbortController(), active: true, request: 0, pending: false, queued: false }; lifetime.current = scope
    // 首次读取补齐打开弹窗前的变化；后续仅由长连接失效、重连和用户操作触发补读。
    void read()
    return () => { scope.active = false; scope.controller.abort(); form.resetFields() }
  }, [api, generation, value.kind, value.id, read, form])
  useCloudChanges(api, generation, ['authorizations', 'devices', 'security', 'recovery', 'workspaces'], refresh, value.id)
  useCloudReconnect(api, generation, read)
  const action = useCallback(async (name: string, proof?: CloudMFAProof) => {
    if (!open || name === 'verify' && mfaEnabled === undefined) return
    const scope = lifetime.current
    if (!scope?.active) return
    const revision = proof ? draftRevision : current.revision
    try {
      setActionError(false)
      const result = await run(async () => {
        const result = await api.authorizationAction(generation, current.kind, current.id, name, { expected_revision: revision, fingerprint: matched ? current.fingerprint : undefined, confirm_trust: trust, ...proof })
        if (scope.active && generation === api.getStatus()?.generation) { scope.request++; setCurrent(result); setError(false); setVerifying(false); onChanged() }
        return result
      })
      if (!result && scope.active) setActionError(true)
    } finally { if (scope.active) { form.resetFields(['password', 'code']); await read() } }
  }, [api, generation, current, draftRevision, matched, trust, form, run, onChanged, read, mfaEnabled, open])
  useEffect(() => {
    if (open && (current.kind === 'approval' || current.kind === 'recovery' && trust) && current.status === 'approved' && current.allowed_actions.includes('claim') && !busy && automatic.current !== current.revision) {
      automatic.current = current.revision
      void action('claim')
    }
  }, [current, busy, action, trust, open])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const allowed = (name: string) => current.allowed_actions.includes(name)
  const remaining = Math.max(0, Math.ceil((Date.parse(current.expires_at) - now) / 1000))
  const expired = remaining === 0 && !['approved', 'acknowledged'].includes(current.status)
  const canVerify = !expired && allowed('verify')
  useEffect(() => {
    if (canVerify) return
    // 申请过期、失效或验证权限撤回时立即移除身份草稿。
    form.resetFields()
    setVerifying(false)
    setMethod('totp')
  }, [canVerify, form])
  // 临时让位主机密钥审批时保留表单；真正关闭由父组件卸载并清理秘密。
  return <Modal open={open} title={t(`cloud.authorization.${current.kind}Title`)} footer={null} width={600} onCancel={onClose} mask={{ closable: !busy }} closable={!busy}>
    <div className={styles.flow}>
      <div className={styles.summary}><ShieldCheck size={22} /><div><strong>{current.name || t('cloud.currentDevice')}</strong><span>{current.platform} {current.source_summary}</span></div><Tag>{t(`cloud.authorization.states.${current.status}`)}</Tag></div>
      <p className={styles.caption}>{t('cloud.authorization.created', { date: new Date(current.created_at).toLocaleString() })}</p>
      {error ? <Alert type="warning" showIcon title={t('cloud.authorization.readFailed')} action={<Button onClick={() => void read()}>{t('cloud.retry')}</Button>} /> : null}
      {actionError ? <Alert type="error" showIcon title={t('cloud.authorization.actionFailed')} /> : null}
      {mfaEnabled === undefined && allowed('verify') ? <Alert type="warning" showIcon title={t('cloud.authorization.readFailed')} action={<Button onClick={onChanged}>{t('cloud.retry')}</Button>} /> : null}
      {expired ? <Alert type="warning" showIcon title={t('cloud.authorization.expired')} /> : null}
      {!expired && ['pending', 'verifying', 'verified', 'processing'].includes(current.status) ? <p className={styles.caption}>{t('cloud.authorization.remaining', { time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` })}</p> : null}
      {current.fingerprint ? <div className={styles.checkpoint}>
        <strong>{t('cloud.authorization.fingerprint')}</strong>
        <div className={styles.fingerprint}>{current.fingerprint.split(' ').map((group, i) => <code key={i}>{group}</code>)}</div>
        <p>{t('cloud.authorization.fingerprintHint')}</p>
        <Checkbox checked={matched} disabled={busy} onChange={event => setMatchedDigest(event.target.checked ? current.fingerprint! : '')}>{t('cloud.authorization.matched')}</Checkbox>
      </div> : null}
      {current.keys_verified ? <Alert type="success" showIcon title={t('cloud.authorization.verified')} description={t('cloud.authorization.previewNext')} /> : null}
      {current.kind !== 'approval' ? <Checkbox checked={trust} disabled={busy} onChange={event => setTrust(event.target.checked)}>{t('cloud.authorization.platformTrust')}</Checkbox> : null}
      {verifying && canVerify ? <Form form={form} layout="vertical" onFinish={proof => { if (canVerify && !error) void action('verify', { ...proof, method: mfaEnabled || current.kind !== 'approval' ? method : undefined }) }}>
        <Form.Item name="password" label={t('cloud.password')} rules={[{ required: true }]}><Input.Password autoFocus autoComplete="current-password" disabled={busy} /></Form.Item>
        {mfaEnabled || current.kind !== 'approval' ? <AccountMFAFields method={method} onMethodChange={setMethod} disabled={busy} methods={current.kind === 'approval' ? undefined : ['totp']} /> : null}
        <p className={styles.caption}>{t('cloud.authorization.nextCode')}</p>
        <Button type="primary" htmlType="submit" loading={busy} disabled={error || expired || mfaEnabled === undefined || current.kind !== 'approval' && !trust}>{t('cloud.authorization.verify')}</Button>
      </Form> : null}
      <div className={styles.actions}>
        {allowed('respond') ? <Button type="primary" disabled={busy || error || expired} onClick={() => void action('respond')}>{t('cloud.authorization.respond')}</Button> : null}
        {allowed('confirm') ? <Button type="primary" disabled={busy || error || expired || !matched} onClick={() => void action('confirm')}>{t('cloud.authorization.confirm')}</Button> : null}
        {allowed('verify') && !verifying ? <Button disabled={busy || error || expired || mfaEnabled === undefined || current.kind === 'approval' && !matched || current.kind !== 'approval' && !trust} onClick={() => { setDraftRevision(current.revision); form.resetFields(); setVerifying(true) }}>{t('cloud.authorization.verify')}</Button> : null}
        {allowed('approve') ? <Button type="primary" disabled={busy || error || expired || !matched} onClick={() => void action('approve')}>{t('cloud.authorization.approve')}</Button> : null}
        {allowed('complete') ? <Button type="primary" disabled={busy || error || expired || !trust} onClick={() => void action('complete')}>{t('cloud.authorization.complete')}</Button> : null}
        {allowed('claim') && !current.keys_verified ? <Button type="primary" disabled={busy || error || current.kind === 'recovery' && !trust} onClick={() => void action('claim')}>{t('cloud.authorization.claim')}</Button> : null}
        {allowed('reject') ? <Button danger disabled={busy} onClick={() => void action('reject')}>{t('cloud.authorization.reject')}</Button> : null}
        {allowed('cancel') ? <Button disabled={busy} onClick={() => void action('cancel')}>{t('cloud.authorization.cancel')}</Button> : null}
      </div>
    </div>
  </Modal>
}

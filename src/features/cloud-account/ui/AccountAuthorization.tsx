import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, Modal, Tag } from 'antd'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudMFAProof, CloudMFAMethod } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { AccountMFAFields } from './AccountMFAFields'
import styles from './AccountAuthorization.module.scss'

interface Props { api: CloudGateway; generation: string; value: CloudAuthorization; mfaEnabled: boolean; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined>; onClose: () => void; onChanged: () => void }

export function AccountAuthorization({ api, generation, value, mfaEnabled, busy, run, onClose, onChanged }: Props) {
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
  const lifetime = useRef({ active: true, request: 0 })
  const automatic = useRef('')
  const matched = Boolean(current.fingerprint && matchedDigest === current.fingerprint)
  const read = useCallback(async () => {
    const scope = lifetime.current, request = ++scope.request
    try {
      const next = await api.authorization(generation, value.kind, value.id)
      if (scope.active && request === scope.request && generation === api.getStatus()?.generation) { setCurrent(next); setError(false) }
    } catch { if (scope.active && request === scope.request) setError(true) }
  }, [api, generation, value.kind, value.id])
  useEffect(() => {
    const scope = { active: true, request: 0 }; lifetime.current = scope
    let delay = 3000, timer: number
    const poll = async () => { await read(); if (scope.active) { delay = Math.min(15_000, delay * 1.4); timer = window.setTimeout(() => void poll(), delay + Math.random() * 500) } }
    timer = window.setTimeout(() => void poll(), delay)
    return () => { scope.active = false; window.clearTimeout(timer); form.resetFields() }
  }, [read, form])
  const action = useCallback(async (name: string, proof?: CloudMFAProof) => {
    const scope = lifetime.current
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
  }, [api, generation, current, draftRevision, matched, trust, form, run, onChanged, read])
  useEffect(() => {
    if ((current.kind === 'approval' || current.kind === 'recovery' && trust) && current.status === 'approved' && current.allowed_actions.includes('claim') && !busy && automatic.current !== current.revision) {
      automatic.current = current.revision
      void action('claim')
    }
  }, [current, busy, action, trust])
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
  return <Modal open title={t(`cloud.authorization.${current.kind}Title`)} footer={null} width={600} onCancel={onClose} destroyOnHidden mask={{ closable: !busy }} closable={!busy}>
    <div className={styles.flow}>
      <div className={styles.summary}><ShieldCheck size={22} /><div><strong>{current.name || t('cloud.currentDevice')}</strong><span>{current.platform} {current.source_summary}</span></div><Tag>{t(`cloud.authorization.states.${current.status}`)}</Tag></div>
      <p className={styles.caption}>{t('cloud.authorization.created', { date: new Date(current.created_at).toLocaleString() })}</p>
      {error ? <Alert type="warning" showIcon title={t('cloud.authorization.readFailed')} action={<Button onClick={() => void read()}>{t('cloud.retry')}</Button>} /> : null}
      {actionError ? <Alert type="error" showIcon title={t('cloud.authorization.actionFailed')} /> : null}
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
        <Button type="primary" htmlType="submit" loading={busy} disabled={error || expired || current.kind !== 'approval' && !trust}>{t('cloud.authorization.verify')}</Button>
      </Form> : null}
      <div className={styles.actions}>
        {allowed('respond') ? <Button type="primary" disabled={busy || error || expired} onClick={() => void action('respond')}>{t('cloud.authorization.respond')}</Button> : null}
        {allowed('confirm') ? <Button type="primary" disabled={busy || error || expired || !matched} onClick={() => void action('confirm')}>{t('cloud.authorization.confirm')}</Button> : null}
        {allowed('verify') && !verifying ? <Button disabled={busy || error || expired || current.kind === 'approval' && !matched || current.kind !== 'approval' && !trust} onClick={() => { setDraftRevision(current.revision); form.resetFields(); setVerifying(true) }}>{t('cloud.authorization.verify')}</Button> : null}
        {allowed('approve') ? <Button type="primary" disabled={busy || error || expired || !matched} onClick={() => void action('approve')}>{t('cloud.authorization.approve')}</Button> : null}
        {allowed('complete') ? <Button type="primary" disabled={busy || error || expired || !trust} onClick={() => void action('complete')}>{t('cloud.authorization.complete')}</Button> : null}
        {allowed('claim') && !current.keys_verified ? <Button type="primary" disabled={busy || error || current.kind === 'recovery' && !trust} onClick={() => void action('claim')}>{t('cloud.authorization.claim')}</Button> : null}
        {allowed('reject') ? <Button danger disabled={busy} onClick={() => void action('reject')}>{t('cloud.authorization.reject')}</Button> : null}
        {allowed('cancel') ? <Button disabled={busy} onClick={() => void action('cancel')}>{t('cloud.authorization.cancel')}</Button> : null}
      </div>
    </div>
  </Modal>
}

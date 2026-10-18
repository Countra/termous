import { FeedbackMessage, FeedbackMessageScope, modalSurfaceStyles } from '#shared/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Form, Modal, Tag } from 'antd'
import { Clock3, Laptop, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudAuthorizationAction, CloudMFAProof } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudChanges } from '../model/useCloudChanges'
import { useCloudReconnect } from '../model/useCloudReconnect'
import { AccountStepUpFields } from './AccountStepUpFields'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { cloudOperationErrorCode } from '../model/useCloudOperationFeedback'
import { AccountOperationError } from './AccountOperationError'
import styles from './AccountAuthorization.module.scss'

interface Props { api: CloudGateway; generation: string; value: CloudAuthorization; mfaEnabled?: boolean; mfaRevision?: string; open?: boolean; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined>; onClose: () => void; onChanged: () => void }
interface ReadScope { api: CloudGateway; generation: string; kind: CloudAuthorization['kind']; id: string; controller: AbortController; active: boolean; request: number; pending: boolean; queued: boolean; submitting: boolean }
interface ActionError { action: CloudAuthorizationAction; code: string }

function actionConfirmed(action: CloudAuthorizationAction, value: CloudAuthorization) {
  if (['rejected', 'cancelled', 'expired', 'invalidated'].includes(value.status)) return true
  const approved = ['approved', 'acknowledged'].includes(value.status)
  switch (action) {
    case 'approve': case 'complete': return approved
    case 'verify': return ['verified', 'processing'].includes(value.status) || approved
    case 'claim': return value.keys_verified
    default: return false
  }
}

export function AccountAuthorization({ api, generation, value, mfaEnabled, mfaRevision, open = true, busy, run, onClose, onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const [current, setCurrent] = useState(value)
  const [error, setError] = useState(false)
  const [actionError, setActionError] = useState<ActionError>()
  const [now, setNow] = useState(Date.now())
  const [trust, setTrust] = useState(false)
  const [working, setWorking] = useState(false)
  const [form] = Form.useForm<CloudMFAProof>()
  const lifetime = useRef<ReadScope | null>(null)
  const automatic = useRef('')
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
    const scope: ReadScope = { api, generation, kind: value.kind, id: value.id, controller: new AbortController(), active: true, request: 0, pending: false, queued: false, submitting: false }; lifetime.current = scope
    // 首次读取补齐打开弹窗前的变化；后续仅由长连接失效、重连和用户操作触发补读。
    void read()
    return () => { scope.active = false; scope.controller.abort(); form.resetFields() }
  }, [api, generation, value.kind, value.id, read, form])
  useCloudChanges(api, generation, ['authorizations', 'devices', 'security', 'recovery', 'workspaces'], refresh, value.id)
  useCloudReconnect(api, generation, read)
  const action = useCallback(async (name: CloudAuthorizationAction, proof?: CloudMFAProof) => {
    if (!open || proof && mfaEnabled === undefined) return
    const scope = lifetime.current
    if (!scope?.active || scope.submitting) return
    scope.submitting = true; setWorking(true)
    try {
      setActionError(undefined)
      await run(async () => {
        try {
          const result = await api.authorizationAction(generation, current.kind, current.id, name, { expected_revision: current.revision, confirm_trust: trust, ...proof })
          if (scope.active && generation === api.getStatus()?.generation) { scope.request++; setCurrent(result); setError(false); onChanged() }
          return result
        } catch (cause) {
          const code = cloudOperationErrorCode(cause, value => i18n.exists(`cloud.errors.${value}`))
          if (scope.active && generation === api.getStatus()?.generation) setActionError({ action: name, code })
          throw Object.assign(new Error(code), { cause })
        }
      })
    } finally { scope.submitting = false; if (scope.active) { setWorking(false); form.resetFields(['password', 'code']); await read() } }
  }, [api, generation, current, trust, form, run, onChanged, read, mfaEnabled, open, i18n])
  useEffect(() => {
    if (open && current.kind === 'recovery' && trust && current.status === 'approved' && current.allowed_actions.includes('claim') && !busy && !working && automatic.current !== current.revision) {
      automatic.current = current.revision
      void action('claim')
    }
  }, [current, busy, working, action, trust, open])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const allowed = (name: string) => current.allowed_actions.includes(name)
  const remaining = Math.max(0, Math.ceil((Date.parse(current.expires_at) - now) / 1000))
  const expired = remaining === 0 && !['approved', 'acknowledged'].includes(current.status)
  const canVerify = !expired && (current.kind === 'approval' ? allowed('approve') : allowed('verify'))
  useEffect(() => {
    if (canVerify) return
    // 申请过期、失效或验证权限撤回时立即移除身份草稿。
    form.resetFields()
  }, [canVerify, form])
  useEffect(() => {
    // 响应丢失后只按已确认的业务结果清除旧错误；相同状态补读不能吞掉失败原因。
    if (actionError && actionConfirmed(actionError.action, current)) setActionError(undefined)
  }, [actionError, current])
  const disabled = busy || working
  const status = api.getStatus()
  const approval = current.kind === 'approval'
  const requester = approval && current.device_id === status?.device_id
  const approved = ['approved', 'acknowledged'].includes(current.status)
  const title = approval && requester ? current.keys_verified ? 'completedTitle' : 'waitingTitle' : `${current.kind}Title`
  const retryClaim = requester && approved && !current.keys_verified && allowed('claim')
    && status?.phase === 'blocked' && Boolean(status.error_code) && !['login_required', 'refresh_unconfirmed'].includes(status.error_code ?? '')
  // 临时让位主机密钥审批时保留表单；真正关闭由父组件卸载并清理秘密。
  return <Modal open={open} rootClassName={modalSurfaceStyles.root} title={t(`cloud.authorization.${title}`)} footer={null} width={560} centered onCancel={onClose} mask={{ closable: !disabled }} closable={!disabled} keyboard={!disabled}><FeedbackMessageScope active={open}>
    <div className={styles.flow}>
      <div className={styles.summary}>
        <span className={styles['device-icon']} aria-hidden="true"><Laptop size={22} /></span>
        <div><strong>{current.name || t('cloud.currentDevice')}</strong><span>{[current.platform, current.source_summary].filter(Boolean).join(' · ')}</span></div>
        <Tag color={approved ? 'success' : expired ? 'warning' : undefined}>{t(`cloud.authorization.states.${current.status}`)}</Tag>
      </div>
      <div className={styles.metadata}>
        <time dateTime={current.created_at}>{new Date(current.created_at).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
        {!expired && ['pending', 'verifying', 'verified', 'processing'].includes(current.status) ? <span><Clock3 size={13} aria-hidden="true" />{t('cloud.authorization.remaining', { time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` })}</span> : null}
      </div>
      {error ? <FeedbackMessage type="warning" title={t('cloud.authorization.readFailed')} /> : null}
      <AccountOperationError code={actionError?.code} />
      {mfaEnabled === undefined && canVerify ? <FeedbackMessage type="warning" title={t('cloud.authorization.readFailed')} /> : null}
      {expired ? <FeedbackMessage type="warning" title={t('cloud.authorization.expired')} /> : null}
      {approval ? <section className={styles.pairing} aria-label={t('cloud.authorization.pairingCode')}>
        <div className={styles['pairing-label']}><ShieldCheck size={15} aria-hidden="true" /><span>{t('cloud.authorization.pairingCode')}</span></div>
        {current.pairing_code ? <div className={styles.fingerprint}>{current.pairing_code.split(' ').map((group, i) => <code key={i}>{group}</code>)}</div> : <div className={styles['pairing-unavailable']}><span>{t('cloud.authorization.pairingUnavailable')}</span><Button type="link" size="small" disabled={disabled} onClick={() => void read()}>{t('cloud.retry')}</Button></div>}
        <p>{t(requester || !canVerify ? 'cloud.authorization.pairingRequestHint' : 'cloud.authorization.pairingApproveHint')}</p>
      </section> : null}
      {requester && !expired && !approved && ['pending', 'verifying'].includes(current.status) ? <p className={styles.waiting}>{t('cloud.authorization.waitingHint')}</p> : null}
      {current.keys_verified ? <FeedbackMessage type="success" title={t('cloud.authorization.verified')} description={t('cloud.authorization.previewNext')} /> : null}
      {approval && !requester && approved ? <FeedbackMessage type="success" title={t('cloud.authorization.approvedTitle')} description={t('cloud.authorization.approvedHint')} /> : null}
      {requester && approved && !current.keys_verified ? <FeedbackMessage type={retryClaim ? 'warning' : 'info'} title={t(retryClaim ? 'cloud.authorization.localRetryHint' : 'cloud.authorization.finishingLocal')} /> : null}
      {current.kind !== 'approval' ? <Checkbox checked={trust} disabled={disabled} onChange={event => setTrust(event.target.checked)}>{t('cloud.authorization.platformTrust')}</Checkbox> : null}
      <Form form={form} hidden={!canVerify} layout="vertical" onFinish={proof => { if (canVerify && !error && !disabled && mfaEnabled !== undefined && (current.kind === 'approval' || mfaEnabled)) void action(current.kind === 'approval' ? 'approve' : 'verify', buildCloudStepUpProof(mfaEnabled, proof, current.kind !== 'approval')) }}>
        {canVerify ? <>
          <AccountStepUpFields enabled={mfaEnabled} revision={mfaRevision} disabled={disabled} totpOnly={current.kind !== 'approval'} />
          <div className={styles.actions}>
            {allowed('reject') ? <Button danger type="text" disabled={disabled} onClick={() => void action('reject')}>{t('cloud.authorization.reject')}</Button> : null}
            <Button type="primary" htmlType="submit" loading={disabled} disabled={error || expired || mfaEnabled === undefined || current.kind !== 'approval' && (!mfaEnabled || !trust)}>{t(current.kind === 'approval' ? 'cloud.authorization.approve' : 'cloud.authorization.verify')}</Button>
          </div>
        </> : null}
      </Form>
      <div className={styles.actions}>
        {error || mfaEnabled === undefined && canVerify ? <Button disabled={disabled} onClick={error ? () => void read() : onChanged}>{t('cloud.retry')}</Button> : null}
        {retryClaim && approval ? <Button disabled={disabled} loading={working} onClick={() => void action('claim')}>{t('cloud.authorization.retryLocal')}</Button> : null}
        {allowed('complete') ? <Button type="primary" disabled={disabled || error || expired || !trust} onClick={() => void action('complete')}>{t('cloud.authorization.complete')}</Button> : null}
        {allowed('claim') && !current.keys_verified && current.kind === 'recovery' ? <Button type="primary" disabled={disabled || error || !trust} onClick={() => void action('claim')}>{t('cloud.authorization.claim')}</Button> : null}
        {allowed('reject') && !canVerify ? <Button danger disabled={disabled} onClick={() => void action('reject')}>{t('cloud.authorization.reject')}</Button> : null}
        {allowed('cancel') ? <Button disabled={disabled} onClick={() => void action('cancel')}>{t('cloud.authorization.cancel')}</Button> : null}
      </div>
    </div>
  </FeedbackMessageScope></Modal>
}

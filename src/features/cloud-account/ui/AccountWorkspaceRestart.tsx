import { FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Checkbox, Form, Input, Modal, Steps } from 'antd'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudMFAProof, CloudStatus, CloudWorkspaceRestart } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { AccountStepUpFields } from './AccountStepUpFields'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { useDeadlineExpired } from '../model/useDeadlineExpired'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { useCloudChanges } from '../model/useCloudChanges'
import { AccountOperationError } from './AccountOperationError'
import styles from './AccountWorkspaceRestart.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; mfaEnabled?: boolean; mfaRevision?: string; run: <T>(action: () => Promise<T>) => Promise<T | undefined>; secondary?: boolean }
export function AccountWorkspaceRestart({ api, status, busy, mfaEnabled, mfaRevision, run, secondary }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [op, setOp] = useState<CloudWorkspaceRestart>()
  const [accepted, setAccepted] = useState(false)
  const [proof] = Form.useForm<CloudMFAProof & { email_token: string }>()
  const formId = useId()
  const feedback = useCloudOperationFeedback(api, status.generation, run)
  const policy = useRef({ enabled: mfaEnabled, revision: mfaRevision })
  useEffect(() => { policy.current = { enabled: mfaEnabled, revision: mfaRevision } }, [mfaEnabled, mfaRevision])
  const inactive = busy || feedback.working
  useEffect(() => () => { proof.setFieldsValue({ password: undefined, code: undefined, email_token: undefined }) }, [status.generation, proof])
  const close = () => { feedback.reset(); setOpen(false); proof.setFieldsValue({ password: undefined, code: undefined, email_token: undefined }); setOp(undefined); setAccepted(false) }
  const read = async (current: () => boolean, id = op?.id ?? 'current') => { const value = await api.workspaceRestart(status.generation, id); if (current()) { setOp(value); if (value.revision !== op?.revision) setAccepted(false) } }
  useCloudChanges(api, status.generation, ['workspaces', 'security', 'mfa'], () => {
    if (open && op && !inactive) void feedback.perform(current => read(current))
  }, op?.id)
  const expired = useDeadlineExpired(op?.status === 'verified' ? op.verified_until ?? op.expires_at : op?.expires_at) && !['completed', 'cancelled'].includes(op?.status ?? '')
  useEffect(() => { if (expired) proof.setFieldsValue({ password: undefined, code: undefined, email_token: undefined }) }, [expired, proof])
  const terminal = !!op && ['cancelled', 'expired', 'invalidated'].includes(op.status)
  const stage = !op || terminal ? 0 : op.status === 'verified' || op.status === 'completed' ? 2 : 1
  return <>
    <Button type={secondary ? 'link' : 'default'} icon={!secondary ? <RotateCcw size={15} /> : undefined} danger={!secondary} disabled={inactive} onClick={() => { feedback.reset(); setOpen(true); setOp(undefined); setAccepted(false) }}>{t(secondary ? 'cloud.safeguards.noOptions' : 'cloud.safeguards.restartTitle')}</Button>
    <Modal open={open} title={t('cloud.safeguards.restartTitle')} centered width={680} className={styles.modal} destroyOnHidden closable={!inactive} mask={{ closable: !inactive }} keyboard={!inactive} onCancel={close} footer={<div className={styles.footer}>
      <Button disabled={inactive} onClick={close}>{t('app.close')}</Button>
      <div className={styles.actions}>
        {!op || terminal ? <>
          {!op ? <Button disabled={inactive} onClick={() => void feedback.perform(current => read(current, 'current'))}>{t('cloud.safeguards.resumeOperation')}</Button> : null}
          <Button type="primary" loading={feedback.working} disabled={inactive || mfaEnabled === undefined} onClick={() => void feedback.perform(async current => { const result = await api.createWorkspaceRestart(status.generation); if (current()) { setOp(result); setAccepted(false); proof.resetFields() } })}>{t('cloud.safeguards.createRestart')}</Button>
        </> : null}
        {op?.status === 'pending' && !expired ? <Button type="primary" htmlType="submit" form={formId} loading={inactive} disabled={!op.email_sent || mfaEnabled === undefined}>{t('cloud.safeguards.verifyIdentity')}</Button> : null}
        {op?.status === 'verified' || op?.status === 'completed' && op.local_pending ? <Button type="primary" danger={op.status !== 'completed'} loading={inactive} disabled={inactive || (op.status !== 'completed' && (!accepted || expired))} onClick={() => void feedback.perform(async current => { const result = await api.completeRestart(status.generation, op.id, op.revision); if (current()) { setOp(result); setAccepted(false) } })}>{t(op.status === 'completed' ? 'cloud.safeguards.finishLocal' : 'cloud.safeguards.restartConfirm')}</Button> : null}
      </div>
    </div>}><FeedbackMessageScope active={open}>
      <Steps className={styles.steps} current={stage} status={op?.status === 'completed' ? 'finish' : undefined} size="small" items={['restartImpact', 'verifyIdentity', 'restartReview'].map(key => ({ title: t(`cloud.safeguards.${key}`) }))} />
      <div className={styles.body}>
        {stage !== 1 ? <div className={styles.impact} role="note">
          <RotateCcw size={18} aria-hidden="true" />
          <div><h3>{t('cloud.safeguards.restartImmediate')}</h3><ul>{['local', 'access', 'next'].map(key => <li key={key}>{t(`cloud.safeguards.restartEffects.${key}`)}</li>)}</ul></div>
        </div> : null}
        <AccountOperationError code={feedback.errorCode} />
        {op ? <>
          <div className={styles.toolbar}>
            {op.source_device_count !== undefined ? <p>{t('cloud.safeguards.restartDevices', { count: op.source_device_count })}</p> : null}
            <div className={styles.actions}><Button size="small" type="text" disabled={inactive} onClick={() => void feedback.perform(current => read(current))}>{t('cloud.safeguards.queryResult')}</Button>{op.status !== 'completed' && !terminal ? <Button size="small" type="text" disabled={inactive} onClick={() => void feedback.perform(async current => { const result = await api.cancelRestart(status.generation, op.id, op.revision); if (current() && result.status === 'cancelled') { setOp(undefined); setAccepted(false); proof.resetFields() } })}>{t('cloud.safeguards.cancelOperation')}</Button> : null}</div>
          </div>
          {terminal ? <FeedbackMessage type="warning" title={t(`cloud.authorization.states.${op.status}`)} /> : expired ? <FeedbackMessage type="warning" title={t('cloud.safeguards.expired')} /> : null}
          {op.status === 'pending' && !expired ? <>
            <div className={styles.email}><h3>{t('cloud.safeguards.restartEmailTitle')}</h3><Button size="small" disabled={inactive} onClick={() => void feedback.perform(async current => { const value = await api.sendRestartEmail(status.generation, op.id, op.revision); if (current()) setOp(value) })}>{t(op.email_sent ? 'cloud.safeguards.resendEmail' : 'cloud.safeguards.sendEmail')}</Button></div>
            <Form id={formId} className={styles.proof} form={proof} layout="vertical" onFinish={evidence => void feedback.perform(async current => {
              if (inactive || expired || !op.email_sent || mfaEnabled === undefined) return
              const startedPolicy = policy.current
              try {
                const result = await api.verifyRestart(status.generation, op.id, op.revision, evidence.email_token, buildCloudStepUpProof(mfaEnabled, evidence))
                if (!current()) return
                if (startedPolicy !== policy.current) { await read(current); throw new Error('mfa_revision_conflict') }
                setOp(result)
              } finally { if (current()) proof.resetFields(['password', 'code', 'email_token']) }
            })}>
              <Form.Item name="email_token" label={t('cloud.safeguards.emailToken')} rules={[{ required: true }]}><Input autoComplete="off" spellCheck={false} disabled={inactive} /></Form.Item>
              <AccountStepUpFields enabled={mfaEnabled} revision={mfaRevision} disabled={inactive} />
            </Form>
          </> : null}
          {op.status === 'verified' || op.status === 'completed' ? <>
            {op.status === 'completed' ? <FeedbackMessage type={op.local_pending ? 'warning' : 'success'} title={t(op.local_pending ? 'cloud.safeguards.localPending' : 'cloud.safeguards.restartDone')} /> : <div className={styles.confirmation}><Checkbox disabled={inactive} checked={accepted} onChange={event => setAccepted(event.target.checked)}>{t('cloud.safeguards.restartAccept')}</Checkbox></div>}
          </> : null}
        </> : null}
      </div>
    </FeedbackMessageScope></Modal>
  </>
}

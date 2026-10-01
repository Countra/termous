import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, Modal, Steps } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudMFAProof, CloudMFAMethod, CloudStatus, CloudWorkspaceRestart } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { AccountMFAFields } from './AccountMFAFields'
import { useDeadlineExpired } from '../model/useDeadlineExpired'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { useCloudChanges } from '../model/useCloudChanges'
import { AccountOperationError } from './AccountOperationError'
import styles from './AccountSafeguards.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; mfaEnabled?: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined>; secondary?: boolean }
export function AccountWorkspaceRestart({ api, status, busy, mfaEnabled, run, secondary }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [op, setOp] = useState<CloudWorkspaceRestart>()
  const [accepted, setAccepted] = useState(false)
  const [method, setMethod] = useState<CloudMFAMethod>('totp')
  const [proof] = Form.useForm<CloudMFAProof & { email_token: string }>()
  const feedback = useCloudOperationFeedback(api, status.generation, run)
  const inactive = busy || feedback.working
  useEffect(() => () => { if (proof.getFieldInstance('password')) proof.resetFields() }, [status.generation, proof])
  const close = () => { feedback.reset(); setOpen(false); if (proof.getFieldInstance('password')) proof.resetFields(); setOp(undefined); setAccepted(false) }
  const read = async (current: () => boolean, id = op?.id ?? 'current') => { const value = await api.workspaceRestart(status.generation, id); if (current()) { setOp(value); if (value.revision !== op?.revision) setAccepted(false) } }
  useCloudChanges(api, status.generation, ['workspaces', 'security', 'mfa'], () => {
    if (open && op && !inactive) void feedback.perform(current => read(current))
  }, op?.id)
  const expired = useDeadlineExpired(op?.status === 'verified' ? op.verified_until ?? op.expires_at : op?.expires_at) && !['completed', 'cancelled'].includes(op?.status ?? '')
  useEffect(() => { if (expired && proof.getFieldInstance('password')) proof.resetFields() }, [expired, proof])
  const stage = !op ? 0 : op.status === 'verified' || op.status === 'completed' ? 2 : 1
  return <>
    <Button type={secondary ? 'link' : 'default'} danger={!secondary} disabled={inactive} onClick={() => { feedback.reset(); setMethod('totp'); setOpen(true); setOp(undefined); setAccepted(false) }}>{t(secondary ? 'cloud.safeguards.noOptions' : 'cloud.safeguards.restartTitle')}</Button>
    <Modal open={open} title={t('cloud.safeguards.restartTitle')} footer={null} destroyOnHidden closable={!inactive} mask={{ closable: !inactive }} keyboard={!inactive} onCancel={close}>
      <div className={styles.wizard}>
        <Steps current={stage} size="small" items={['restartImpact', 'verifyIdentity', 'restartConfirm'].map(key => ({ title: t(`cloud.safeguards.${key}`) }))} />
        <Alert type="warning" showIcon title={t('cloud.safeguards.restartImmediate')} description={t('cloud.safeguards.restartHint')} />
        <AccountOperationError code={feedback.errorCode} />
        {!op ? <div className={styles.actions}>
          <Button danger type="primary" loading={feedback.working} disabled={inactive || mfaEnabled === undefined} onClick={() => void feedback.perform(async current => { const result = await api.createWorkspaceRestart(status.generation); if (current()) setOp(result) })}>{t('cloud.safeguards.createRestart')}</Button>
          <Button disabled={inactive} onClick={() => void feedback.perform(current => read(current, 'current'))}>{t('cloud.safeguards.resumeOperation')}</Button>
        </div> : <>
          {op.source_device_count !== undefined ? <p>{t('cloud.safeguards.restartDevices', { count: op.source_device_count })}</p> : null}
          {expired ? <Alert type="warning" title={t('cloud.safeguards.expired')} /> : null}
          <div className={styles.actions}><Button disabled={inactive} onClick={() => void feedback.perform(current => read(current))}>{t('cloud.safeguards.queryResult')}</Button>{op.status !== 'completed' ? <Button disabled={inactive} onClick={() => void feedback.perform(async current => { const result = await api.cancelRestart(status.generation, op.id, op.revision); if (current() && result.status === 'cancelled') { setOp(undefined); setAccepted(false); proof.resetFields() } })}>{t('cloud.safeguards.cancelOperation')}</Button> : null}</div>
          {op.status === 'pending' && !expired ? <>
            <Button disabled={inactive} onClick={() => void feedback.perform(async current => { const value = await api.sendRestartEmail(status.generation, op.id, op.revision); if (current()) setOp(value) })}>{t(op.email_sent ? 'cloud.safeguards.resendEmail' : 'cloud.safeguards.sendEmail')}</Button>
            <Form form={proof} layout="vertical" onFinish={evidence => void feedback.perform(async current => {
              try { const result = await api.verifyRestart(status.generation, op.id, op.revision, evidence.email_token, { password: evidence.password, method: mfaEnabled ? method : undefined, code: evidence.code }); if (current()) setOp(result) }
              finally { if (current()) proof.resetFields(['password', 'code', 'email_token']) }
            })}>
              <Form.Item name="email_token" label={t('cloud.safeguards.emailToken')} rules={[{ required: true }]}><Input autoComplete="off" spellCheck={false} disabled={inactive} /></Form.Item>
              <Form.Item name="password" label={t('cloud.password')} rules={[{ required: true }]}><Input.Password autoComplete="current-password" disabled={inactive} /></Form.Item>
              {mfaEnabled ? <AccountMFAFields method={method} onMethodChange={setMethod} disabled={inactive} /> : null}
              <Button type="primary" htmlType="submit" loading={inactive} disabled={!op.email_sent || mfaEnabled === undefined}>{t('cloud.safeguards.verifyIdentity')}</Button>
            </Form>
          </> : null}
          {op.status === 'verified' || op.status === 'completed' ? <>
            {op.status === 'completed' ? <Alert type={op.local_pending ? 'warning' : 'success'} title={t(op.local_pending ? 'cloud.safeguards.localPending' : 'cloud.safeguards.restartDone')} /> : <Checkbox disabled={inactive} checked={accepted} onChange={event => setAccepted(event.target.checked)}>{t('cloud.safeguards.restartAccept')}</Checkbox>}
            <Button type="primary" danger={op.status !== 'completed'} loading={inactive} disabled={inactive || (op.status !== 'completed' && (!accepted || expired))} onClick={() => void feedback.perform(async current => { const result = await api.completeRestart(status.generation, op.id, op.revision); if (current()) { setOp(result); setAccepted(false) } })}>{t(op.status === 'completed' ? 'cloud.safeguards.finishLocal' : 'cloud.safeguards.restartConfirm')}</Button>
          </> : null}
        </>}
      </div>
    </Modal>
  </>
}

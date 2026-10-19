import { useEffect, useRef } from 'react'
import { Button, Form, Tag } from 'antd'
import { Fingerprint } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudMFAProof, CloudMFAStatus } from '#common/contracts'
import { isCloudMFAUncertainError, type CloudGateway } from '#entities/cloud'
import { useCloudDeadline } from '../model/useCloudDeadline'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { AccountOperationError } from './AccountOperationError'
import { AccountSection } from './AccountSection'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { AccountStepUpFields } from './AccountStepUpFields'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; generation: string; mfa?: CloudMFAStatus; unavailable: boolean; busy: boolean; accept: (value: CloudMFAStatus) => void; reload: () => Promise<CloudMFAStatus | undefined>; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountVerification({ api, generation, mfa, unavailable, busy, accept, reload, run }: Props) {
  const { t } = useTranslation()
  const [form] = Form.useForm<CloudMFAProof>()
  const feedback = useCloudOperationFeedback(api, generation, run)
  const disabled = busy || feedback.working
  const policy = useRef({ enabled: mfa?.enabled, revision: mfa?.revision })
  useEffect(() => {
    policy.current = { enabled: mfa?.enabled, revision: mfa?.revision }; form.resetFields()
    return () => form.setFieldsValue({ password: undefined, code: undefined })
  }, [api, generation, form, mfa?.enabled, mfa?.revision])
  const { expired } = useCloudDeadline(mfa, mfa?.verified_until)
  const verified = mfa?.verified_until && !expired
  return <AccountSection title={t('cloud.securityVerification')} icon={<Fingerprint size={18} />} description={t('cloud.reauthenticateHint')}>
    {verified ? <div className={styles.actions} role="status"><Tag color="success">{t('cloud.verified')}</Tag><span className={styles.hint}>{t('cloud.mfa.verifiedUntil', { time: new Date(mfa.verified_until!).toLocaleTimeString() })}</span></div> : null}
    <AccountOperationError code={feedback.errorCode} />
    <Form name="cloud-security" className={styles['compact-form']} form={form} layout="vertical" requiredMark={false} disabled={disabled || unavailable} onFinish={(values) => void feedback.perform(async current => {
      if (busy || unavailable || !mfa) return
      const startedPolicy = policy.current
      try {
        const proof = buildCloudStepUpProof(mfa?.enabled, values)
        const result = await api.reauthenticate(generation, proof)
        if (current()) {
          if (startedPolicy !== policy.current) throw new Error('mfa_revision_conflict')
          accept({ ...mfa, server_time: result.server_time, verified_until: result.verified_until }); form.resetFields()
          // 备用码消费不提升因子版本，补读余量；读取失败保留已确认的验证期限。
          if (proof.method === 'backup_code') await reload()
        }
      } catch (cause) {
        if (current() && isCloudMFAUncertainError(cause)) { form.resetFields(); await reload() }
        throw cause
      } finally { if (current() && startedPolicy === policy.current) form.resetFields() }
    })}>
      {mfa ? <AccountStepUpFields enabled={mfa.enabled} revision={mfa.revision} disabled={disabled || unavailable} autoFocus={false} /> : null}
      <Button type="primary" htmlType="submit" loading={disabled}>{t('cloud.auth.reauthenticate')}</Button>
    </Form>
  </AccountSection>
}

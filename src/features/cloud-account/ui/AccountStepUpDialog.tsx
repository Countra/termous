import { cloudDeadlineRemaining } from '#entities/cloud'
import { useEffect, useRef } from 'react'
import { Button, Form, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudMFAProof, CloudMFAStatus } from '#common/contracts'
import { isCloudMFAUncertainError, type CloudGateway } from '#entities/cloud'
import { modalSurfaceStyles } from '#shared/ui'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { useCloudDeadline } from '../model/useCloudDeadline'
import { AccountOperationError } from './AccountOperationError'
import { AccountStepUpFields } from './AccountStepUpFields'

interface Props {
  api: CloudGateway
  generation: string
  mfa?: CloudMFAStatus
  unavailable: boolean
  busy: boolean
  title: string
  description: string
  danger?: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
  action: () => Promise<void>
  accept: (value: CloudMFAStatus) => void
  reload: () => Promise<CloudMFAStatus | undefined>
  onUncertain: () => void
  onClose: () => void
}

export function AccountStepUpDialog({ api, generation, mfa, unavailable, busy, title, description, danger, run, action, accept, reload, onUncertain, onClose }: Props) {
  const { t } = useTranslation()
  const [form] = Form.useForm<CloudMFAProof>()
  const feedback = useCloudOperationFeedback(api, generation, run)
  const policy = useRef({ enabled: mfa?.enabled, revision: mfa?.revision })
  useEffect(() => { policy.current = { enabled: mfa?.enabled, revision: mfa?.revision } }, [mfa?.enabled, mfa?.revision])
  const disabled = busy || feedback.working
  const { expired } = useCloudDeadline(mfa, mfa?.verified_until)
  const verified = Boolean(mfa?.verified_until && !expired)
  useEffect(() => () => { form.setFieldsValue({ password: undefined, code: undefined }) }, [generation, form])
  return <Modal open rootClassName={modalSurfaceStyles.root} title={title} footer={null} destroyOnHidden closable={!disabled} mask={{ closable: !disabled }} keyboard={!disabled} onCancel={onClose}>
    <p>{description}</p>
    <AccountOperationError code={feedback.errorCode} />
    <Form form={form} layout="vertical" requiredMark={false} onFinish={values => void feedback.perform(async current => {
      if (unavailable || !mfa || busy) return
      const startedPolicy = policy.current
      const currentPolicy = () => current() && policy.current === startedPolicy
      try {
        // 使用服务端确认的期限，过期时在同一弹窗补验；响应不明时只允许用户再次决定。
        const deadline = cloudDeadlineRemaining(mfa, mfa?.verified_until)
        if (!Number.isFinite(deadline) || deadline <= 0) {
          if (verified) throw new Error('reauthentication_required')
          const result = await api.reauthenticate(generation, buildCloudStepUpProof(mfa?.enabled, values))
          if (!current()) return
          // 因子在其他会话修改后，旧证明结果不能补写期限或继续当前操作。
          if (!currentPolicy()) throw new Error('mfa_revision_conflict')
          accept({ ...mfa, server_time: result.server_time, verified_until: result.verified_until })
        }
        if (!currentPolicy()) return
        await action()
        if (current()) onClose()
      } catch (cause) {
        if (currentPolicy() && cause instanceof Error && cause.message === 'reauthentication_required') accept({ ...mfa, verified_until: undefined })
        if (current() && isCloudMFAUncertainError(cause)) { await reload(); if (current()) onUncertain() }
        throw cause
      } finally { if (currentPolicy()) form.resetFields(['password']) }
    })}>
      {!verified ? <AccountStepUpFields enabled={mfa?.enabled} revision={mfa?.revision} disabled={disabled || unavailable} /> : null}
      <Button type="primary" danger={danger} htmlType="submit" loading={disabled} disabled={unavailable}>{t('cloud.mfa.continue')}</Button>
      {unavailable ? <Button type="link" disabled={disabled} onClick={() => void feedback.perform(async () => { await reload() })}>{t('cloud.retry')}</Button> : null}
    </Form>
  </Modal>
}

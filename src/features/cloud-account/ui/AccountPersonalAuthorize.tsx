import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, Modal } from 'antd'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudDevice, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { AccountOperationError } from './AccountOperationError'
import styles from './AccountSafeguards.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; devices: CloudDevice[]; enabled: boolean; busy: boolean; disabled: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined>; onChanged: () => void; outstanding?: CloudAuthorization }
export function AccountPersonalAuthorize({ api, status, devices, enabled, busy, disabled, run, onChanged, outstanding }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [cancelledId, setCancelledId] = useState<string>()
  const blocked = Boolean(outstanding && outstanding.id !== cancelledId)
  const [revokes, setRevokes] = useState<string[]>([])
  const [form] = Form.useForm<{ recovery_key: string }>()
  const feedback = useCloudOperationFeedback(api, status.generation, run)
  const inactive = busy || feedback.working
  useEffect(() => () => { if (form.getFieldInstance('recovery_key')) form.resetFields() }, [status.generation, form])
  const close = () => { feedback.reset(); setOpen(false); form.resetFields(); setRevokes([]) }
  const recover = async (key: string, current: () => boolean) => {
    try {
      const result = await api.recoverPersonal(status.generation, key, revokes)
      if (!current()) return
      if (!['completed', 'acknowledged'].includes(result.status)) throw new Error('CLOUD_RESPONSE_INVALID')
      close(); onChanged(); await api.status()
    } finally { if (current()) form.resetFields() }
  }
  return <>
    <Button icon={<KeyRound size={14} />} disabled={inactive || disabled || !enabled} onClick={() => { feedback.reset(); setOpen(true); setRevokes([]) }}>{t('cloud.safeguards.usePersonal')}</Button>
    <Modal open={open} title={t('cloud.safeguards.usePersonal')} footer={null} destroyOnHidden closable={!inactive} mask={{ closable: !inactive }} keyboard={!inactive} onCancel={close}>
      <div className={styles.wizard}>
        <Alert type="info" showIcon title={t('cloud.safeguards.personalAuthorizeHint')} description={t('cloud.safeguards.noAutoUpload')} />
        <AccountOperationError code={feedback.errorCode} />
        {blocked && outstanding ? <Alert type="warning" showIcon title={t('cloud.authorization.switchHint')} action={<Button disabled={inactive || !outstanding.allowed_actions.includes('cancel')} onClick={() => void feedback.perform(async current => { const result = await api.authorizationAction(status.generation, outstanding.kind, outstanding.id, 'cancel', { expected_revision: outstanding.revision }); if (current() && result.status === 'cancelled') { setCancelledId(result.id); onChanged() } })}>{t('cloud.safeguards.cancelPrevious')}</Button>} /> : null}
        <Form form={form} layout="vertical" onFinish={value => void feedback.perform(current => recover(value.recovery_key, current))}>
          <Form.Item name="recovery_key" label={t('cloud.safeguards.personalTitle')} rules={[{ required: true }]}><Input.TextArea autoComplete="off" spellCheck={false} autoFocus rows={3} placeholder="TRK1-…" disabled={inactive || blocked} maxLength={256} /></Form.Item>
          {devices.some(device => device.status === 'active') ? <Form.Item label={t('cloud.safeguards.replaceDevices')} extra={t('cloud.safeguards.replaceDevicesHint')}><Checkbox.Group disabled={inactive || blocked} value={revokes} onChange={values => setRevokes(values as string[])} options={devices.filter(device => device.status === 'active').map(device => ({ label: device.name, value: device.id }))} /></Form.Item> : null}
          <div className={styles.actions}><Button type="primary" htmlType="submit" loading={inactive} disabled={blocked}>{t('cloud.safeguards.recover')}</Button><Button disabled={inactive || blocked} onClick={() => void feedback.perform(current => recover('', current))}>{t('cloud.safeguards.resumeOperation')}</Button></div>
        </Form>
        <Button disabled={inactive} onClick={() => void feedback.perform(async current => { await api.cancelPersonalRecovery(status.generation, 'recover', 'current'); if (current()) onChanged() })}>{t('cloud.safeguards.cancelPrevious')}</Button>
      </div>
    </Modal>
  </>
}

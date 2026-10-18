import { useEffect, useId, useRef, useState } from 'react'
import { Button, Form, Input, Modal, Tooltip, type InputRef } from 'antd'
import { Check, CircleAlert, Laptop, Pencil, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudDevice } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import styles from './AccountDeviceName.module.scss'

interface Props {
  api: CloudGateway
  generation: string
  device: CloudDevice
  busy: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
  onChanged: () => void
}

export function AccountDeviceName({ api, generation, device, busy, run, onChanged }: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<CloudDevice>()
  const [form] = Form.useForm<{ name: string }>()
  const formId = useId()
  const draft = Form.useWatch('name', form) ?? ''
  const input = useRef<InputRef>(null)
  const feedback = useCloudOperationFeedback(api, generation, run)
  const currentDevice = () => {
    const status = api.getStatus()
    return status?.generation === generation && status.authenticated && status.device_id === device.id
      && (status.device_status === 'active' || status.device_status === 'pending')
  }
  const editable = currentDevice()
    && device.name_revision !== undefined && (device.status === 'active' || device.status === 'pending')
  const inactive = busy || feedback.working
  const unchanged = draft.trim() === editing?.name
  useEffect(() => { setEditing(undefined); form.resetFields() }, [api, generation, device.id, form])
  useEffect(() => { if (!editable) setEditing(undefined) }, [editable])
  const load = () => { if (editable) { feedback.reset(); setEditing(device); form.setFieldsValue({ name: device.name }) } }
  const close = () => { if (!inactive) { feedback.reset(); setEditing(undefined) } }
  const reload = () => {
    if (inactive || !editable) return
    void feedback.perform(async current => {
      const latest = (await api.devices()).find(value => value.id === device.id)
      if (!current() || !currentDevice()) return
      if (!latest || latest.name_revision === undefined || (latest.status !== 'active' && latest.status !== 'pending')) throw new Error('CLOUD_RESPONSE_INVALID')
      setEditing(latest)
      form.setFieldsValue({ name: latest.name })
    })
  }
  const save = ({ name }: { name: string }) => {
    if (!editing || inactive || !editable || unchanged || editing.name_revision === undefined) return
    void feedback.perform(async current => {
      try {
        await api.updateDeviceName(generation, name.trim(), editing.name_revision!)
        if (current()) setEditing(undefined)
      } finally {
        // 失败也可能已提交，补读权威列表；编辑草稿及其原始版本保持不变。
        if (current()) onChanged()
      }
    })
  }
  return <>
    <div className={styles.identity}>
      <Tooltip title={device.name}><strong className={styles.name}>{device.name}</strong></Tooltip>
      <Tooltip title={t('cloud.deviceName.edit')}>
        <Button className={styles.trigger} type="text" icon={<Pencil size={13} aria-hidden="true" />} aria-label={t('cloud.deviceName.edit')} disabled={inactive || !editable} onClick={load} />
      </Tooltip>
    </div>
    <Modal forceRender centered width={440} className={styles.modal} open={Boolean(editing)} afterOpenChange={open => { if (open) input.current?.focus({ cursor: 'all' }) }}
      title={<div className={styles.heading}>
        <span className={styles.glyph} aria-hidden="true"><Laptop size={23} strokeWidth={1.6} /></span>
        <div className={styles['heading-copy']}><h2>{t('cloud.deviceName.title')}</h2><p title={editing?.name}>{editing?.name}</p></div>
      </div>}
      closable={!inactive} mask={{ closable: !inactive }} keyboard={!inactive} onCancel={close}
      footer={<div className={styles.footer}>
        <Button type="text" disabled={inactive} onClick={close}>{t('cloud.deviceName.cancel')}</Button>
        <Button type="primary" icon={<Check size={15} aria-hidden="true" />} loading={feedback.working} disabled={inactive || unchanged} onClick={() => form.submit()}>{t('cloud.deviceName.save')}</Button>
      </div>}>
      <Form className={styles.form} name={formId} form={form} layout="vertical" requiredMark={false} onFinish={save} disabled={inactive}>
        <Form.Item name="name" label={<span className={styles.label}><span>{t('cloud.deviceName.label')}</span><span className={styles.count} data-invalid={[...draft.trim()].length > 100}>{[...draft.trim()].length}<span> / 100</span></span></span>} rules={[{ validator: async (_, value: string) => {
          const name = value?.trim() ?? ''
          if (!name || [...name].length > 100 || /\p{Cc}/u.test(value)) throw new Error(t('cloud.deviceName.invalid'))
        } }]}>
          <Input ref={input} aria-label={t('cloud.deviceName.label')} size="large" autoComplete="off" spellCheck={false} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
        </Form.Item>
        {feedback.errorCode ? <div className={styles.error} role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <div><p>{t(`cloud.errors.${feedback.errorCode}`, { defaultValue: t('cloud.operationFailed') })}</p><Button type="link" size="small" disabled={inactive} icon={<RefreshCw size={12} aria-hidden="true" />} onClick={reload}>{t('cloud.deviceName.reload')}</Button></div>
        </div> : null}
      </Form>
    </Modal>
  </>
}

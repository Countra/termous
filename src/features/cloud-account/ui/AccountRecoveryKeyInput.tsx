import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input } from 'antd'
import { FileKey, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CLOUD_PERSONAL_KEY_FILE_EXTENSION, type CloudRecoveryCredential } from '#common/contracts'
import { readRecoveryKeyFile } from '../model/recoveryKeyFile'
import { cloudOperationErrorCode } from '../model/useCloudOperationFeedback'
import styles from './AccountSafeguards.module.scss'

interface Props { disabled: boolean; onRecover: (credential: CloudRecoveryCredential) => Promise<void> }

export function AccountRecoveryKeyInput({ disabled, onRecover }: Props) {
  const { t, i18n } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const life = useRef<{ active: boolean; pending: boolean; reader?: AbortController } | null>(null)
  const unavailable = useRef(disabled)
  const [processing, setProcessing] = useState<'file' | 'text'>()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string>()
  const [manual, setManual] = useState(false)
  const [form] = Form.useForm<{ recovery_key: string }>()
  useEffect(() => {
    const scope: NonNullable<typeof life.current> = { active: true, pending: false }; life.current = scope
    return () => { scope.active = false; scope.reader?.abort(); form.resetFields() }
  }, [form])
  useLayoutEffect(() => {
    unavailable.current = disabled
    // 读取期间发生其他操作时取消尚未提交的文件；已经发出的恢复请求由父级管理。
    if (disabled) life.current?.reader?.abort()
  }, [disabled])
  const accept = async (files: File[]) => {
    const scope = life.current
    if (disabled || !scope?.active || scope.pending) return
    setDragging(false); setError(undefined); form.resetFields()
    if (files.length !== 1) { setError('CLOUD_PERSONAL_FILE_INVALID'); return }
    const reader = new AbortController()
    scope.reader = reader; scope.pending = true; setProcessing('file')
    try {
      const content = await readRecoveryKeyFile(files[0], reader.signal)
      scope.reader = undefined
      if (scope.active && !reader.signal.aborted && !unavailable.current) await onRecover({ recovery_file: content })
    } catch (cause) {
      if (scope.active && !reader.signal.aborted) setError(cloudOperationErrorCode(cause, code => i18n.exists(`cloud.errors.${code}`)))
    } finally { scope.reader = undefined; scope.pending = false; if (scope.active) setProcessing(undefined) }
  }
  const reading = processing === 'file'
  const blocked = disabled || processing !== undefined
  return <div className={styles['key-import']}>
    <input ref={input} type="file" accept={CLOUD_PERSONAL_KEY_FILE_EXTENSION} disabled={blocked} hidden aria-label={t('cloud.safeguards.chooseKeyFile')} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void accept(files) }} />
    <button type="button" className={`${styles['key-drop']} ${dragging ? styles.dragging : ''}`} disabled={blocked} onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); if (!blocked) { event.dataTransfer.dropEffect = 'copy'; setDragging(true) } }}
      onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void accept(Array.from(event.dataTransfer.files)) }}>
      {reading ? <LoaderCircle size={28} aria-hidden /> : <FileKey size={28} aria-hidden />}
      <strong>{t(reading ? 'cloud.safeguards.checkingKeyFile' : 'cloud.safeguards.chooseKeyFile')}</strong>
      <span>{t('cloud.safeguards.dropKeyFile')}</span>
    </button>
    {error ? <Alert type="error" showIcon title={t(`cloud.errors.${error}`)} /> : null}
    <Button type="link" className={styles['key-manual']} disabled={blocked} onClick={() => { if (manual) form.resetFields(); setManual(value => !value) }}>{t('cloud.safeguards.pasteLegacyKey')}</Button>
    <Form form={form} layout="vertical" hidden={!manual} onFinish={async value => {
      const scope = life.current
      if (blocked || !scope?.active || scope.pending) return
      scope.pending = true; setProcessing('text'); setError(undefined)
      try { await onRecover({ recovery_key: value.recovery_key }) }
      catch (cause) { if (scope.active) setError(cloudOperationErrorCode(cause, code => i18n.exists(`cloud.errors.${code}`))) }
      finally { scope.pending = false; if (scope.active) { form.resetFields(); setProcessing(undefined) } }
    }}>
      {manual ? <>
      <Form.Item name="recovery_key" label={t('cloud.safeguards.personalTitle')} rules={[{ required: true }]}><Input.TextArea rows={3} autoComplete="off" spellCheck={false} maxLength={256} placeholder="TRK1-…" disabled={blocked} /></Form.Item>
      <Button type="primary" htmlType="submit" disabled={blocked} loading={processing === 'text'}>{t('cloud.safeguards.checkKey')}</Button>
      </> : null}
    </Form>
  </div>
}

import { FeedbackMessage } from '#shared/ui'
import { useEffect } from 'react'
import { Form, Input } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudMFAProof } from '#common/contracts'
import { AccountMFAFields } from './AccountMFAFields'

interface Props { enabled: boolean | undefined; revision?: string; disabled?: boolean; totpOnly?: boolean; autoFocus?: boolean }

export function AccountStepUpFields({ enabled, revision, disabled, totpOnly = false, autoFocus = true }: Props) {
  const { t } = useTranslation()
  const form = Form.useFormInstance<CloudMFAProof>()
  const method = Form.useWatch('method', { form, preserve: true }) === 'backup_code' && !totpOnly ? 'backup_code' : 'totp'
  useEffect(() => {
    // 身份策略或步骤变化立即移除旧证明；读取失败不降级到密码验证。
    form.setFieldsValue({ password: undefined, code: undefined, method: 'totp' })
    return () => form.setFieldsValue({ password: undefined, code: undefined, method: undefined })
  }, [enabled, revision, totpOnly, form])
  if (enabled === undefined || totpOnly && !enabled) return <FeedbackMessage type="warning" title={t('cloud.mfa.loadFailed')} />
  return enabled ? <>
    <Form.Item name="method" hidden><Input /></Form.Item>
    <AccountMFAFields method={method} methods={totpOnly ? ['totp'] : undefined} disabled={disabled} autoFocus={autoFocus} onMethodChange={next => form.setFieldsValue({ method: next, code: undefined })} />
  </> : <Form.Item name="password" label={t('cloud.password')} rules={[{ required: true, message: t('cloud.passwordRequired') }]} preserve={false}>
    <Input.Password autoComplete="current-password" disabled={disabled} autoFocus={autoFocus} />
  </Form.Item>
}

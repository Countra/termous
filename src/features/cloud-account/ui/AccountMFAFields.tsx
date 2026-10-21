import { useEffect, useLayoutEffect, useRef } from 'react'
import { Button, Form, Input } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudMFAMethod } from '#common/contracts'
import { AccountTOTPInput } from './AccountTOTPInput'
import styles from './AccountMFA.module.scss'

interface Props { method: CloudMFAMethod; onMethodChange: (method: CloudMFAMethod) => void; disabled?: boolean; methods?: CloudMFAMethod[]; autoFocus?: boolean; autoSubmit?: boolean; gap?: number }

export function AccountMFAFields({ method, onMethodChange, disabled, methods = ['totp', 'backup_code'], autoFocus, autoSubmit = true, gap }: Props) {
  const { t } = useTranslation()
  const form = Form.useFormInstance()
  const root = useRef<HTMLDivElement>(null)
  const attempted = useRef(false)
  const queued = useRef(false)
  const active = useRef(false)
  useLayoutEffect(() => {
    if (disabled || !autoSubmit || method !== 'totp') queued.current = false
  }, [disabled, autoSubmit, method])
  useEffect(() => {
    active.current = true
    const element = root.current?.closest('form')
    const manualSubmit = () => { queued.current = false; attempted.current = true }
    // 原生提交优先，避免填满后紧接着按回车或点击按钮造成双重提交。
    element?.addEventListener('submit', manualSubmit, true)
    return () => { active.current = false; element?.removeEventListener('submit', manualSubmit, true) }
  }, [])
  const totp = method === 'totp'
  return <div ref={root} className={styles['factor-fields']}>
    <Form.Item name="code" label={t(totp ? 'cloud.mfa.code' : 'cloud.mfa.backupCode')} validateFirst validateTrigger={[]} rules={[{ required: true, message: t(totp ? 'cloud.mfa.codeRequired' : 'cloud.mfa.backupCodeRequired') }, { validator: async (_, value: string) => {
      if (value && totp && !/^[0-9]{6}$/.test(value)) throw new Error(t('cloud.mfa.codeRule'))
    } }]}>
      {totp ? <AccountTOTPInput gap={gap} disabled={disabled} autoFocus={autoFocus} onComplete={code => {
        if (disabled || !autoSubmit || attempted.current) return
        attempted.current = true; queued.current = true
        // 等待表单收集当前输入；同一验证步骤只自动提交一次，失败或编辑均不重放。
        queueMicrotask(() => {
          if (!queued.current) return
          queued.current = false
          if (active.current && form.getFieldValue('code') === code) form.submit()
        })
      }} /> : <Input autoComplete="off" maxLength={128} placeholder={t('cloud.mfa.backupCodePlaceholder')} disabled={disabled} spellCheck={false} autoFocus={autoFocus} />}
    </Form.Item>
    {methods.length > 1 ? <Button type="link" size="small" disabled={disabled} onClick={() => onMethodChange(totp ? 'backup_code' : 'totp')}>{t(totp ? 'cloud.mfa.useBackupCode' : 'cloud.mfa.useAuthenticator')}</Button> : null}
  </div>
}

import { Button, Form, Input } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudMFAMethod } from '#common/contracts'
import styles from './AccountMFA.module.scss'

interface Props { method: CloudMFAMethod; onMethodChange: (method: CloudMFAMethod) => void; disabled?: boolean; methods?: CloudMFAMethod[] }

export function AccountMFAFields({ method, onMethodChange, disabled, methods = ['totp', 'backup_code'] }: Props) {
  const { t } = useTranslation()
  const totp = method === 'totp'
  return <div className={styles['factor-fields']}>
    <Form.Item name="code" label={t(totp ? 'cloud.mfa.code' : 'cloud.mfa.backupCode')} rules={[{ required: true, message: t('cloud.mfa.codeRequired') }, { validator: async (_, value: string) => {
      if (value && totp && !/^[0-9]{6}$/.test(value)) throw new Error(t('cloud.mfa.codeRule'))
    } }]}>
      <Input autoComplete={totp ? 'one-time-code' : 'off'} inputMode={totp ? 'numeric' : 'text'} maxLength={totp ? 6 : 128} placeholder={t(totp ? 'cloud.mfa.codePlaceholder' : 'cloud.mfa.backupCodePlaceholder')} disabled={disabled} spellCheck={false} />
    </Form.Item>
    {methods.length > 1 ? <Button type="link" size="small" disabled={disabled} onClick={() => onMethodChange(totp ? 'backup_code' : 'totp')}>{t(totp ? 'cloud.mfa.useBackupCode' : 'cloud.mfa.useAuthenticator')}</Button> : null}
  </div>
}

import type { ReactNode } from 'react'
import { Form, Input } from 'antd'
import { CircleHelp, LockKeyhole, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthAction } from '#common/contracts'
import styles from './AccountAuthFields.module.scss'

export type AccountAuthMode = 'login' | CloudAuthAction
export interface AccountAuthValues { email: string; password: string; confirmPassword: string; token: string }

export function AccountAuthFields({ mode, reauthenticate, passwordAction }: { mode: AccountAuthMode; reauthenticate: boolean; passwordAction?: ReactNode }) {
  const { t } = useTranslation()
  const newPassword = mode === 'register' || mode === 'password-reset/confirm'
  return <div className={styles.fields}>
    {['login', 'register', 'resend-verification', 'password-reset/request'].includes(mode) ? <Form.Item name="email" label={t('cloud.email')} validateFirst rules={[
      { required: true, whitespace: true, message: t('cloud.login.emailRequired') },
      { type: 'email', message: t('cloud.login.emailInvalid') },
    ]}><Input size="large" prefix={<Mail size={16} aria-hidden="true" />} placeholder={t('cloud.login.emailPlaceholder')} autoComplete={mode === 'login' ? 'username' : 'email'} readOnly={reauthenticate} maxLength={320} spellCheck={false} /></Form.Item> : null}
    {mode === 'login' || newPassword ? <div className={styles.password}><Form.Item name="password" label={t('cloud.password')} validateFirst tooltip={newPassword ? { title: t('cloud.passwordRule'), icon: <CircleHelp size={13} aria-hidden="true" /> } : undefined} rules={[
      { required: true, message: t('cloud.passwordRequired') },
      { validator: async (_: unknown, value: string) => {
        const size = new TextEncoder().encode(value).length
        if (size < 12 || size > 256) throw new Error(t('cloud.passwordRule'))
      } },
    ]}><Input.Password size="large" prefix={<LockKeyhole size={16} aria-hidden="true" />} placeholder={t(mode === 'login' ? 'cloud.login.passwordPlaceholder' : 'cloud.login.newPasswordPlaceholder')} autoComplete={newPassword ? 'new-password' : 'current-password'} /></Form.Item>
      {passwordAction ? <div className={styles['password-action']}>{passwordAction}</div> : null}
    </div> : null}
    {newPassword ? <Form.Item name="confirmPassword" label={t('cloud.login.confirmPassword')} dependencies={['password']} validateFirst rules={[
      { required: true, message: t('cloud.login.confirmRequired') },
      ({ getFieldValue }) => ({ validator: async (_, value: string) => {
        if (value !== getFieldValue('password')) throw new Error(t('cloud.login.passwordMismatch'))
      } }),
    ]}><Input.Password size="large" prefix={<LockKeyhole size={16} aria-hidden="true" />} placeholder={t('cloud.login.confirmPlaceholder')} autoComplete="new-password" /></Form.Item> : null}
    {['verify-email', 'password-reset/confirm'].includes(mode) ? <Form.Item name="token" label={t('cloud.verificationCode')} rules={[{ required: true, whitespace: true, message: t('cloud.login.tokenRequired') }]}><Input.TextArea rows={2} placeholder={t('cloud.login.tokenPlaceholder')} autoComplete="one-time-code" maxLength={2048} spellCheck={false} /></Form.Item> : null}
  </div>
}

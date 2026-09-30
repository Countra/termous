import { useState } from 'react'
import { Alert, Button, Form, Input } from 'antd'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import type { CloudAuthAction } from '#common/contracts'
import styles from './CloudAccount.module.scss'

interface Props {
  api: CloudGateway
  generation: string
  busy: boolean
  email?: string
  reauthenticate?: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
}

type AuthMode = 'login' | Exclude<CloudAuthAction, 'reauthenticate'>
const relatedModes: Record<AuthMode, AuthMode[]> = {
  login: ['register', 'password-reset/request', 'verify-email'],
  register: ['verify-email', 'resend-verification'],
  'verify-email': ['resend-verification'],
  'resend-verification': ['verify-email'],
  'password-reset/request': ['password-reset/confirm'],
  'password-reset/confirm': ['password-reset/request'],
}

export function AccountAuth({ api, generation, busy, run, email: savedEmail, reauthenticate = false }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AuthMode>('login')
  const [notice, setNotice] = useState(false)
  const [form] = Form.useForm<{ email: string; password: string; token: string }>()
  const password = ['login', 'register', 'password-reset/confirm'].includes(mode)
  const email = ['login', 'register', 'resend-verification', 'password-reset/request'].includes(mode)
  const changeMode = (next: typeof mode) => { setMode(next); setNotice(false); form.resetFields(['password', 'token']) }

  return <section className={styles.auth}>
    {!reauthenticate && mode !== 'login' ? <Button className={styles.back} type="text" size="small" icon={<ArrowLeft size={14} />} disabled={busy} onClick={() => changeMode('login')}>{t('cloud.backToLogin')}</Button> : null}
    {!reauthenticate ? <div className={styles.intro}>
      <h2>{mode === 'login' ? t('cloud.welcome') : t(`cloud.auth.${mode}`)}</h2>
      <p>{mode === 'login' ? t('cloud.welcomeHint') : t(`cloud.authHints.${mode}`)}</p>
    </div> : <p>{t('cloud.reconnectHint')}</p>}
    {notice ? <Alert type="success" showIcon title={t('cloud.authSent')} /> : null}
    <Form name={reauthenticate ? 'cloud-reauth' : 'cloud-auth'} form={form} initialValues={{ email: savedEmail }} layout="vertical" disabled={busy} requiredMark={false} onFinish={(values) => {
      void run(async () => {
        if (mode === 'login') await api.login(generation, values.email, values.password)
        else { await api.auth(mode, { generation, ...values }); setNotice(true) }
        form.resetFields(['password', 'token'])
      })
    }}>
      {email ? <Form.Item name="email" label={t('cloud.email')} rules={[{ required: true }, { type: 'email' }]}><Input autoComplete="username" readOnly={reauthenticate} maxLength={320} /></Form.Item> : null}
      {password ? <Form.Item name="password" label={t('cloud.password')} extra={mode !== 'login' ? t('cloud.passwordRule') : undefined} rules={[{ required: true }, {
        validator: async (_, value: string) => {
          const size = new TextEncoder().encode(value ?? '').length
          if (size < 12 || size > 256) throw new Error(t('cloud.passwordRule'))
        },
      }]}><Input.Password autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Form.Item> : null}
      {['verify-email', 'password-reset/confirm'].includes(mode) ? <Form.Item name="token" label={t('cloud.verificationCode')} rules={[{ required: true }]}><Input autoComplete="one-time-code" maxLength={2048} /></Form.Item> : null}
      <Button block type="primary" htmlType="submit" loading={busy}>{t(`cloud.auth.${mode}`)}</Button>
    </Form>
    {!reauthenticate ? <nav className={styles['auth-links']} aria-label={t('cloud.authOptions')}>
      {relatedModes[mode].map((value) =>
        <Button key={value} type="link" size="small" disabled={busy} onClick={() => changeMode(value)}>{t(`cloud.auth.${value}`)}</Button>,
      )}
    </nav> : null}
  </section>
}

import { useState } from 'react'
import { Alert, Button, Form, Input, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import type { CloudAuthAction } from '#common/contracts'
import styles from './CloudAccount.module.scss'

interface Props {
  api: CloudGateway
  generation: string
  busy: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
}

export function AccountAuth({ api, generation, busy, run }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'login' | CloudAuthAction>('login')
  const [notice, setNotice] = useState(false)
  const [form] = Form.useForm<{ email: string; password: string; token: string }>()
  const password = ['login', 'register', 'password-reset/confirm'].includes(mode)
  const email = ['login', 'register', 'resend-verification', 'password-reset/request'].includes(mode)
  const changeMode = (next: typeof mode) => { setMode(next); setNotice(false); form.resetFields(['password', 'token']) }

  return <section className={styles.auth}>
    <div className={styles.intro}>
      <h2>{t('cloud.welcome')}</h2>
      <p>{t('cloud.welcomeHint')}</p>
    </div>
    {notice ? <Alert type="success" showIcon title={t('cloud.authSent')} /> : null}
    <Form form={form} layout="vertical" disabled={busy} requiredMark={false} onFinish={(values) => {
      void run(async () => {
        if (mode === 'login') await api.login(generation, values.email, values.password)
        else { await api.auth(mode, { generation, ...values }); setNotice(true) }
        form.resetFields(['password', 'token'])
      })
    }}>
      {email ? <Form.Item name="email" label={t('cloud.email')} rules={[{ required: true }, { type: 'email' }]}><Input autoComplete="username" maxLength={320} /></Form.Item> : null}
      {password ? <Form.Item name="password" label={t('cloud.password')} rules={[{ required: true }, {
        validator: async (_, value: string) => {
          const size = new TextEncoder().encode(value ?? '').length
          if (size < 12 || size > 256) throw new Error(t('cloud.passwordRule'))
        },
      }]}><Input.Password autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Form.Item> : null}
      {['verify-email', 'password-reset/confirm'].includes(mode) ? <Form.Item name="token" label={t('cloud.verificationCode')} rules={[{ required: true }]}><Input autoComplete="one-time-code" maxLength={2048} /></Form.Item> : null}
      <Button block type="primary" htmlType="submit" loading={busy}>{t(`cloud.auth.${mode}`)}</Button>
    </Form>
    <Space wrap size="small">
      {(mode === 'login' ? ['register', 'password-reset/request', 'verify-email'] as const : ['login', 'register', 'verify-email', 'resend-verification', 'password-reset/request', 'password-reset/confirm'] as const).filter((value) => value !== mode).map((value) =>
        <Button key={value} type="link" size="small" disabled={busy} onClick={() => changeMode(value)}>{t(`cloud.auth.${value}`)}</Button>,
      )}
    </Space>
  </section>
}

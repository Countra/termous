import { FeedbackMessage } from '#shared/ui'
import { useEffect, useRef, useState } from 'react'
import { Button, Form, Input, Segmented } from 'antd'
import { ArrowLeft, Cloud, KeyRound, LockKeyhole, Mail, MailCheck, QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import type { CloudAuthAction, CloudLoginChallenge, CloudLoginResult, CloudMFAMethod } from '#common/contracts'
import { isCloudMFAUncertainError } from '#entities/cloud'
import { useCloudDeadline } from '../model/useCloudDeadline'
import { AccountMFAFields } from './AccountMFAFields'
import { AccountQRLogin } from './AccountQRLogin'
import styles from './AccountAuth.module.scss'

interface Props {
  api: CloudGateway
  generation: string
  busy: boolean
  email?: string
  reauthenticate?: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
}

type AuthMode = 'login' | CloudAuthAction
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
  const [loginMethod, setLoginMethod] = useState<'password' | 'qr'>('password')
  const [notice, setNotice] = useState(false)
  const [challenge, setChallenge] = useState<CloudLoginChallenge>()
  const [method, setMethod] = useState<CloudMFAMethod>('totp')
  const [uncertain, setUncertain] = useState(false)
  const [challengeFailure, setChallengeFailure] = useState<string>()
  const [form] = Form.useForm<{ email: string; password: string; token: string }>()
  const [verificationForm] = Form.useForm<{ code: string }>()
  const lifetime = useRef<{ api: CloudGateway; generation: string; active: boolean } | null>(null)
  useEffect(() => {
    const scope = { api, generation, active: true }
    lifetime.current = scope
    setChallenge(undefined); setUncertain(false); setChallengeFailure(undefined); form.resetFields(['password', 'token'])
    return () => { scope.active = false }
  }, [api, generation, form])
  const current = (scope: typeof lifetime.current) => {
    const snapshot = api.getStatus?.()
    return scope?.active && scope.api === api && scope.generation === generation && (!snapshot || snapshot.generation === generation)
  }
  const accept = (result: CloudLoginResult) => {
    if (result.state === 'mfa_required') {
      setChallenge(result.challenge); setMethod(result.challenge.methods.includes('totp') ? 'totp' : 'backup_code'); setUncertain(false); setChallengeFailure(undefined)
    } else setChallenge(undefined)
    form.resetFields(['password', 'token'])
    if (challenge) verificationForm.resetFields()
  }
  const { expired } = useCloudDeadline(challenge, challenge?.expires_at)
  const blocked = expired || uncertain || Boolean(challengeFailure)
  const password = ['login', 'register', 'password-reset/confirm'].includes(mode)
  const email = ['login', 'register', 'resend-verification', 'password-reset/request'].includes(mode)
  const changeMode = (next: typeof mode) => { setMode(next); setNotice(false); setChallenge(undefined); setUncertain(false); setChallengeFailure(undefined); form.resetFields(['password', 'token']) }

  if (challenge) return <section className={styles.auth}>
    <Button className={styles.back} type="text" size="small" icon={<ArrowLeft size={14} />} disabled={busy} onClick={() => {
      const id = challenge.id
      changeMode('login')
      void run(() => api.cancelLogin(generation, id))
    }}>{t('cloud.backToLogin')}</Button>
    <div className={styles.intro}><h2>{t('cloud.mfa.loginTitle')}</h2><p>{t('cloud.mfa.loginHint')}</p></div>
    {blocked ? <FeedbackMessage type="warning" title={t(challengeFailure ? `cloud.errors.${challengeFailure}` : expired ? 'cloud.mfa.challengeExpired' : 'cloud.mfa.loginUncertain')} /> : null}
    {/* 验证表单按挑战挂载，卸载时清除验证码，避免访问尚未连接的表单实例。 */}
    <Form className={styles.form} key="mfa-login" name="cloud-mfa-login" form={verificationForm} clearOnDestroy layout="vertical" requiredMark={false} disabled={busy || blocked} onFinish={(values) => {
      const scope = lifetime.current
      void run(async () => {
        try {
          const result = await api.verifyLogin(generation, challenge.id, method, values.code)
          if (current(scope)) accept(result)
        } catch (cause) {
          if (current(scope) && isCloudMFAUncertainError(cause)) { setUncertain(true); verificationForm.resetFields() }
          else if (current(scope) && cause instanceof Error && ['mfa_challenge_expired', 'mfa_challenge_exhausted'].includes(cause.message)) { setChallengeFailure(cause.message); verificationForm.resetFields() }
          throw cause
        }
      })
    }}>
      <AccountMFAFields method={method} methods={challenge.methods} disabled={busy || blocked} onMethodChange={(value) => { setMethod(value); verificationForm.resetFields() }} />
      <Button block size="large" type="primary" htmlType="submit" loading={busy} disabled={blocked}>{t('cloud.mfa.verifyAndLogin')}</Button>
    </Form>
  </section>

  const methodSwitch = mode === 'login' ? <Segmented className={styles.methods} block value={loginMethod} disabled={busy} options={[
    { value: 'password', label: <span className={styles['method-label']}><KeyRound size={14} aria-hidden="true" />{t('cloud.qr.password')}</span> },
    { value: 'qr', label: <span className={styles['method-label']}><QrCode size={14} aria-hidden="true" />{t('cloud.qr.login')}</span> },
  ]} onChange={value => { form.resetFields(['password', 'token']); setLoginMethod(value === 'qr' ? 'qr' : 'password') }} /> : null

  return <section className={styles.auth}>
    {!reauthenticate && mode !== 'login' ? <Button className={styles.back} type="text" size="small" icon={<ArrowLeft size={14} />} disabled={busy} onClick={() => changeMode('login')}>{t('cloud.backToLogin')}</Button> : null}
    {!reauthenticate ? <div className={styles.intro}>
      <h2>{mode === 'login' ? t('cloud.welcome') : t(`cloud.auth.${mode}`)}</h2>
      <p>{mode === 'login' ? t('cloud.welcomeHint') : t(`cloud.authHints.${mode}`)}</p>
    </div> : <div className={styles.reconnect}>
      <span className={styles['reconnect-icon']}><Cloud size={20} aria-hidden="true" /></span>
      <div><h3>{t('cloud.login.reconnectTitle')}</h3><p>{t('cloud.login.reconnectHint')}</p></div>
    </div>}
    {methodSwitch}
    {mode === 'login' && loginMethod === 'qr' ? <AccountQRLogin api={api} generation={generation} reauthenticate={reauthenticate} /> : <>
      {notice ? <FeedbackMessage type="success" title={t('cloud.authSent')} /> : null}
      <Form className={styles.form} key="password-auth" name={reauthenticate ? 'cloud-reauth' : 'cloud-auth'} form={form} initialValues={{ email: savedEmail }} layout="vertical" disabled={busy} requiredMark={false} onFinish={(values) => {
        void run(async () => {
          const scope = lifetime.current
          if (mode === 'login') {
            const result = await api.login(generation, values.email, values.password)
            if (current(scope)) accept(result)
          } else {
            await api.auth(mode, { generation, ...values })
            if (current(scope)) { setNotice(true); form.resetFields(['password', 'token']) }
          }
        })
      }}>
        {email ? <Form.Item name="email" label={t('cloud.email')} rules={[{ required: true }, { type: 'email' }]}><Input size="large" prefix={<Mail size={15} aria-hidden="true" />} placeholder={t('cloud.login.emailPlaceholder')} autoComplete="username" readOnly={reauthenticate} maxLength={320} /></Form.Item> : null}
        {password ? <Form.Item name="password" label={t('cloud.password')} extra={mode !== 'login' ? t('cloud.passwordRule') : undefined} rules={[{ required: true }, {
          validator: async (_, value: string) => {
            const size = new TextEncoder().encode(value ?? '').length
            if (size < 12 || size > 256) throw new Error(t('cloud.passwordRule'))
          },
        }]}><Input.Password size="large" prefix={<LockKeyhole size={15} aria-hidden="true" />} placeholder={t(mode === 'login' ? 'cloud.login.passwordPlaceholder' : 'cloud.login.newPasswordPlaceholder')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Form.Item> : null}
        {['verify-email', 'password-reset/confirm'].includes(mode) ? <Form.Item name="token" label={t('cloud.verificationCode')} rules={[{ required: true }]}><Input size="large" prefix={<MailCheck size={15} aria-hidden="true" />} autoComplete="one-time-code" maxLength={2048} /></Form.Item> : null}
        <Button block size="large" type="primary" htmlType="submit" loading={busy}>{t(`cloud.auth.${mode}`)}</Button>
      </Form>
    </>}
    {!reauthenticate ? <nav className={styles['auth-links']} aria-label={t('cloud.authOptions')}>
      {relatedModes[mode].map((value) =>
        <Button key={value} type="link" size="small" disabled={busy} onClick={() => changeMode(value)}>{t(`cloud.auth.${value}`)}</Button>,
      )}
    </nav> : null}
  </section>
}

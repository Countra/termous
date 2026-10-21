import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Segmented } from 'antd'
import { ArrowLeft, CircleCheck, Cloud, KeyRound, QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import type { CloudLoginChallenge, CloudLoginResult, CloudMFAMethod } from '#common/contracts'
import { isCloudMFAUncertainError } from '#entities/cloud'
import { useCloudDeadline } from '../model/useCloudDeadline'
import { AccountMFAFields } from './AccountMFAFields'
import { AccountQRLogin } from './AccountQRLogin'
import { AccountAuthFields, type AccountAuthMode, type AccountAuthValues } from './AccountAuthFields'
import { useAccountAuthMotion } from './useAccountAuthMotion'
import styles from './AccountAuth.module.scss'

interface Props {
  api: CloudGateway
  generation: string
  busy: boolean
  email?: string
  reauthenticate?: boolean
  error?: string
  onClearError?: () => void
  onViewChange?: () => void
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
}

const relatedModes: Record<AccountAuthMode, AccountAuthMode[]> = {
  login: ['register', 'verify-email'],
  register: ['verify-email', 'resend-verification'],
  'verify-email': ['resend-verification'],
  'resend-verification': ['verify-email'],
  'password-reset/request': ['password-reset/confirm'],
  'password-reset/confirm': ['password-reset/request'],
}

export function AccountAuth({ api, generation, busy, run, email: savedEmail, reauthenticate = false, error, onClearError, onViewChange }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AccountAuthMode>('login')
  const [loginMethod, setLoginMethod] = useState<'password' | 'qr'>('password')
  const [notice, setNotice] = useState<AccountAuthMode>()
  const [challenge, setChallenge] = useState<CloudLoginChallenge>()
  const [method, setMethod] = useState<CloudMFAMethod>('totp')
  const [uncertain, setUncertain] = useState(false)
  const [challengeFailure, setChallengeFailure] = useState<string>()
  const [form] = Form.useForm<AccountAuthValues>()
  const [verificationForm] = Form.useForm<{ code: string }>()
  const lifetime = useRef<{ api: CloudGateway; generation: string; active: boolean } | null>(null)
  useEffect(() => {
    const scope = { api, generation, active: true }
    lifetime.current = scope
    setChallenge(undefined); setUncertain(false); setChallengeFailure(undefined); setNotice(undefined); form.resetFields(['password', 'confirmPassword', 'token'])
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
    form.resetFields(['password', 'confirmPassword', 'token'])
    if (challenge) verificationForm.resetFields()
  }
  const { expired } = useCloudDeadline(challenge, challenge?.expires_at)
  const blocked = expired || uncertain || Boolean(challengeFailure)
  const changeMode = (next: typeof mode) => {
    if (busy) return
    setMode(next); setLoginMethod('password'); setNotice(undefined); setChallenge(undefined); setUncertain(false); setChallengeFailure(undefined)
    form.resetFields(['password', 'confirmPassword', 'token']); form.setFields([{ name: 'email', errors: [], warnings: [] }]); onClearError?.()
  }
  const failure = (code: string) => t(`cloud.errors.${code}`, { defaultValue: t('cloud.operationFailed') })
  const motion = useAccountAuthMotion(challenge ? 'challenge' : notice ? `${mode}:notice` : mode === 'login' ? `login:${loginMethod}` : mode, onViewChange)

  if (challenge) return <section ref={motion} className={styles.auth}>
    <AuthIntro title={t('cloud.mfa.loginTitle')} hint={t('cloud.mfa.loginHint')} busy={busy} onBack={() => {
      const id = challenge.id
      changeMode('login')
      void run(() => api.cancelLogin(generation, id))
    }} />
    {blocked || error ? <Alert showIcon type="warning" title={blocked ? t(challengeFailure ? `cloud.errors.${challengeFailure}` : expired ? 'cloud.mfa.challengeExpired' : 'cloud.mfa.loginUncertain') : failure(error!)} /> : null}
    {/* 验证表单按挑战挂载，卸载时清除验证码，避免访问尚未连接的表单实例。 */}
    <Form className={styles.form} key="mfa-login" name="cloud-mfa-login" form={verificationForm} clearOnDestroy layout="vertical" scrollToFirstError={{ block: 'nearest', focus: true }} requiredMark={false} disabled={busy || blocked} onValuesChange={onClearError} onFinish={(values) => {
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

  const methodSwitch = mode === 'login' ? <Segmented className={styles.methods} aria-label={t('cloud.login.method')} block value={loginMethod} disabled={busy} options={[
    { value: 'password', label: <span className={styles['method-label']}><KeyRound size={14} aria-hidden="true" />{t('cloud.qr.password')}</span> },
    { value: 'qr', label: <span className={styles['method-label']}><QrCode size={14} aria-hidden="true" />{t('cloud.qr.login')}</span> },
  ]} onChange={value => { form.resetFields(['password', 'confirmPassword', 'token']); onClearError?.(); setLoginMethod(value === 'qr' ? 'qr' : 'password') }} /> : null

  const nextMode = mode === 'register' || mode === 'resend-verification' ? 'verify-email' : mode === 'password-reset/request' ? 'password-reset/confirm' : 'login'

  return <section ref={motion} className={styles.auth}>
    {!reauthenticate ? <AuthIntro title={mode === 'login' ? t('cloud.welcome') : t(`cloud.auth.${mode}`)}
      hint={mode === 'login' ? t('cloud.welcomeHint') : t(`cloud.authHints.${mode}`)} busy={busy}
      onBack={mode !== 'login' ? () => changeMode('login') : undefined} /> : <div className={styles.reconnect}>
      <span className={styles['reconnect-icon']}><Cloud size={20} aria-hidden="true" /></span>
      <div><h3>{t('cloud.login.reconnectTitle')}</h3><p>{t('cloud.login.reconnectHint')}</p></div>
    </div>}
    {!notice ? methodSwitch : null}
    {!notice && error ? <Alert showIcon type="error" title={failure(error)} /> : null}
    {mode === 'login' && loginMethod === 'qr' ? <AccountQRLogin api={api} generation={generation} reauthenticate={reauthenticate} /> : <>
      {notice ? <div className={styles.result} role="status">
        <span className={styles['result-icon']}><CircleCheck size={28} aria-hidden="true" /></span>
        <h3>{t(`cloud.authResults.${notice}`)}</h3>
        {nextMode !== 'login' ? <p>{t('cloud.login.checkMailHint')}</p> : null}
        <Button block size="large" type="primary" onClick={() => changeMode(nextMode)}>{t(nextMode === 'login' ? 'cloud.backToLogin' : `cloud.auth.${nextMode}`)}</Button>
      </div> : null}
      <Form hidden={Boolean(notice)} className={styles.form} key="password-auth" name={reauthenticate ? 'cloud-reauth' : 'cloud-auth'} form={form} initialValues={{ email: savedEmail }} layout="vertical" scrollToFirstError={{ block: 'nearest', focus: true }} disabled={busy} requiredMark={false} onValuesChange={onClearError} onFinish={(values) => {
        if (busy) return
        void run(async () => {
          const scope = lifetime.current
          if (mode === 'login') {
            const result = await api.login(generation, values.email, values.password)
            if (current(scope)) accept(result)
          } else {
            // 仅提交协议字段；确认密码留在本机表单中。
            await api.auth(mode, { generation, email: values.email, password: values.password, token: values.token })
            if (current(scope)) { setNotice(mode); form.resetFields(['password', 'confirmPassword', 'token']) }
          }
        })
      }}>
        <AccountAuthFields mode={mode} reauthenticate={reauthenticate} passwordAction={!reauthenticate && mode === 'login'
          ? <Button className={styles.forgot} type="link" size="small" disabled={busy} onClick={() => changeMode('password-reset/request')}>{t('cloud.auth.password-reset/request')}</Button> : undefined} />
        <Button block size="large" type="primary" htmlType="submit" loading={busy}>{t(mode === 'password-reset/request' || mode === 'resend-verification' ? 'cloud.login.sendMail' : `cloud.auth.${mode}`)}</Button>
      </Form>
    </>}
    {!reauthenticate && !notice ? <nav className={styles['auth-links']} aria-label={t('cloud.authOptions')}>
      {relatedModes[mode].map((value) =>
        <span key={value}>{mode === 'login' && value === 'register' ? <span>{t('cloud.login.noAccount')}</span> : null}<Button type="link" size="small" disabled={busy} onClick={() => changeMode(value)}>{t(`cloud.auth.${value}`)}</Button></span>,
      )}
    </nav> : null}
  </section>
}

function AuthIntro({ title, hint, busy, onBack }: { title: string; hint: string; busy: boolean; onBack?: () => void }) {
  const { t } = useTranslation()
  return <header className={styles.intro}>
    <div className={styles['intro-row']}>
      {onBack ? <Button className={styles.back} type="text" icon={<ArrowLeft size={16} aria-hidden="true" />}
        aria-label={t('cloud.backToLogin')} title={t('cloud.backToLogin')} disabled={busy} onClick={onBack} /> : null}
      <h2>{title}</h2>
    </div>
    <p>{hint}</p>
  </header>
}

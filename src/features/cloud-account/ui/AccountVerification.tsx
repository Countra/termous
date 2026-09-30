import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input } from 'antd'
import { Fingerprint } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudMFAMethod, CloudMFAProof, CloudMFAStatus } from '#common/contracts'
import { isCloudMFAUncertainError, type CloudGateway } from '#entities/cloud'
import { useCloudDeadline } from '../model/useCloudDeadline'
import { AccountSection } from './AccountSection'
import { AccountMFAFields } from './AccountMFAFields'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; generation: string; mfa?: CloudMFAStatus; unavailable: boolean; busy: boolean; accept: (value: CloudMFAStatus) => void; reload: () => Promise<CloudMFAStatus | undefined>; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountVerification({ api, generation, mfa, unavailable, busy, accept, reload, run }: Props) {
  const { t } = useTranslation()
  const [form] = Form.useForm<CloudMFAProof>()
  const [method, setMethod] = useState<CloudMFAMethod>('totp')
  const lifetime = useRef<{ active: boolean; api: CloudGateway; generation: string } | null>(null)
  useEffect(() => {
    const scope = { active: true, api, generation }
    lifetime.current = scope; form.resetFields(); setMethod('totp')
    return () => { scope.active = false }
  }, [api, generation, form])
  const { expired } = useCloudDeadline(mfa?.verified_until)
  const verified = mfa?.verified_until && !expired
  return <AccountSection title={t('cloud.securityVerification')} icon={<Fingerprint size={18} />} description={t('cloud.reauthenticateHint')}>
    {verified ? <Alert type="success" title={t('cloud.verified')} description={t('cloud.mfa.verifiedUntil', { time: new Date(mfa.verified_until!).toLocaleTimeString() })} /> : null}
    <Form name="cloud-security" className={styles['compact-form']} form={form} layout="vertical" requiredMark={false} disabled={busy || unavailable} onFinish={(values) => void run(async () => {
      const scope = lifetime.current
      const current = () => scope?.active && scope.api === api && scope.generation === generation && api.getStatus()?.generation === generation
      try {
        const result = await api.reauthenticate(generation, { password: values.password, ...(mfa?.enabled ? { method, code: values.code } : {}) })
        if (current() && mfa) {
          accept({ ...mfa, verified_until: result.verified_until }); form.resetFields()
          // 备用码消费不提升因子版本，补读余量；读取失败保留已确认的验证期限。
          if (method === 'backup_code') await reload()
        }
      } catch (cause) {
        if (current() && isCloudMFAUncertainError(cause)) { form.resetFields(); await reload() }
        throw cause
      }
    })}>
      <label htmlFor="cloud-security-password">{t('cloud.password')}</label>
      <div className={styles['verification-controls']}>
        <Form.Item name="password" rules={[{ required: true, message: t('cloud.passwordRequired') }]}><Input.Password id="cloud-security-password" autoComplete="current-password" /></Form.Item>
        {!mfa?.enabled ? <Button type="primary" htmlType="submit" loading={busy}>{t('cloud.auth.reauthenticate')}</Button> : null}
      </div>
      {mfa?.enabled ? <>
        <AccountMFAFields method={method} disabled={busy || unavailable} onMethodChange={(value) => { setMethod(value); form.resetFields(['code']) }} />
        <Button type="primary" htmlType="submit" loading={busy}>{t('cloud.auth.reauthenticate')}</Button>
      </> : null}
    </Form>
  </AccountSection>
}

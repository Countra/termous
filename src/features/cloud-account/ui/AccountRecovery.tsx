import { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Tag } from 'antd'
import { Cloud, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudMFAProof, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudAuthorization } from '../model/useCloudAuthorization'
import { AccountAuthorization } from './AccountAuthorization'
import { AccountMFAFields } from './AccountMFAFields'
import { AccountSection, AccountLoading } from './AccountSection'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }
export function AccountRecovery({ api, status, busy, run }: Props) {
  const { t } = useTranslation()
  const state = useCloudAuthorization(api, status.generation)
  const [selected, setSelected] = useState<CloudAuthorization>()
  const [decision, setDecision] = useState<{ action: 'disable' | 'freeze' | 'unfreeze'; revision: string; rotate?: boolean; stopped?: boolean }>()
  const [form] = Form.useForm<CloudMFAProof>()
  useEffect(() => {
    setSelected(undefined); setDecision(undefined); form.resetFields()
    return () => form.resetFields()
  }, [status.generation, form])
  const recovery = state.security?.recovery
  const unavailable = state.loading || state.error || !recovery
  const active = state.requests.find(v => v.kind === 'enablement' && ['pending', 'verified', 'processing'].includes(v.status))
  const begin = () => void run(async () => {
    const result = await api.createRecovery(status.generation, 'enablement')
    if (api.getStatus()?.generation === status.generation) { setSelected(result); await state.reload() }
  })
  return <AccountSection title={t('cloud.authorization.recoveryTitle')} icon={<Cloud size={18} />} description={t('cloud.authorization.recoveryHint')} extra={<Button type="text" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void state.reload()}>{t('cloud.refresh')}</Button>}>
    {state.error ? <Alert type="warning" showIcon title={t('cloud.authorization.readFailed')} /> : null}
    {state.loading ? <AccountLoading /> : null}
    {recovery ? <div className={styles.actions}><Tag>{t(`cloud.authorization.policyStates.${recovery.policy.status}`)}</Tag>{recovery.blocked_until ? <span className={styles.hint}>{t('cloud.authorization.cooldown', { date: new Date(recovery.blocked_until).toLocaleString() })}</span> : null}</div> : null}
    <p className={styles.hint}>{t('cloud.authorization.platformTrust')}</p>
    <div className={styles.actions}>
      {recovery?.policy.status === 'disabled' ? <Button type="primary" disabled={busy || unavailable || !state.security?.account.managed_recovery || !state.security.account.mfa_enabled || !state.security.membership_initialized || !state.security.keys_verified} onClick={begin}>{t('cloud.authorization.enable')}</Button> : null}
      {active ? <Button disabled={busy} onClick={() => setSelected(active)}>{t('cloud.authorization.continue')}</Button> : null}
      {(['enabled', 'frozen', 'enabling'].includes(recovery?.policy.status ?? '')) ? <>
        <Button danger disabled={busy || unavailable} onClick={() => { form.resetFields(); setDecision({ action: 'disable', revision: recovery!.policy.revision }) }}>{t('cloud.authorization.disable')}</Button>
        {state.security?.keys_verified ? <Button danger disabled={busy || unavailable} onClick={() => { form.resetFields(); setDecision({ action: 'disable', revision: recovery!.policy.revision, rotate: true }) }}>{t('cloud.authorization.disableRotate')}</Button> : null}
        {recovery && recovery.policy.status !== 'enabling' ? <Button disabled={busy || unavailable || !state.security?.keys_verified} onClick={() => { form.resetFields(); setDecision({ action: recovery.policy.status === 'frozen' ? 'unfreeze' : 'freeze', revision: recovery.policy.revision }) }}>{t(recovery.policy.status === 'frozen' ? 'cloud.authorization.unfreeze' : 'cloud.authorization.freeze')}</Button> : null}
      </> : null}
    </div>
    {!state.security?.account.mfa_enabled ? <p className={styles.hint}>{t('cloud.authorization.totpRequired')}</p> : !state.security.membership_initialized ? <p className={styles.hint}>{t('cloud.authorization.initializeHint')}</p> : null}
    {selected ? <AccountAuthorization key={selected.id} api={api} generation={status.generation} value={selected} mfaEnabled busy={busy} run={run} onClose={() => setSelected(undefined)} onChanged={() => void state.reload()} /> : null}
    <Modal open={Boolean(decision)} title={t(decision?.rotate ? 'cloud.authorization.disableRotate' : `cloud.authorization.${decision?.action ?? 'disable'}`)} footer={null} destroyOnHidden closable={!busy} mask={{ closable: !busy }} onCancel={() => { setDecision(undefined); form.resetFields() }}>
      <p>{t(decision?.stopped ? 'cloud.authorization.rotatePending' : decision?.action === 'disable' ? 'cloud.authorization.disableHint' : 'cloud.authorization.freezeHint')}</p>
      <Form form={form} layout="vertical" onFinish={proof => void run(async () => {
        if (!decision) return
        try {
          if (decision.stopped) {
            await api.reauthenticate(status.generation, { ...proof, method: 'totp' })
            await api.rekey(status.generation, 'start')
          } else {
            await api.recoveryPolicy(status.generation, decision.action, decision.revision, { ...proof, method: 'totp' })
          }
          if (api.getStatus()?.generation === status.generation) setDecision(decision.rotate && !decision.stopped ? { ...decision, stopped: true } : undefined)
        }
        finally { form.resetFields(); await state.reload() }
      })}>
        <Form.Item name="password" label={t('cloud.password')} rules={[{ required: true }]}><Input.Password autoComplete="current-password" disabled={busy} /></Form.Item>
        <AccountMFAFields method="totp" methods={['totp']} onMethodChange={() => {}} disabled={busy} />
        <Button type="primary" danger={decision?.action === 'disable'} htmlType="submit" loading={busy} disabled={unavailable}>{t('cloud.mfa.confirm')}</Button>
      </Form>
    </Modal>
  </AccountSection>
}

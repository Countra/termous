import { cloudDeadlineRemaining } from '#entities/cloud'
import { FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { useEffect, useRef, useState } from 'react'
import { Button, Form, Modal, Tag } from 'antd'
import { Cloud, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudMFAProof, CloudStatus, CloudReauthentication } from '#common/contracts'
import { isCloudMFAUncertainError, type CloudGateway } from '#entities/cloud'
import { useCloudAuthorization } from '../model/useCloudAuthorization'
import { useCloudDeadline } from '../model/useCloudDeadline'
import { cloudOperationErrorCode, useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { AccountAuthorization } from './AccountAuthorization'
import { AccountStepUpFields } from './AccountStepUpFields'
import { AccountOperationError } from './AccountOperationError'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { AccountSection, AccountLoading } from './AccountSection'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }
export function AccountRecovery({ api, status, busy, run }: Props) {
  const { t, i18n } = useTranslation()
  const state = useCloudAuthorization(api, status.generation)
  const policy = useRef({ enabled: state.security?.account.mfa_enabled, revision: state.security?.account.mfa_revision })
  useEffect(() => { policy.current = { enabled: state.security?.account.mfa_enabled, revision: state.security?.account.mfa_revision } }, [state.security?.account.mfa_enabled, state.security?.account.mfa_revision])
  const [selected, setSelected] = useState<CloudAuthorization>()
  const [decision, setDecision] = useState<{ action: 'disable' | 'freeze' | 'unfreeze'; revision: string; rotate?: boolean; stopped?: boolean }>()
  const [rotationUntil, setRotationUntil] = useState<Partial<CloudReauthentication> & { server_time: string }>()
  const [form] = Form.useForm<CloudMFAProof>()
  const feedback = useCloudOperationFeedback(api, status.generation, run)
  const disabled = busy || feedback.working
  useEffect(() => {
    setSelected(undefined); setDecision(undefined); setRotationUntil(undefined); form.resetFields()
    return () => form.resetFields()
  }, [status.generation, form])
  const recovery = state.security?.recovery
  const unavailable = state.loading || state.error || !recovery
  const rotationDeadline = useCloudDeadline(rotationUntil, rotationUntil?.verified_until)
  const rotationVerified = Boolean(rotationUntil?.verified_until && !rotationDeadline.expired)
  useEffect(() => { setRotationUntil(undefined) }, [state.security?.account.mfa_revision, state.security?.account.mfa_enabled])
  const active = state.requests.find(v => v.kind === 'enablement' && ['pending', 'verified', 'processing'].includes(v.status))
  const begin = () => void run(async () => {
    const result = await api.createRecovery(status.generation, 'enablement')
    if (api.getStatus()?.generation === status.generation) { setSelected(result); await state.reload() }
  })
  return <AccountSection title={t('cloud.authorization.recoveryTitle')} icon={<Cloud size={18} />} description={t('cloud.authorization.recoveryHint')} extra={<Button type="text" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void state.reload()}>{t('cloud.refresh')}</Button>}>
    {state.error ? <FeedbackMessage type="warning" title={t('cloud.authorization.readFailed')} /> : null}
    {state.loading ? <AccountLoading /> : null}
    {recovery ? <div className={styles.actions}><Tag>{t(`cloud.authorization.policyStates.${recovery.policy.status}`)}</Tag>{recovery.blocked_until ? <span className={styles.hint}>{t('cloud.authorization.cooldown', { date: new Date(recovery.blocked_until).toLocaleString() })}</span> : null}</div> : null}
    <p className={styles.hint}>{t('cloud.authorization.platformTrust')}</p>
    <div className={styles.actions}>
      {recovery?.policy.status === 'disabled' ? <Button type="primary" disabled={busy || unavailable || !state.security?.account.managed_recovery || !state.security.account.mfa_enabled || !state.security.membership_initialized || !state.security.keys_verified} onClick={begin}>{t('cloud.authorization.enable')}</Button> : null}
      {active ? <Button disabled={busy} onClick={() => setSelected(active)}>{t('cloud.authorization.continue')}</Button> : null}
      {(['enabled', 'frozen', 'enabling'].includes(recovery?.policy.status ?? '')) ? <>
        <Button danger disabled={disabled || unavailable} onClick={() => { feedback.reset(); form.resetFields(); setDecision({ action: 'disable', revision: recovery!.policy.revision }) }}>{t('cloud.authorization.disable')}</Button>
        {state.security?.keys_verified ? <Button danger disabled={disabled || unavailable} onClick={() => { feedback.reset(); form.resetFields(); setRotationUntil(undefined); setDecision({ action: 'disable', revision: recovery!.policy.revision, rotate: true }) }}>{t('cloud.authorization.disableRotate')}</Button> : null}
        {recovery && recovery.policy.status !== 'enabling' ? <Button disabled={disabled || unavailable || !state.security?.keys_verified} onClick={() => { feedback.reset(); form.resetFields(); setDecision({ action: recovery.policy.status === 'frozen' ? 'unfreeze' : 'freeze', revision: recovery.policy.revision }) }}>{t(recovery.policy.status === 'frozen' ? 'cloud.authorization.unfreeze' : 'cloud.authorization.freeze')}</Button> : null}
      </> : null}
    </div>
    {!state.security?.account.mfa_enabled ? <p className={styles.hint}>{t('cloud.authorization.totpRequired')}</p> : !state.security.membership_initialized ? <p className={styles.hint}>{t('cloud.authorization.initializeHint')}</p> : null}
    {selected ? <AccountAuthorization key={selected.id} api={api} generation={status.generation} value={selected} mfaEnabled={state.security?.account.mfa_enabled} mfaRevision={state.security?.account.mfa_revision} busy={busy} run={run} onClose={() => setSelected(undefined)} onChanged={() => void state.reload()} /> : null}
    <Modal open={Boolean(decision)} title={t(decision?.rotate ? 'cloud.authorization.disableRotate' : `cloud.authorization.${decision?.action ?? 'disable'}`)} footer={null} destroyOnHidden closable={!disabled} mask={{ closable: !disabled }} keyboard={!disabled} onCancel={() => { feedback.reset(); setDecision(undefined); form.resetFields() }}><FeedbackMessageScope active={Boolean(decision)}>
      <p>{t(decision?.stopped ? 'cloud.authorization.rotatePending' : decision?.action === 'disable' ? 'cloud.authorization.disableHint' : 'cloud.authorization.freezeHint')}</p>
      <AccountOperationError code={feedback.errorCode} />
      <Form form={form} layout="vertical" onFinish={proof => void feedback.perform(async current => {
        if (!decision || unavailable || busy) return
        const startedPolicy = policy.current
        const currentPolicy = () => current() && policy.current === startedPolicy
        try {
          if (decision.stopped) {
            if (cloudDeadlineRemaining(rotationUntil, rotationUntil?.verified_until) <= 0) {
              if (rotationVerified) throw new Error('reauthentication_required')
              const result = await api.reauthenticate(status.generation, buildCloudStepUpProof(state.security?.account.mfa_enabled, proof))
              if (!current()) return
              if (!currentPolicy()) throw new Error('mfa_revision_conflict')
              setRotationUntil(result)
            }
            if (!currentPolicy()) return
            await api.rekey(status.generation, 'start')
          } else {
            await api.recoveryPolicy(status.generation, decision.action, decision.revision, buildCloudStepUpProof(state.security?.account.mfa_enabled, proof))
            if (!current()) return
            form.resetFields()
            if (decision.rotate) {
              // 停止发放已经确认；后续读取或轮换失败只能继续此阶段，不能重做停止请求。
              setDecision({ ...decision, stopped: true }); setRotationUntil(undefined)
              const verified = await api.mfaStatus(status.generation)
              if (!current()) return
              if (!currentPolicy() || verified.revision !== startedPolicy.revision || verified.enabled !== startedPolicy.enabled) throw new Error('mfa_revision_conflict')
              setRotationUntil(verified)
              if (!verified.verified_until || cloudDeadlineRemaining(verified, verified.verified_until) <= 0) return
              await api.rekey(status.generation, 'start')
            }
          }
          if (current()) setDecision(undefined)
        } catch (cause) {
          if (current() && cloudOperationErrorCode(cause, value => i18n.exists(`cloud.errors.${value}`)) === 'reauthentication_required') setRotationUntil(undefined)
          if (current() && decision.rotate && isCloudMFAUncertainError(cause)) {
            const facts = await Promise.allSettled([api.security(status.generation), api.mfaStatus(status.generation)])
            if (current()) {
              if (facts[0].status === 'fulfilled' && facts[0].value.recovery.policy.status === 'disabled') setDecision({ ...decision, stopped: true })
              if (currentPolicy() && facts[1].status === 'fulfilled' && facts[1].value.revision === startedPolicy.revision && facts[1].value.enabled === startedPolicy.enabled) setRotationUntil(facts[1].value)
            }
          }
          throw cause
        }
        finally { if (current()) { if (currentPolicy()) form.resetFields(['password']); await state.reload() } }
      })}>
        {!decision?.stopped || !rotationVerified ? <AccountStepUpFields key={String(Boolean(decision?.stopped))} enabled={state.security?.account.mfa_enabled} revision={state.security?.account.mfa_revision} disabled={disabled || unavailable} /> : null}
        <Button type="primary" danger={decision?.action === 'disable'} htmlType="submit" loading={disabled} disabled={unavailable}>{t(decision?.stopped ? 'cloud.rekeyStart' : decision?.rotate ? 'cloud.authorization.disableRotate' : `cloud.authorization.${decision?.action ?? 'disable'}`)}</Button>
      </Form>
    </FeedbackMessageScope></Modal>
  </AccountSection>
}

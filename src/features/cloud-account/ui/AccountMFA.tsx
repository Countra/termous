import { cloudDeadlineRemaining } from '#entities/cloud'
import { FeedbackMessage } from '#shared/ui'
import { useEffect, useRef, useState } from 'react'
import { Button, Form, Modal, Steps, Tag } from 'antd'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudMFAProof, CloudMFASetup, CloudMFAStatus } from '#common/contracts'
import { isCloudMFAUncertainError, type CloudGateway } from '#entities/cloud'
import { useCloudDeadline } from '../model/useCloudDeadline'
import { AccountLoading, AccountSection } from './AccountSection'
import { AccountMFAFields } from './AccountMFAFields'
import { AccountStepUpFields } from './AccountStepUpFields'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { AccountMFACodes } from './AccountMFACodes'
import { AccountMFASetup } from './AccountMFASetup'
import styles from './AccountMFA.module.scss'

interface Props { api: CloudGateway; generation: string; value?: CloudMFAStatus; loading: boolean; error: boolean; busy: boolean; accept: (value: CloudMFAStatus) => void; reload: () => Promise<CloudMFAStatus | undefined>; onChanged: () => void; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }
type Action = 'setup' | 'disable' | 'regenerate'

export function AccountMFA({ api, generation, value, loading, error, busy, accept, reload, onChanged, run }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<Action>('setup')
  const [setup, setSetup] = useState<CloudMFASetup>()
  const [codes, setCodes] = useState<string[]>()
  const [operationStatus, setOperationStatus] = useState<Pick<CloudMFAStatus, 'enabled' | 'revision'>>()
  const [operationError, setOperationError] = useState<string>()
  const [uncertain, setUncertain] = useState(false)
  const [working, setWorking] = useState(false)
  const [form] = Form.useForm<CloudMFAProof>()
  const lifetime = useRef<{ active: boolean; api: CloudGateway; generation: string; pending: boolean } | null>(null)
  const invalidated = useRef(false)
  useEffect(() => {
    const scope = { active: true, api, generation, pending: false }
    lifetime.current = scope
    invalidated.current = true
    setOpen(false); setSetup(undefined); setCodes(undefined); setOperationStatus(undefined); setOperationError(undefined); setUncertain(false); setWorking(false); form.resetFields()
    return () => { scope.active = false }
  }, [api, generation, form])
  useEffect(() => {
    if (open && value && operationStatus && value.revision !== operationStatus.revision) {
      invalidated.current = true
      setOpen(false); setSetup(undefined); setCodes(undefined); form.resetFields(); setOperationError('mfa_revision_conflict')
    }
  }, [value, open, operationStatus, form])
  const { expired } = useCloudDeadline(setup, setup?.expires_at)
  useEffect(() => {
    if (!setup || !expired) return
    // 到期立即卸载二维码和密钥；已发出的确认仅等待事实，不重新发送。
    setOpen(false); setSetup(undefined); form.resetFields(); setOperationError('mfa_setup_expired')
  }, [setup, expired, form])
  const disabled = busy || working
  const current = (scope: typeof lifetime.current) => scope?.active && scope.api === api && scope.generation === generation && api.getStatus()?.generation === generation
  const start = (next: Action) => {
    if (!value || disabled || loading || error) return
    invalidated.current = false
    setAction(next); setOpen(true); setSetup(undefined); setCodes(undefined); setOperationError(undefined); setUncertain(false); setOperationStatus({ enabled: value.enabled, revision: value.revision }); form.resetFields()
  }
  const finish = () => { setOpen(false); setSetup(undefined); setCodes(undefined); form.resetFields() }
  const perform = (operation: () => Promise<void>) => {
    const scope = lifetime.current
    void run(async () => {
      if (!scope || !current(scope) || scope.pending) return
      scope.pending = true; setWorking(true); setOperationError(undefined); setUncertain(false)
      try { await operation() } catch (cause) {
        if (current(scope)) {
          setOperationError(cause instanceof Error ? cause.message : 'local_failed')
          // 结果不明时只读取事实，不再次发送动态码、备用码或确认操作。
          if (isCloudMFAUncertainError(cause)) { setUncertain(true); finish(); await reload() }
          else if (cause instanceof Error && ['mfa_revision_conflict', 'mfa_setup_expired', 'mfa_setup_exhausted'].includes(cause.message)) { finish(); await reload() }
        }
        throw cause
      } finally { scope.pending = false; if (current(scope)) setWorking(false) }
    })
  }
  const close = () => {
    if (disabled || codes) return
    const pending = setup
    invalidated.current = true
    finish()
    if (pending) perform(async () => {
      const next = await api.mfaCancel(generation, pending.revision, pending.setup_id)
      if (current(lifetime.current)) accept(next)
    })
  }
  const update = (next: CloudMFAStatus) => { accept(next); setOperationStatus({ enabled: next.enabled, revision: next.revision }); onChanged() }
  const title = codes ? t('cloud.mfa.saveCodes') : action === 'disable' ? t('cloud.mfa.disable') : action === 'regenerate' ? t('cloud.mfa.regenerate') : t(operationStatus?.enabled ? 'cloud.mfa.replace' : 'cloud.mfa.enable')
  const feedback = operationError || uncertain ? <FeedbackMessage type="warning" title={t(uncertain ? 'cloud.mfa.outcomeUncertain' : `cloud.errors.${operationError}`, { defaultValue: t('cloud.operationFailed') })} description={uncertain ? t('cloud.mfa.outcomeUncertainHint') : undefined} /> : null

  return <AccountSection title={t('cloud.mfa.title')} icon={<ShieldCheck size={18} />} description={t('cloud.mfa.hint')} extra={<Button size="small" type="text" aria-label={t('cloud.mfa.refresh')} icon={<RefreshCw size={15} />} loading={loading} disabled={disabled || loading} onClick={() => void reload()}>{t('cloud.mfa.refresh')}</Button>}>
    {error ? <FeedbackMessage type="warning" title={t('cloud.mfa.loadFailed')} /> : null}
    {!open ? feedback : null}
    {!value && loading ? <AccountLoading label={t('cloud.mfa.loading')} /> : value ? <div className={styles.summary}>
      <div className={styles['summary-text']}>
        <div><Tag color={value.enabled ? 'success' : undefined}>{t(value.enabled ? 'cloud.mfa.enabled' : 'cloud.mfa.disabled')}</Tag></div>
        <p>{value.enabled ? t('cloud.mfa.codesRemaining', { count: value.backup_codes_remaining }) : t('cloud.mfa.disabledHint')}</p>
      </div>
      <div className={styles.actions}>
        {value.enabled ? <>
          <Button disabled={disabled || loading || error} onClick={() => start('regenerate')}>{t('cloud.mfa.regenerate')}</Button>
          <Button disabled={disabled || loading || error} onClick={() => start('setup')}>{t('cloud.mfa.replace')}</Button>
          <Button danger disabled={disabled || loading || error} onClick={() => start('disable')}>{t('cloud.mfa.disable')}</Button>
        </> : <Button type="primary" disabled={disabled || loading || error} onClick={() => start('setup')}>{t('cloud.mfa.enable')}</Button>}
      </div>
    </div> : null}
    {open && (!setup || !expired) ? <Modal open title={title} width={600} footer={null} destroyOnHidden closable={!disabled && !codes} mask={{ closable: !disabled && !codes }} keyboard={!disabled && !codes} onCancel={close}>
      <div className={styles.wizard}>
        {action !== 'disable' ? <Steps size="small" current={codes ? action === 'regenerate' ? 1 : 2 : setup ? 1 : 0} items={(action === 'regenerate' ? ['identity', 'save'] : ['identity', 'authenticator', 'save']).map((step) => ({ title: t(`cloud.mfa.steps.${step}`) }))} /> : null}
        {feedback}
        {codes ? <AccountMFACodes codes={codes} onDone={finish} /> : setup ? <>
          <AccountMFASetup setup={setup} disabled={expired} onCopyError={() => setOperationError('mfa_copy_failed')} />
          <Form className={styles['setup-confirm']} name="cloud-mfa-confirm" form={form} layout="vertical" requiredMark={false} disabled={disabled || expired} onFinish={(values) => perform(async () => {
            const scope = lifetime.current
            if (cloudDeadlineRemaining(setup, setup.expires_at) <= 0) { finish(); throw new Error('mfa_setup_expired') }
            const next = await api.mfaConfirm(generation, setup.revision, setup.setup_id, values.code!)
            if (current(scope) && !invalidated.current) { update(next.status); setSetup(undefined); setCodes(next.backup_codes); setOpen(true); form.resetFields() }
          })}>
            <AccountMFAFields key={setup.setup_id} gap={14} method="totp" methods={['totp']} onMethodChange={() => {}} disabled={disabled || expired} autoFocus />
            <div className={styles.actions}><Button type="primary" htmlType="submit" loading={disabled} disabled={expired}>{t('cloud.mfa.confirm')}</Button><Button disabled={disabled} onClick={close}>{t('cloud.mfa.cancel')}</Button></div>
          </Form>
        </> : <>
          <p>{t(action === 'disable' ? 'cloud.mfa.disableHint' : action === 'regenerate' ? 'cloud.mfa.regenerateHint' : operationStatus?.enabled ? 'cloud.mfa.replaceHint' : 'cloud.mfa.enableHint')}</p>
          <Form name="cloud-mfa-identity" form={form} layout="vertical" requiredMark={false} disabled={disabled} onFinish={(values) => perform(async () => {
            if (!value || !operationStatus || value.revision !== operationStatus.revision) throw new Error('mfa_revision_conflict')
            const scope = lifetime.current
            const proof = buildCloudStepUpProof(operationStatus.enabled, values)
            if (action === 'setup') {
              const next = await api.mfaSetup(generation, operationStatus.revision, proof)
              if (current(scope) && !invalidated.current) { setSetup(next); setOperationStatus({ enabled: operationStatus.enabled, revision: next.revision }); form.resetFields() }
            } else if (action === 'regenerate') {
              const next = await api.mfaRegenerate(generation, operationStatus.revision, proof)
              if (current(scope) && !invalidated.current) { update(next.status); setCodes(next.backup_codes); form.resetFields() }
            } else {
              const next = await api.mfaDisable(generation, operationStatus.revision, proof)
              if (current(scope) && !invalidated.current) { update(next); finish() }
            }
          })}>
            <AccountStepUpFields enabled={operationStatus?.enabled} revision={operationStatus?.revision} disabled={disabled} />
            <div className={styles.actions}><Button type="primary" danger={action === 'disable'} htmlType="submit" loading={disabled}>{t(action === 'disable' ? 'cloud.mfa.confirmDisable' : action === 'regenerate' ? 'cloud.mfa.regenerate' : 'cloud.mfa.continue')}</Button><Button disabled={disabled} onClick={close}>{t('cloud.mfa.cancel')}</Button></div>
          </Form>
        </>}
      </div>
    </Modal> : null}
  </AccountSection>
}

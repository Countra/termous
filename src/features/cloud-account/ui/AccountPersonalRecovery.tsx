import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Steps, Tag } from 'antd'
import { ClipboardCopy, Download, KeyRound, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudMFAProof, CloudMFAStatus, CloudPersonalRecoverySetup, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { cloudOperationErrorCode } from '../model/useCloudOperationFeedback'
import { useCloudSafeguards } from '../model/useCloudSafeguards'
import { useCloudDeadline } from '../model/useCloudDeadline'
import { AccountStepUpFields } from './AccountStepUpFields'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { AccountSection } from './AccountSection'
import styles from './AccountSafeguards.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountPersonalRecovery({ api, status, busy, run }: Props) {
  const { t, i18n } = useTranslation()
  const security = useCloudSafeguards(api, status.generation)
  const policy = useRef({ enabled: security.value?.account.mfa_enabled, revision: security.value?.account.mfa_revision })
  useEffect(() => { policy.current = { enabled: security.value?.account.mfa_enabled, revision: security.value?.account.mfa_revision } }, [security.value?.account.mfa_enabled, security.value?.account.mfa_revision])
  const [open, setOpen] = useState(false)
  const [setup, setSetup] = useState<CloudPersonalRecoverySetup>()
  const [stage, setStage] = useState(0)
  const [rotate, setRotate] = useState(false)
  const [rotationPending, setRotationPending] = useState(false)
  const [rotationMFA, setRotationMFA] = useState<Pick<CloudMFAStatus, 'enabled' | 'revision' | 'verified_until'>>()
  const [exportError, setExportError] = useState(false)
  const [operationError, setOperationError] = useState<string>()
  const [queriedPending, setQueriedPending] = useState(false)
  const [working, setWorking] = useState(false)
  const [proof] = Form.useForm<CloudMFAProof>()
  const [answers] = Form.useForm<{ first: string; second: string }>()
  const wizardRun = useRef(0)
  const life = useRef({ active: true, api, generation: status.generation, pending: false })
  useEffect(() => {
    const current = { active: true, api, generation: status.generation, pending: false }; life.current = current
    wizardRun.current++; setOpen(false); setSetup(undefined); setRotationPending(false); setRotationMFA(undefined); setOperationError(undefined); setWorking(false)
    return () => { current.active = false; proof.setFieldsValue({ password: undefined, code: undefined }); if (answers.getFieldInstance('first')) answers.resetFields() }
  }, [api, status.generation, proof, answers])
  useEffect(() => {
    if (!setup) return
    const until = Math.min(Date.parse(setup.expires_at), Date.parse(setup.verified_until ?? setup.expires_at))
    const timer = setTimeout(() => { wizardRun.current++; setSetup(undefined); setStage(0); setOperationError('authorization_expired'); proof.setFieldsValue({ password: undefined, code: undefined }); if (answers.getFieldInstance('first')) answers.resetFields() }, Math.max(0, until - Date.now()))
    return () => clearTimeout(timer)
  }, [setup, proof, answers])
  const current = (scope: typeof life.current) => scope === life.current && scope.active && scope.api === api && scope.generation === api.getStatus()?.generation
  const rotationDeadline = useCloudDeadline(rotationMFA?.verified_until)
  const rotationVerified = Boolean(rotationMFA?.verified_until && !rotationDeadline.expired)
  useEffect(() => {
    if (rotationMFA && (rotationMFA.revision !== security.value?.account.mfa_revision || rotationMFA.enabled !== security.value?.account.mfa_enabled)) setRotationMFA(undefined)
  }, [rotationMFA, security.value?.account.mfa_revision, security.value?.account.mfa_enabled])
  const disabled = busy || working
  const perform = (action: () => Promise<void>) => {
    const scope = life.current
    const request = wizardRun.current
    void run(async () => {
      if (!current(scope) || scope.pending || request !== wizardRun.current) return
      scope.pending = true; setWorking(true); setOperationError(undefined); setQueriedPending(false)
      try { await action() } catch (cause) {
        const code = cloudOperationErrorCode(cause, value => i18n.exists(`cloud.errors.${value}`))
        if (current(scope) && request === wizardRun.current) {
          setOperationError(code)
          if (code === 'reauthentication_required') setRotationMFA(previous => previous ? { ...previous, verified_until: undefined } : undefined)
        }
        throw Object.assign(new Error(code), { cause })
      } finally { scope.pending = false; if (current(scope)) setWorking(false) }
    })
  }
  const enabled = security.value?.account.personal_recovery_enabled === true
  const close = () => { wizardRun.current++; setOpen(false); setSetup(undefined); setStage(0); setExportError(false); setOperationError(undefined); setQueriedPending(false); proof.setFieldsValue({ password: undefined, code: undefined }); if (answers.getFieldInstance('first')) answers.resetFields() }
  const start = (rotation: boolean) => { wizardRun.current++; setRotate(rotation); setRotationMFA(undefined); setOpen(true); setStage(0); setSetup(undefined); setOperationError(undefined); setQueriedPending(false) }
  const complete = async (id: string, values: string[]) => {
    const scope = life.current
    const request = wizardRun.current
    const result = await api.confirmPersonalRecovery(status.generation, id, values)
    if (!['completed', 'acknowledged'].includes(result.status)) throw new Error('CLOUD_RESPONSE_INVALID')
    if (!current(scope) || request !== wizardRun.current) return
    close(); await security.reload()
    if (rotate && current(scope)) {
      const rotationRequest = wizardRun.current
      const startedPolicy = policy.current
      try {
        const verified = await api.mfaStatus(status.generation)
        if (!current(scope) || rotationRequest !== wizardRun.current) return
        if (startedPolicy !== policy.current || verified.revision !== startedPolicy.revision || verified.enabled !== startedPolicy.enabled) throw new Error('mfa_revision_conflict')
        setRotationMFA(verified)
        if (verified.verified_until && Date.parse(verified.verified_until) > Date.now()) await api.rekey(status.generation, 'start')
        else setRotationPending(true)
      } catch (cause) {
        if (current(scope) && rotationRequest === wizardRun.current) {
          setRotationPending(true)
          const code = cloudOperationErrorCode(cause, value => i18n.exists(`cloud.errors.${value}`))
          setOperationError(code)
          if (code === 'reauthentication_required') setRotationMFA(previous => previous ? { ...previous, verified_until: undefined } : undefined)
        }
        throw cause
      }
    }
  }
  const queryResult = async () => {
    const scope = life.current
    const request = wizardRun.current
    const op = await api.personalOperation(status.generation, 'setup', setup?.id ?? 'current')
    if (!current(scope) || request !== wizardRun.current) return
    if (['completed', 'acknowledged'].includes(op.status)) await complete(op.id, [])
    else if (op.status === 'expired') throw new Error('authorization_expired')
    else if (['invalidated', 'cancelled'].includes(op.status)) throw new Error('authorization_stale')
    else setQueriedPending(true)
  }
  const feedback = operationError ? <Alert type="error" showIcon title={t(`cloud.errors.${operationError}`, { defaultValue: t('cloud.safeguards.operationFailed') })} description={t('cloud.safeguards.errorCode', { code: operationError })} /> : null
  const generate = async (evidence: CloudMFAProof) => {
    if (disabled || security.error || security.loading) return
    const scope = life.current
    const request = wizardRun.current
    const startedPolicy = policy.current
    try {
      const result = await api.setupPersonalRecovery(status.generation, buildCloudStepUpProof(security.value?.account.mfa_enabled, evidence))
      if (!current(scope) || request !== wizardRun.current) return
      if (startedPolicy !== policy.current) throw new Error('mfa_revision_conflict')
      setSetup(result); setStage(1)
    } finally { if (current(scope) && request === wizardRun.current && startedPolicy === policy.current) proof.resetFields() }
  }
  const exportKey = async (download: boolean) => {
    if (!setup) return
    const scope = life.current
    const request = wizardRun.current
    let url: string | undefined
    try {
      if (download) {
        url = URL.createObjectURL(new Blob([`Termous personal recovery key\nService: ${status.origin ?? ''}\nAccount: ${status.email ?? ''}\nWorkspace: ${status.workspace_id ?? ''}\n\n${setup.recovery_key}\n\nKeep this key private and store it separately from your devices.\n`], { type: 'text/plain;charset=utf-8' }))
        const link = document.createElement('a'); link.href = url; link.download = 'termous-personal-recovery-key.txt'; link.click()
      } else await navigator.clipboard.writeText(setup.recovery_key)
      if (current(scope) && request === wizardRun.current) setExportError(false)
    } catch { if (current(scope) && request === wizardRun.current) setExportError(true) } finally { if (url) URL.revokeObjectURL(url) }
  }
  return <AccountSection title={t('cloud.safeguards.personalTitle')} icon={<KeyRound size={18} />} description={t('cloud.safeguards.personalHint')} extra={<Tag>{t(security.loading ? 'cloud.loading' : security.error ? 'cloud.safeguards.unavailable' : enabled ? 'cloud.safeguards.enabled' : 'cloud.safeguards.notSet')}</Tag>}>
    {security.error ? <Alert type="warning" showIcon title={t('cloud.safeguards.readFailed')} action={<Button onClick={() => void security.reload()}>{t('cloud.retry')}</Button>} /> : null}
    {!security.value?.membership_initialized && !security.error ? <Alert type="info" showIcon title={t('cloud.safeguards.initializeFirst')} /> : null}
    <div className={styles.actions}>
      <Button type={enabled ? 'default' : 'primary'} disabled={disabled || security.loading || security.error || !security.value?.keys_verified || !security.value.membership_initialized} onClick={() => start(false)}>{t(enabled ? 'cloud.safeguards.replaceKey' : 'cloud.safeguards.setupKey')}</Button>
      {enabled ? <Button icon={<RefreshCw size={14} />} disabled={disabled || security.loading || security.error} onClick={() => start(true)}>{t('cloud.safeguards.replaceAndRotate')}</Button> : null}
    </div>
    <Modal open={open} title={t(enabled ? 'cloud.safeguards.replaceKey' : 'cloud.safeguards.setupKey')} footer={null} destroyOnHidden onCancel={close}>
      <div className={styles.wizard}>
        <Steps size="small" current={stage} items={['verifyIdentity', 'saveKey', 'confirmSaved'].map(key => ({ title: t(`cloud.safeguards.${key}`) }))} />
        {feedback}
        {queriedPending ? <Alert type="info" showIcon title={t('cloud.safeguards.setupPending')} /> : null}
        {enabled ? <Alert type="warning" showIcon title={t('cloud.safeguards.replaceWarning')} /> : null}
        {stage === 0 ? <Form form={proof} layout="vertical" onFinish={value => perform(() => generate(value))}>
          <AccountStepUpFields enabled={security.value?.account.mfa_enabled} revision={security.value?.account.mfa_revision} disabled={disabled || security.error} />
          <div className={styles.actions}><Button type="primary" htmlType="submit" loading={disabled} disabled={security.error || security.loading}>{t('cloud.safeguards.generate')}</Button><Button disabled={disabled} onClick={() => perform(async () => { await api.cancelPersonalRecovery(status.generation, 'setup', 'current') })}>{t('cloud.safeguards.cancelPrevious')}</Button><Button disabled={disabled} onClick={() => perform(queryResult)}>{t('cloud.safeguards.queryResult')}</Button></div>
        </Form> : null}
        {stage === 1 && setup ? <>
          <Alert type="warning" showIcon title={t('cloud.safeguards.saveWarning')} description={t('cloud.safeguards.saveHint')} />
          <ol className={styles['key-grid']} aria-label={t('cloud.safeguards.personalTitle')}>{setup.recovery_key.slice(5).split('-').map((group, index) => <li key={index}><small>{index + 1}</small><code>{group}</code></li>)}</ol>
          {exportError ? <Alert type="error" title={t('cloud.mfa.exportFailed')} /> : null}
          <div className={styles.actions}><Button icon={<ClipboardCopy size={14} />} onClick={() => void exportKey(false)}>{t('cloud.copy')}</Button><Button icon={<Download size={14} />} onClick={() => void exportKey(true)}>{t('cloud.safeguards.downloadKey')}</Button></div>
          <Button type="primary" onClick={() => { setSetup({ ...setup, recovery_key: '' }); setStage(2) }}>{t('cloud.safeguards.savedContinue')}</Button>
        </> : null}
        {stage === 2 && setup ? <Form form={answers} layout="vertical" onFinish={value => perform(() => complete(setup.id, [value.first, value.second]))}>
          <p>{t('cloud.safeguards.confirmHint')}</p>
          {setup.confirm_groups.map((index, i) => <Form.Item key={index} name={i === 0 ? 'first' : 'second'} label={t('cloud.safeguards.group', { number: index + 1 })} rules={[{ required: true }]}><Input autoComplete="off" spellCheck={false} maxLength={5} disabled={disabled} autoFocus={i === 0} /></Form.Item>)}
          <div className={styles.actions}><Button type="primary" htmlType="submit" loading={disabled}>{t('cloud.safeguards.activate')}</Button><Button disabled={disabled} onClick={() => perform(queryResult)}>{t('cloud.safeguards.queryResult')}</Button></div>
        </Form> : null}
      </div>
    </Modal>
    <Modal open={rotationPending} title={t('cloud.safeguards.rotateAfterReplace')} footer={null} destroyOnHidden closable={!disabled} mask={{ closable: !disabled }} keyboard={!disabled} onCancel={() => { setRotationPending(false); setOperationError(undefined); proof.resetFields() }}>
      <p>{t('cloud.safeguards.rotateAfterReplaceHint')}</p>
      {feedback}
      <Form form={proof} layout="vertical" onFinish={evidence => perform(async () => {
        if (security.loading || security.error) return
        const scope = life.current
        const request = wizardRun.current
        const startedPolicy = policy.current
        try {
          if (!rotationMFA?.verified_until || Date.parse(rotationMFA.verified_until) <= Date.now()) {
            if (rotationVerified) throw new Error('reauthentication_required')
            const result = await api.reauthenticate(status.generation, buildCloudStepUpProof(security.value?.account.mfa_enabled, evidence))
            if (!current(scope) || request !== wizardRun.current) return
            if (startedPolicy !== policy.current) throw new Error('mfa_revision_conflict')
            if (startedPolicy.enabled === undefined || startedPolicy.revision === undefined) throw new Error('CLOUD_MFA_UNAVAILABLE')
            setRotationMFA({ enabled: startedPolicy.enabled, revision: startedPolicy.revision, verified_until: result.verified_until })
          }
          if (!current(scope) || request !== wizardRun.current) return
          await api.rekey(status.generation, 'start')
          if (current(scope)) setRotationPending(false)
        } finally { if (current(scope) && request === wizardRun.current && startedPolicy === policy.current) proof.resetFields() }
      })}>
        {!rotationVerified ? <AccountStepUpFields enabled={security.value?.account.mfa_enabled} revision={security.value?.account.mfa_revision} disabled={disabled} /> : null}
        <Button type="primary" htmlType="submit" loading={disabled} disabled={security.loading || security.error}>{t('cloud.rekeyStart')}</Button>
      </Form>
    </Modal>
  </AccountSection>
}

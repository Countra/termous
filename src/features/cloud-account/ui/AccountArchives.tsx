import { FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Form, Modal, Radio, Table } from 'antd'
import { Archive, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudRecoveryCredential, CloudArchive, CloudArchivePreview, CloudMFAProof, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudReconnect } from '../model/useCloudReconnect'
import { useCloudChanges } from '../model/useCloudChanges'
import { useDeadlineExpired } from '../model/useDeadlineExpired'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { AccountStepUpFields } from './AccountStepUpFields'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { AccountRecoveryKeyInput } from './AccountRecoveryKeyInput'
import { AccountOperationError } from './AccountOperationError'
import { AccountSection } from './AccountSection'
import styles from './AccountSafeguards.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; mfaEnabled?: boolean; mfaRevision?: string; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }
export function AccountArchives({ api, status, busy, mfaEnabled, mfaRevision, run }: Props) {
  const { t } = useTranslation()
  const [archives, setArchives] = useState<CloudArchive[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CloudArchive>()
  const [deleting, setDeleting] = useState<CloudArchive>()
  const [preview, setPreview] = useState<CloudArchivePreview>()
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({})
  const importRun = useRef(0)
  const importRequest = importRun.current
  const [proof] = Form.useForm<CloudMFAProof>()
  const life = useRef<{ controller: AbortController; request: number } | null>(null)
  const policy = useRef({ enabled: mfaEnabled, revision: mfaRevision })
  useEffect(() => { policy.current = { enabled: mfaEnabled, revision: mfaRevision } }, [mfaEnabled, mfaRevision])
  const generation = status.generation
  const feedback = useCloudOperationFeedback(api, generation, run)
  const inactive = busy || feedback.working
  const previewExpired = useDeadlineExpired(preview?.expires_at)
  const load = useCallback(async () => {
    const scope = life.current
    if (!scope || scope.controller.signal.aborted) return
    const request = ++scope.request; setLoading(true)
    try { const result = await api.archives(generation, scope.controller.signal); if (!scope.controller.signal.aborted && request === scope.request && api.getStatus()?.generation === generation) { setArchives(result); setError(false) } }
    catch { if (!scope.controller.signal.aborted && request === scope.request) setError(true) }
    finally { if (!scope.controller.signal.aborted && request === scope.request) setLoading(false) }
  }, [api, generation])
  useEffect(() => { const scope = { controller: new AbortController(), request: 0 }; life.current = scope; importRun.current++; setArchives([]); setSelected(undefined); setDeleting(undefined); setPreview(undefined); setChoices({}); void load(); return () => { scope.controller.abort(); proof.setFieldsValue({ password: undefined, code: undefined }) } }, [load, proof])
  useCloudReconnect(api, generation, load)
  useCloudChanges(api, generation, ['workspaces'], load)
  const close = () => { importRun.current++; feedback.reset(); setSelected(undefined); setPreview(undefined); setChoices({}) }
  const retrieve = (credential?: CloudRecoveryCredential) => feedback.perform(async current => {
    if (!selected) return
    const result = await api.previewArchive(generation, selected.id, credential)
    if (current()) { setPreview(result); setChoices({}) }
  })
  const closeDelete = () => { feedback.reset(); setDeleting(undefined); proof.resetFields() }
  return <AccountSection title={t('cloud.safeguards.archivesTitle')} icon={<Archive size={18} />} description={t('cloud.safeguards.archiveHint')} extra={<Button type="text" icon={<RefreshCw size={14} />} loading={loading} disabled={busy || loading} onClick={() => void load()}>{t('cloud.refresh')}</Button>}>
    {error ? <FeedbackMessage type="warning" title={t('cloud.safeguards.archiveReadFailed')} /> : null}
    {!archives.length && !error && !loading ? <p className={styles['danger-hint']}>{t('cloud.safeguards.noArchives')}</p> : null}
    {archives.map(archive => <div className={styles.actions} key={archive.id}>
      <span>{t(archive.status === 'deleting' ? 'cloud.safeguards.cleaning' : 'cloud.safeguards.archiveUntil', { date: archive.expires_at ? new Date(archive.expires_at).toLocaleString() : '—' })}</span>
      <Button disabled={inactive || archive.status !== 'archived'} onClick={() => { close(); setSelected(archive) }}>{t('cloud.safeguards.retrieve')}</Button>
      <Button danger disabled={inactive || archive.status !== 'archived' || mfaEnabled === undefined} onClick={() => { feedback.reset(); setDeleting(archive) }}>{t('cloud.safeguards.deleteArchive')}</Button>
    </div>)}
    <Modal open={Boolean(selected)} width={720} title={t('cloud.safeguards.retrieve')} footer={null} destroyOnHidden closable={!inactive} mask={{ closable: !inactive }} keyboard={!inactive} onCancel={close}><FeedbackMessageScope active={Boolean(selected)}>
      <div className={styles.wizard}>
        <p>{t('cloud.safeguards.retrieveHint')} {t('cloud.safeguards.retrieveNoDelete')}</p>
        <AccountOperationError code={feedback.errorCode} />
        {!preview ? <>
          {selected?.local_key_available ? <Button type="primary" loading={inactive} onClick={() => void retrieve()}>{t('cloud.safeguards.previewRetrieve')}</Button> : null}
          <p className={styles['danger-hint']}>{t(selected?.local_key_available ? 'cloud.safeguards.archiveLocalKey' : 'cloud.safeguards.archiveKeyRequired')}</p>
          {selected ? <AccountRecoveryKeyInput key={`${generation}:${selected.id}`} disabled={inactive} onRecover={async credential => {
            if (importRequest !== importRun.current) return
            await retrieve(credential)
          }} /> : null}
        </> : <>
          {previewExpired ? <FeedbackMessage type="warning" title={t('cloud.safeguards.expired')} /> : null}
          <Table size="small" pagination={false} rowKey="dataset" dataSource={preview.items} columns={[{ title: t('cloud.dataset'), dataIndex: 'dataset', render: (value: string) => t(`cloud.datasets.${value}`) }, { title: t('cloud.download'), dataIndex: 'download', align: 'right' }, { title: t('cloud.conflicts'), dataIndex: 'conflicts', align: 'right' }]} />
          {preview.conflicts.map(conflict => <div key={conflict.id}><strong>{conflict.name}</strong><Radio.Group disabled={inactive} value={choices[conflict.id]} onChange={event => setChoices(value => ({ ...value, [conflict.id]: event.target.value }))} options={[{ label: t('cloud.keep.local'), value: 'local' }, { label: t('cloud.safeguards.useArchive'), value: 'remote' }]} /></div>)}
          {previewExpired ? <Button disabled={inactive} onClick={() => { feedback.reset(); setPreview(undefined) }}>{t('cloud.retry')}</Button> : null}
          <Button type="primary" loading={inactive} disabled={inactive || previewExpired || preview.conflicts.some(conflict => !choices[conflict.id])} onClick={() => void feedback.perform(async current => { await api.applyArchive(generation, preview.id, choices); if (current()) close() })}>{t('cloud.safeguards.applyRetrieve')}</Button>
        </>}
      </div>
    </FeedbackMessageScope></Modal>
    <Modal open={Boolean(deleting)} title={t('cloud.safeguards.deleteArchive')} footer={null} destroyOnHidden closable={!inactive} mask={{ closable: !inactive }} keyboard={!inactive} onCancel={closeDelete}><FeedbackMessageScope active={Boolean(deleting)}>
      <div className={styles.wizard}><p>{t('cloud.safeguards.deleteArchiveHint')}</p>
        <AccountOperationError code={feedback.errorCode} />
        <Form form={proof} layout="vertical" onFinish={evidence => void feedback.perform(async current => {
          if (!deleting || inactive || mfaEnabled === undefined) return
          const startedPolicy = policy.current
          try {
            await api.reauthenticate(generation, buildCloudStepUpProof(mfaEnabled, evidence))
            if (!current()) return
            if (startedPolicy !== policy.current) throw new Error('mfa_revision_conflict')
            await api.deleteArchive(generation, deleting.id, deleting.revision)
            if (current()) { closeDelete(); await load() }
          } finally { if (current() && startedPolicy === policy.current) proof.resetFields() }
        })}>
          <AccountStepUpFields enabled={mfaEnabled} revision={mfaRevision} disabled={inactive} />
          <Button type="primary" danger htmlType="submit" loading={inactive} disabled={mfaEnabled === undefined}>{t('cloud.safeguards.deleteArchive')}</Button>
        </Form>
      </div>
    </FeedbackMessageScope></Modal>
  </AccountSection>
}

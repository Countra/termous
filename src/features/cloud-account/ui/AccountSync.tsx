import { useState } from 'react'
import { Alert, Button, Empty, Modal, Space, Switch, Table, Tag } from 'antd'
import { Cloud, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudConflict, CloudPreview, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useSettingsModule } from '#entities/settings'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountSync({ api, status, busy, run }: Props) {
  const { t } = useTranslation()
  const settings = useSettingsModule('cloud')
  const [preview, setPreview] = useState<CloudPreview>()
  const [conflicts, setConflicts] = useState<CloudConflict[]>([])
  const [confirming, setConfirming] = useState(false)
  const available = status.device_status === 'active'
  const loading = busy || settings.busy
  const loadPreview = async () => {
    const value = await api.preview(status.generation)
    setPreview(value)
    setConflicts(await api.conflicts())
  }

  return <div className={styles.section}>
    <section className={styles.surface}>
      <div className={styles.row}>
        <Space><Cloud size={19} aria-hidden="true" /><h2>{t('cloud.syncTitle')}</h2></Space>
        <Tag>{t(`cloud.phases.${status.phase}`)}</Tag>
      </div>
      <p className={styles.hint}>{t('cloud.syncHint')}</p>
      {!available ? <Alert type="info" showIcon title={t('cloud.approvalNeeded')} /> : null}
      <div className={styles.row}>
        <div className={styles.identity}><strong id="cloud-auto-sync">{t('cloud.autoSync')}</strong><small>{t(status.confirmed ? 'cloud.autoSyncHint' : 'cloud.confirmFirst')}</small></div>
        <Switch aria-labelledby="cloud-auto-sync" checked={settings.snapshot?.value.auto_sync === true} disabled={!available || !status.confirmed || loading || !settings.snapshot} loading={settings.busy} onChange={(auto_sync) => { void settings.update({ auto_sync }) }} />
      </div>
      {settings.error ? <Alert type="error" title={t('cloud.settingsFailed')} action={<Button onClick={() => void settings.refresh()}>{t('cloud.retry')}</Button>} /> : null}
      <dl className={styles.stats}>
        <div><dt>{t('cloud.lastSuccess')}</dt><dd>{status.last_success ? new Date(status.last_success).toLocaleString() : t('cloud.neverSynced')}</dd></div>
        <div><dt>{t('cloud.pendingChanges')}</dt><dd>{status.pending}</dd></div>
        <div><dt>{t('cloud.conflicts')}</dt><dd>{status.conflicts}</dd></div>
      </dl>
      <div className={styles.actions}>
        <Button type={status.confirmed ? 'default' : 'primary'} disabled={!available || loading} onClick={() => void run(loadPreview)}>{t('cloud.preview')}</Button>
        {status.confirmed ? <Button type="primary" icon={<RefreshCw size={15} />} loading={busy} disabled={!available || loading} onClick={() => void run(async () => { await api.run(status.generation); setConflicts(await api.conflicts()) })}>{t('cloud.syncNow')}</Button> : null}
      </div>
    </section>
    {preview ? <section className={styles.surface}>
      <h3>{t('cloud.previewTitle')}</h3>
      <p className={styles.hint}>{t('cloud.encryptionHint')}</p>
      <Table size="small" rowKey="dataset" pagination={false} dataSource={preview.items} locale={{ emptyText: <Empty description={t('cloud.noChanges')} /> }} columns={[
        { title: t('cloud.dataset'), dataIndex: 'dataset', render: (dataset: string) => t(`cloud.datasets.${dataset}`) },
        { title: t('cloud.upload'), dataIndex: 'upload', align: 'right' },
        { title: t('cloud.download'), dataIndex: 'download', align: 'right' },
        { title: t('cloud.deletion'), dataIndex: 'delete', align: 'right' },
        { title: t('cloud.conflicts'), dataIndex: 'conflicts', align: 'right' },
      ]} />
      <div className={styles.actions}>
        <Button type="primary" disabled={preview.blocked || loading} onClick={() => setConfirming(true)}>{t('cloud.confirmSync')}</Button>
      </div>
    </section> : null}
    {conflicts.length ? <section className={styles.surface}>
      <h3>{t('cloud.conflicts')}</h3><p className={styles.hint}>{t('cloud.conflictHint')}</p>
      {conflicts.map((conflict) => <div className={styles.row} key={conflict.id}>
        <div className={styles.identity}><strong>{conflict.name}</strong><small>{t(`cloud.datasets.${conflict.dataset}`)}{conflict.local_deleted || conflict.remote_deleted ? ` · ${t('cloud.deleteConflict')}` : ''}</small></div>
        <Space wrap>{(['local', 'remote'] as const).map((choice) => <Button key={choice} disabled={loading} onClick={() => void run(async () => { await api.resolve(status.generation, conflict.id, choice); await loadPreview() })}>{t(`cloud.keep.${choice}`)}</Button>)}</Space>
      </div>)}
    </section> : null}
    <Modal open={confirming} title={t('cloud.confirmSync')} confirmLoading={busy} onCancel={() => setConfirming(false)} onOk={() => void run(async () => {
      if (!preview) return
      await api.confirm(status.generation, preview.id)
      setConfirming(false); setPreview(undefined); setConflicts([])
      await settings.update({ auto_sync: true })
    })}><p>{t('cloud.confirmSyncHint')}</p></Modal>
  </div>
}

import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Space, Switch, Table, Tag } from 'antd'
import { Cloud, FileCheck, GitCompareArrows, ListFilter, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudConflict, CloudPreview, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useSettingsModule } from '#entities/settings'
import { WorkspaceEmptyState } from '#shared/ui'
import { AccountSection } from './AccountSection'
import { AccountArchives } from './AccountArchives'
import { AccountWorkspaceRestart } from './AccountWorkspaceRestart'
import { useCloudSafeguards } from '../model/useCloudSafeguards'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountSync({ api, status, busy, run }: Props) {
  const { t } = useTranslation()
  const settings = useSettingsModule('cloud')
  const settingsRefresh = useRef(settings.refresh)
  settingsRefresh.current = settings.refresh
  useEffect(() => { void settingsRefresh.current() }, [status.generation, status.auto_sync])
  const [preview, setPreview] = useState<CloudPreview>()
  const [conflicts, setConflicts] = useState<CloudConflict[]>([])
  const [confirming, setConfirming] = useState(false)
  const generation = status.generation
  const safeguards = useCloudSafeguards(api, generation)
  const lifetime = useRef<{ api: CloudGateway; generation: string; active: boolean } | null>(null)
  useEffect(() => {
    const scope = { api, generation, active: true }
    lifetime.current = scope
    setPreview(undefined); setConflicts([]); setConfirming(false)
    return () => { scope.active = false }
  }, [api, generation])
  const isCurrent = (scope: typeof lifetime.current) => Boolean(scope?.active && scope.api === api && scope.generation === generation && api.getStatus()?.generation === generation)
  const available = status.device_status === 'active'
  const loading = busy || settings.busy
  const safeguardMissing = safeguards.value?.account.recovery_required === true && safeguards.value.account.recovery_ready !== true
  const safeguardUnavailable = safeguardMissing || safeguards.error || safeguards.loading || !safeguards.value
  const canConfirm = available && !loading && !safeguards.error && !safeguards.loading && !safeguardMissing && Boolean(preview && !preview.blocked && preview.generation === generation)
  const loadPreview = async () => {
    const scope = lifetime.current
    if (!isCurrent(scope)) return
    setPreview(undefined); setConflicts([])
    const value = await api.preview(generation)
    if (!isCurrent(scope)) return
    if (value.generation !== generation) throw new Error('CLOUD_RESPONSE_INVALID')
    const items = await api.conflicts()
    // 预览与冲突来自同一次操作，完整读取后才开放确认入口。
    if (!isCurrent(scope)) return
    setPreview(value)
    setConflicts(items)
  }

  return <div className={styles.section}>
    {safeguardMissing ? <Alert type="warning" showIcon title={t('cloud.safeguards.firstTitle')} description={t('cloud.safeguards.firstHint')} /> : null}
    {safeguards.error ? <Alert type="warning" showIcon title={t('cloud.safeguards.readFailed')} action={<Button onClick={() => void safeguards.reload()}>{t('cloud.retry')}</Button>} /> : null}
    <AccountSection title={t('cloud.syncTitle')} icon={<Cloud size={18} />} description={t('cloud.syncHint')} extra={<Tag>{t(`cloud.phases.${status.phase}`)}</Tag>}>
      {!available ? <Alert type="info" showIcon title={t('cloud.approvalNeeded')} /> : null}
      <div className={styles.row}>
        <div className={styles.identity}><strong id="cloud-auto-sync">{t('cloud.autoSync')}</strong><small>{t(status.confirmed ? 'cloud.autoSyncHint' : 'cloud.confirmFirst')}</small></div>
        <Switch aria-labelledby="cloud-auto-sync" checked={settings.snapshot?.value.auto_sync === true} disabled={!available || !status.confirmed || loading || !settings.snapshot || (settings.snapshot.value.auto_sync !== true && safeguardUnavailable)} loading={settings.busy} onChange={(auto_sync) => { void settings.update({ auto_sync }) }} />
      </div>
      {settings.error ? <Alert type="error" title={t('cloud.settingsFailed')} action={<Button onClick={() => void settings.refresh()}>{t('cloud.retry')}</Button>} /> : null}
      <dl className={styles.stats}>
        <div><dt>{t('cloud.lastSuccess')}</dt><dd>{status.last_success ? new Date(status.last_success).toLocaleString() : t('cloud.neverSynced')}</dd></div>
        <div><dt>{t('cloud.pendingChanges')}</dt><dd>{status.pending}</dd></div>
        <div><dt>{t('cloud.conflicts')}</dt><dd>{status.conflicts}</dd></div>
      </dl>
      <div className={styles.actions}>
        <Button type={status.confirmed ? 'default' : 'primary'} icon={<ListFilter size={15} />} disabled={!available || loading} onClick={() => void run(loadPreview)}>{t('cloud.preview')}</Button>
        {status.confirmed ? <Button type="primary" icon={<RefreshCw size={15} />} loading={busy} disabled={!available || loading || safeguardUnavailable} onClick={() => void run(async () => {
          const scope = lifetime.current
          if (!isCurrent(scope)) return
          await api.run(generation)
          if (!isCurrent(scope)) return
          setPreview(undefined)
          const items = await api.conflicts()
          if (isCurrent(scope)) setConflicts(items)
        })}>{t('cloud.syncNow')}</Button> : null}
      </div>
    </AccountSection>
    {preview ? <AccountSection title={t('cloud.previewTitle')} icon={<GitCompareArrows size={18} />} description={t('cloud.encryptionHint')}>
      {preview.blocked ? <Alert type="warning" showIcon title={t(`cloud.errors.${preview.error_code}`, { defaultValue: t('cloud.previewBlocked') })} /> : null}
      <Table size="small" rowKey="dataset" pagination={false} dataSource={preview.items} scroll={{ x: 500 }} locale={{ emptyText: <WorkspaceEmptyState className={styles.empty} icon={<FileCheck size={20} />} title={t('cloud.noChanges')} /> }} columns={[
        { title: t('cloud.dataset'), dataIndex: 'dataset', render: (dataset: string) => t(`cloud.datasets.${dataset}`) },
        { title: t('cloud.upload'), dataIndex: 'upload', align: 'right' },
        { title: t('cloud.download'), dataIndex: 'download', align: 'right' },
        { title: t('cloud.deletion'), dataIndex: 'delete', align: 'right' },
        { title: t('cloud.conflicts'), dataIndex: 'conflicts', align: 'right' },
      ]} />
      <div className={styles.actions}>
        <Button type="primary" disabled={!canConfirm} onClick={() => setConfirming(true)}>{t('cloud.confirmSync')}</Button>
      </div>
    </AccountSection> : null}
    {conflicts.length ? <AccountSection title={t('cloud.conflicts')} icon={<GitCompareArrows size={18} />} description={t('cloud.conflictHint')}>
      <div className={styles.list}>{conflicts.map((conflict) => <div className={styles.row} key={conflict.id}>
        <div className={styles.identity}><strong>{conflict.name}</strong><small>{t(`cloud.datasets.${conflict.dataset}`)}{conflict.local_deleted || conflict.remote_deleted ? ` · ${t('cloud.deleteConflict')}` : ''}</small></div>
        <Space wrap>{(['local', 'remote'] as const).map((choice) => <Button key={choice} disabled={loading} onClick={() => void run(async () => { await api.resolve(status.generation, conflict.id, choice); await loadPreview() })}>{t(`cloud.keep.${choice}`)}</Button>)}</Space>
      </div>)}</div>
    </AccountSection> : null}
    <AccountArchives key={generation} api={api} status={status} busy={busy} mfaEnabled={safeguards.value?.account.mfa_enabled} mfaRevision={safeguards.value?.account.mfa_revision} run={run} />
    <AccountSection title={t('cloud.safeguards.advancedTitle')} icon={<Cloud size={18} />} description={t('cloud.safeguards.advancedHint')}><AccountWorkspaceRestart key={generation} api={api} status={status} busy={busy} mfaEnabled={safeguards.value?.account.mfa_enabled} mfaRevision={safeguards.value?.account.mfa_revision} run={run} /></AccountSection>
    <Modal open={confirming} title={t('cloud.confirmSync')} confirmLoading={loading} okButtonProps={{ disabled: !canConfirm }} onCancel={() => setConfirming(false)} onOk={() => void run(async () => {
      const scope = lifetime.current
      if (!preview || !canConfirm || !isCurrent(scope)) return
      const result = await api.confirm(generation, preview.id)
      // 确认等待期间可能切换账号；后续设置写入不能借用新账号的绑定。
      if (!isCurrent(scope) || result.generation !== generation) return
      setConfirming(false); setPreview(undefined); setConflicts([])
      await settings.update({ auto_sync: true })
    })}><p>{t('cloud.confirmSyncHint')}</p></Modal>
  </div>
}

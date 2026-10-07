import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Switch, Tag } from 'antd'
import { Cloud, ListFilter, RefreshCw, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useSettingsModule } from '#entities/settings'
import { AccountSection } from './AccountSection'
import { AccountArchives } from './AccountArchives'
import { AccountWorkspaceRestart } from './AccountWorkspaceRestart'
import { AccountSyncPreview } from './AccountSyncPreview'
import { useCloudSafeguards } from '../model/useCloudSafeguards'
import { cloudOperationErrorCode } from '../model/useCloudOperationFeedback'
import styles from './CloudAccount.module.scss'
import syncStyles from './AccountSync.module.scss'

interface Props {
  api: CloudGateway
  status: CloudStatus
  busy: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
  onOpenSecurity?: () => void
}

export function AccountSync({ api, status, busy, run, onOpenSecurity }: Props) {
  const { t } = useTranslation()
  const settings = useSettingsModule('cloud')
  const settingsRefresh = useRef(settings.refresh)
  settingsRefresh.current = settings.refresh
  useEffect(() => { void settingsRefresh.current() }, [status.generation, status.auto_sync])
  const [previewMode, setPreviewMode] = useState<'enable' | 'sync'>()
  const generation = status.generation
  const safeguards = useCloudSafeguards(api, generation)
  const lifetime = useRef<{ api: CloudGateway; generation: string; active: boolean } | null>(null)
  useEffect(() => {
    const scope = { api, generation, active: true }
    lifetime.current = scope
    setPreviewMode(undefined)
    return () => { scope.active = false }
  }, [api, generation])
  const isCurrent = (scope: typeof lifetime.current) => Boolean(scope?.active && scope.api === api && scope.generation === generation && api.getStatus()?.generation === generation)
  const available = status.authenticated && status.device_status === 'active'
  const loading = busy || settings.busy
  const automatic = settings.snapshot?.value.auto_sync === true
  const safeguardMissing = safeguards.value?.account.recovery_required === true && safeguards.value.account.recovery_ready !== true
  const safeguardUnavailable = safeguardMissing || safeguards.error || safeguards.loading || !safeguards.value
  const settingsUnavailable = !settings.available || !settings.snapshot || settings.snapshot.state.status === 'unavailable'
  const blockingReason = !available ? t('cloud.approvalNeeded')
    : safeguards.error ? t('cloud.safeguards.readFailed')
      : safeguards.loading || !safeguards.value ? t('cloud.loading')
        : safeguardMissing ? t('cloud.safeguards.firstHint') : undefined

  const enable = async () => {
    const scope = lifetime.current
    if (!isCurrent(scope)) return false
    const result = await settings.update({ auto_sync: true }, settings.snapshot?.revision)
    return isCurrent(scope) && result?.value.auto_sync === true
  }
  const syncNow = () => void run(async () => {
    const scope = lifetime.current
    if (!isCurrent(scope)) return
    try {
      const result = await api.run(generation)
      if (isCurrent(scope) && result.conflicts > 0) setPreviewMode('sync')
    } catch (cause) {
      // HTTP 业务错误可先于 WS 状态到达；缓存中的旧冲突也不能掩盖其他失败。
      if (isCurrent(scope) && cloudOperationErrorCode(cause, code => code === 'conflicts_pending') === 'conflicts_pending') setPreviewMode('sync')
      else throw cause
    }
  })

  return <div className={styles.section}>
    <AccountSection title={t('cloud.syncTitle')} icon={<Cloud size={18} />} description={t('cloud.syncHint')} extra={<Tag>{t(`cloud.phases.${status.phase}`)}</Tag>}>
      {!available ? <Alert type="info" showIcon title={t('cloud.approvalNeeded')} /> : null}
      {safeguardMissing ? <Alert type="warning" showIcon title={t('cloud.safeguards.firstTitle')} description={t('cloud.safeguards.firstHint')} action={onOpenSecurity ? <Button onClick={onOpenSecurity}>{t('cloud.syncFlow.setupRecovery')}</Button> : undefined} /> : null}
      {safeguards.error ? <Alert type="warning" showIcon title={t('cloud.safeguards.readFailed')} action={<Button onClick={() => void safeguards.reload()}>{t('cloud.retry')}</Button>} /> : null}
      <div className={styles.row}>
        <div className={styles.identity}><strong id="cloud-auto-sync">{t('cloud.autoSync')}</strong><small>{t(status.confirmed ? 'cloud.autoSyncHint' : 'cloud.syncFlow.enableHint')}</small></div>
        <Switch aria-labelledby="cloud-auto-sync" checked={automatic} disabled={loading || settingsUnavailable || (!automatic && (!available || safeguardUnavailable))} loading={settings.busy} onChange={(auto_sync) => {
          if (auto_sync && !status.confirmed) setPreviewMode('enable')
          else void run(async () => {
            const scope = lifetime.current
            if (!isCurrent(scope)) return
            await settings.update({ auto_sync }, settings.snapshot?.revision)
          })
        }} />
      </div>
      {settings.error || (!settings.busy && settingsUnavailable) ? <Alert type="error" showIcon title={t(settingsUnavailable ? 'cloud.syncFlow.settingsUnavailable' : 'cloud.settingsFailed')} action={<Button disabled={loading} onClick={() => void settings.refresh()}>{t('cloud.retry')}</Button>} /> : null}
      <dl className={styles.stats}>
        <div><dt>{t('cloud.lastSuccess')}</dt><dd>{status.last_success ? new Date(status.last_success).toLocaleString() : t('cloud.neverSynced')}</dd></div>
        <div><dt>{t('cloud.pendingChanges')}</dt><dd>{status.pending}</dd></div>
        <div><dt>{t('cloud.conflicts')}</dt><dd>{status.conflicts}</dd></div>
      </dl>
      <div className={styles.actions}>
        <Button type="primary" icon={<RefreshCw size={15} />} loading={busy} disabled={!available || loading || safeguardUnavailable || (!status.confirmed && settingsUnavailable)} onClick={() => {
          if (!status.confirmed) setPreviewMode('enable')
          else if (status.conflicts > 0) setPreviewMode('sync')
          else syncNow()
        }}>{t(!status.confirmed ? 'cloud.syncFlow.enable' : status.conflicts > 0 ? 'cloud.syncFlow.resolve' : 'cloud.syncNow')}</Button>
        <Button icon={<ListFilter size={15} />} disabled={!available || loading} onClick={() => setPreviewMode(status.confirmed ? 'sync' : 'enable')}>{t('cloud.preview')}</Button>
      </div>
    </AccountSection>
    <AccountArchives key={generation} api={api} status={status} busy={busy} mfaEnabled={safeguards.value?.account.mfa_enabled} mfaRevision={safeguards.value?.account.mfa_revision} run={run} />
    <section className={syncStyles.advanced} aria-label={t('cloud.safeguards.advancedTitle')}>
      <span className={syncStyles.icon} aria-hidden="true"><Settings2 size={18} /></span>
      <div className={syncStyles.copy}><h2>{t('cloud.safeguards.advancedTitle')}</h2><p>{t('cloud.safeguards.advancedHint')}</p></div>
      <AccountWorkspaceRestart key={generation} api={api} status={status} busy={busy} mfaEnabled={safeguards.value?.account.mfa_enabled} mfaRevision={safeguards.value?.account.mfa_revision} run={run} />
    </section>
    <AccountSyncPreview key={`preview-${generation}`} api={api} status={status} open={previewMode !== undefined} enableAutoSync={previewMode === 'enable'} busy={loading} blockingReason={blockingReason} onRetryBlocking={available && safeguards.error ? () => void safeguards.reload() : undefined} settingsUnavailable={settingsUnavailable} run={run} onEnable={enable} onReloadSettings={() => void settings.refresh()} onClose={() => setPreviewMode(undefined)} />
  </div>
}

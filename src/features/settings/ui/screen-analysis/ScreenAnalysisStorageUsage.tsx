import { useTranslation } from 'react-i18next'
import type { AnalysisStorageUsage } from '#entities/screen-analysis'
import { SettingsDetails } from '../controls/SettingsGroup'
import styles from '../controls/SettingsGroup.module.scss'
import layout from './ScreenAnalysisSettings.module.scss'

export function ScreenAnalysisStorageUsage({ usage }: { usage: AnalysisStorageUsage }) {
  const { t } = useTranslation()
  // 后端总量已包含待清理文件，进度条不重复计费；内容明细只显示仍被引用的部分。
  const bytes = usage.content_bytes
  const contentBytes = Math.max(0, bytes - usage.pending_bytes)
  const mb = (value: number) => (value / 1024 ** 2).toFixed(2)
  return <div className={layout['storage-usage']}>
    <div className={layout['usage-heading']}>
      <span>{t('settings.screenAnalysis.storageUsage')}</span>
      <span>{t('settings.screenAnalysis.storageCapacity', { used: mb(bytes), total: mb(usage.policy.max_bytes) })}</span>
    </div>
    <progress className={layout['usage-meter']} value={Math.min(bytes, usage.policy.max_bytes)} max={usage.policy.max_bytes}
      aria-label={t('settings.screenAnalysis.storageUsage')} />
    <dl className={layout['usage-metrics']}>
      <div><dt>{t('settings.screenAnalysis.recordCount')}</dt><dd>{usage.records}</dd></div>
      <div><dt>{t('settings.screenAnalysis.contentUsage')}</dt><dd>{mb(contentBytes)} <span>MiB</span></dd></div>
      <div><dt>{t('settings.screenAnalysis.pendingUsage')}</dt><dd>{mb(usage.pending_bytes)} <span>MiB</span></dd></div>
    </dl>
    <SettingsDetails summary={t('settings.screenAnalysis.databaseDetails')}>
      <p className={styles.hint}>{t('analysisCenter.databaseUsage', { db: mb(usage.database_bytes), wal: mb(usage.wal_bytes), free: mb(usage.free_page_bytes) })}</p>
    </SettingsDetails>
  </div>
}

import { Alert, Avatar, Button, Empty, Spin, Tabs, Tag } from 'antd'
import { ArrowRight, LogOut, Monitor, ShieldCheck, UserRound } from 'lucide-react'
import type { CloudTab } from '#common/contracts'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import { AccountAuth, AccountDevices, AccountProfile, AccountSecurity, AccountSync, useCloudAccount, type CloudProfileController } from '#features/cloud-account'
import styles from './AccountPage.module.scss'

interface Props {
  api: CloudGateway
  profile: CloudProfileController
  onUseOffline: () => void
  activeTab: CloudTab
  onTabChange: (tab: CloudTab) => void
}

export function AccountPage({ api, profile, onUseOffline, activeTab, onTabChange }: Props) {
  const { t } = useTranslation()
  const { status, busy, error, run, refresh } = useCloudAccount(api)
  const offline = <div className={styles.offline}>
    <Button block icon={<Monitor size={16} />} disabled={busy} onClick={onUseOffline}>{t('cloud.useOffline')}<ArrowRight size={15} aria-hidden="true" /></Button>
    <p>{t('cloud.offlineHint')}</p>
  </div>
  if (!status) return <div className={styles.page}><section className={styles['login-surface']}>
    <div className={styles['login-brand']}><img src="./termous-icon.png" alt="" /><span>Termous</span></div>
    {error ? <Alert type="warning" title={t('cloud.loadFailed')} action={<Button onClick={() => void refresh()}>{t('cloud.retry')}</Button>} /> : <Spin />}
    {offline}
  </section></div>
  const loggedIn = status.authenticated

  return <div className={styles.page}>
    {loggedIn ? <header className={styles.header}>
      <div className={styles.heading}><UserRound size={22} aria-hidden="true" /><h1>{t('nav.account')}</h1></div>
      <Button icon={<LogOut size={15} />} loading={busy} onClick={() => void run(() => api.logout(status.generation))}>{t('cloud.logout')}</Button>
    </header> : null}
    {error || status.error_code ? <Alert type="warning" showIcon title={t(`cloud.errors.${error ?? status.error_code}`, { defaultValue: t('cloud.operationFailed') })} /> : null}
    {!loggedIn ? <section className={styles['login-surface']}>
      <div className={styles['login-brand']}><img src="./termous-icon.png" alt="" /><span>Termous</span></div>
      {status.configured ? <AccountAuth api={api} generation={status.generation} busy={busy} run={run} /> : <Empty description={t('cloud.unconfigured')} />}
      {offline}
    </section>
        : <>
          <section className={styles.profile}>
            <div className={styles.identity}><Avatar size={48} src={profile.profile?.avatar || undefined} icon={<UserRound size={22} />} /><div><strong>{profile.profile?.name || status.email}</strong><p>{profile.profile?.name ? status.email : status.origin}</p></div></div>
            <Tag icon={<ShieldCheck size={12} />}>{t(status.device_status === 'active' ? 'cloud.trusted' : 'cloud.pendingApproval')}</Tag>
          </section>
          <Tabs key={status.generation} activeKey={activeTab} onChange={(tab) => {
            if (tab === 'profile' || tab === 'sync' || tab === 'devices' || tab === 'security') onTabChange(tab)
          }} items={[
            { key: 'profile', label: t('cloud.tabs.profile'), children: <AccountProfile {...profile} email={status.email} /> },
            { key: 'sync', label: t('cloud.tabs.sync'), children: <AccountSync api={api} status={status} busy={busy} run={run} /> },
            { key: 'devices', label: t('cloud.tabs.devices'), children: <AccountDevices api={api} status={status} busy={busy} run={run} /> },
            { key: 'security', label: t('cloud.tabs.security'), children: <AccountSecurity api={api} status={status} busy={busy} run={run} /> },
          ]} />
        </>}
  </div>
}

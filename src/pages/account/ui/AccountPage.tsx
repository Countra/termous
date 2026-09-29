import { Alert, Avatar, Button, Empty, Spin, Tabs, Tag } from 'antd'
import { LogOut, ShieldCheck, UserRound } from 'lucide-react'
import type { CloudTab } from '#common/contracts'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import { AccountAuth, AccountDevices, AccountProfile, AccountSecurity, AccountSync, useCloudAccount, useCloudProfile } from '#features/cloud-account'
import styles from './AccountPage.module.scss'

export function AccountPage({ api, initialTab = 'sync' }: { api: CloudGateway; initialTab?: CloudTab }) {
  const { t } = useTranslation()
  const { status, busy, error, run, refresh } = useCloudAccount(api)
  const profile = useCloudProfile(api, status?.generation ?? '', status?.authenticated ? status.user_id : undefined)
  if (!status) return <div className={styles.page}>{error ? <Alert type="error" title={t('cloud.loadFailed')} action={<Button onClick={() => void refresh()}>{t('cloud.retry')}</Button>} /> : <Spin />}</div>
  const loggedIn = status.authenticated

  return <div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.heading}><UserRound size={22} aria-hidden="true" /><h1>{t('nav.account')}</h1></div>
      {loggedIn ? <Button icon={<LogOut size={15} />} loading={busy} onClick={() => void run(() => api.logout(status.generation))}>{t('cloud.logout')}</Button> : null}
    </header>
    {error || status.error_code ? <Alert type="warning" showIcon title={t(`cloud.errors.${error ?? status.error_code}`, { defaultValue: t('cloud.operationFailed') })} /> : null}
    {!status.configured ? <section className={styles.surface}><Empty description={t('cloud.unconfigured')} /></section>
      : !loggedIn ? <section className={styles.surface}><AccountAuth api={api} generation={status.generation} busy={busy} run={run} /></section>
        : <>
          <section className={styles.profile}>
            <div className={styles.identity}><Avatar size={48} src={profile.profile?.avatar || undefined} icon={<UserRound size={22} />} /><div><strong>{profile.profile?.name || status.email}</strong><p>{profile.profile?.name ? status.email : status.origin}</p></div></div>
            <Tag icon={<ShieldCheck size={12} />}>{t(status.device_status === 'active' ? 'cloud.trusted' : 'cloud.pendingApproval')}</Tag>
          </section>
          <Tabs key={`${status.generation}:${initialTab}`} defaultActiveKey={initialTab} items={[
            { key: 'profile', label: t('cloud.tabs.profile'), children: <AccountProfile {...profile} email={status.email} /> },
            { key: 'sync', label: t('cloud.tabs.sync'), children: <AccountSync api={api} status={status} busy={busy} run={run} /> },
            { key: 'devices', label: t('cloud.tabs.devices'), children: <AccountDevices api={api} status={status} busy={busy} run={run} /> },
            { key: 'security', label: t('cloud.tabs.security'), children: <AccountSecurity api={api} status={status} busy={busy} run={run} /> },
          ]} />
        </>}
  </div>
}

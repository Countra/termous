import { useState, type ReactNode } from 'react'
import { Alert, Avatar, Button, Modal, Popconfirm, Skeleton, Tabs, Tag, Tooltip } from 'antd'
import { ArrowRight, Cloud, CloudOff, Laptop, LogOut, Monitor, ShieldCheck, ShieldX, UserRound } from 'lucide-react'
import type { CloudTab, CloudAuthorizationTarget } from '#common/contracts'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import { isCloudConnectionError } from '#entities/cloud'
import { SettingsGatewayContext, type SettingsGateway } from '#entities/settings'
import { AccountAuth, AccountDevices, AccountProfile, AccountSecurity, AccountSync, useCloudAccount, type CloudProfileController } from '#features/cloud-account'
import { WorkspaceEmptyState } from '#shared/ui'
import styles from './AccountPage.module.scss'

interface Props {
  api: CloudGateway
  settingsGateway: SettingsGateway
  profile: CloudProfileController
  onUseOffline: () => void
  activeTab: CloudTab
  onTabChange: (tab: CloudTab) => void
  authorizationTarget?: CloudAuthorizationTarget
  onOpenAuthorization?: (value: CloudAuthorizationTarget) => void
}

export function AccountPage({ api, settingsGateway, profile, onUseOffline, activeTab, onTabChange, authorizationTarget, onOpenAuthorization }: Props) {
  const { t } = useTranslation()
  const { status, busy, error, run, refresh } = useCloudAccount(api)
  const [reauthGeneration, setReauthGeneration] = useState<string>()
  const offline = <div className={styles.offline}>
    <Button block icon={<Monitor size={16} />} disabled={busy} onClick={onUseOffline}>{t('cloud.useOffline')}<ArrowRight size={15} aria-hidden="true" /></Button>
    <p>{t('cloud.offlineHint')}</p>
  </div>
  const loggedIn = status?.authenticated
  const disconnected = loggedIn && isCloudConnectionError(status?.error_code)
  const needsVerification = loggedIn && status?.error_code === 'refresh_unconfirmed'
  const failedWhileDisconnected = status?.phase === 'ready' && !status.error_code && isCloudConnectionError(error)
  const feedback = error || status?.error_code ? <Alert type="warning" showIcon
      title={disconnected ? t('cloud.connectionUnavailable') : failedWhileDisconnected ? t('cloud.operationFailed') : t(`cloud.errors.${error ?? status?.error_code}`, { defaultValue: t('cloud.operationFailed') })}
      description={disconnected ? t('cloud.connectionRetryHint') : undefined}
      action={needsVerification && status ? <Button disabled={busy} onClick={() => setReauthGeneration(status.generation)}>{t('cloud.reconnectAccount')}</Button> : undefined}
    /> : null

  if (!status || !loggedIn) return <div className={styles['login-page']}>
    <section className={styles['login-surface']} aria-label={t('cloud.signInAccount')}>
      <div className={styles['login-brand']}><img src="./termous-icon.png" alt="" /><span>Termous</span></div>
      {status ? <>
        {feedback}
        {status.configured ? <AccountAuth key={status.generation} api={api} generation={status.generation} busy={busy} run={run} />
          : <WorkspaceEmptyState icon={<CloudOff size={20} />} title={t('cloud.unconfiguredTitle')} description={t('cloud.unconfigured')} />}
      </> : error ? <WorkspaceEmptyState icon={<CloudOff size={20} />} title={t('cloud.loadFailed')} action={<Button onClick={() => void refresh()}>{t('cloud.retry')}</Button>} />
        : <div role="status" aria-label={t('cloud.loading')}><Skeleton active paragraph={{ rows: 3 }} /></div>}
      {offline}
      {status?.device_status === 'active' && status.binding_id ? <Popconfirm title={t('cloud.authorization.emergencyConfirm')} onConfirm={() => run(() => api.emergencyFreeze(status.generation))}><Button danger disabled={busy}>{t('cloud.authorization.emergency')}</Button></Popconfirm> : null}
    </section>
  </div>

  const name = profile.profile?.name || status.email || t('nav.account')
  const deviceLabel = t(status.device_status === 'active' ? 'cloud.trusted' : status.device_status === 'revoked' ? 'cloud.deviceStates.revoked' : 'cloud.pendingApproval')
  const label = (tab: CloudTab, icon: ReactNode) => <span className={styles['tab-label']}><span aria-hidden="true">{icon}</span>{t(`cloud.tabs.${tab}`)}</span>
  const panel = (content: ReactNode) => <div className={styles['tab-scroll']}><div className={styles['tab-content']}>{content}</div></div>

  return <div className={styles.page}>
    <header className={styles.header}>
      <h1>{t('nav.account')}</h1>
      <Button type="text" icon={<LogOut size={15} />} loading={busy} onClick={() => void run(() => api.logout(status.generation))}>{t('cloud.logout')}</Button>
    </header>
    <section className={styles.overview} aria-label={t('cloud.accountOverview')}>
      <div className={styles.identity}>
        <Avatar className={styles.avatar} size={44} src={profile.profile?.avatar || undefined} icon={<UserRound size={22} />} />
        <div className={styles['identity-text']}><Tooltip title={name}><strong>{name}</strong></Tooltip>{profile.profile?.name && status.email ? <p title={status.email}>{status.email}</p> : <p>{t('cloud.accountConnected')}</p>}</div>
      </div>
      <Tag className={styles.trust} icon={status.device_status === 'revoked' ? <ShieldX size={13} /> : <ShieldCheck size={13} />}>{deviceLabel}</Tag>
    </section>
    {feedback}
    {status.error_code === 'login_required' || status.error_code === 'refresh_unconfirmed' ? <Popconfirm title={t('cloud.authorization.emergencyConfirm')} onConfirm={() => run(() => api.emergencyFreeze(status.generation))}><Button danger disabled={busy || status.device_status !== 'active'}>{t('cloud.authorization.emergency')}</Button></Popconfirm> : null}
    <Modal key={`reauth-${status.generation}`} open={reauthGeneration === status.generation} title={t('cloud.reconnectAccount')} footer={null} destroyOnHidden onCancel={() => setReauthGeneration(undefined)}>
      {error ? <Alert type="warning" showIcon title={t(`cloud.errors.${error}`, { defaultValue: t('cloud.operationFailed') })} /> : null}
      <AccountAuth key={status.generation} api={api} generation={status.generation} email={status.email} reauthenticate busy={busy} run={run} />
    </Modal>
    <Tabs className={styles.tabs} key={`tabs-${status.generation}`} activeKey={activeTab} onChange={(tab) => {
      if (tab === 'profile' || tab === 'sync' || tab === 'devices' || tab === 'security') onTabChange(tab)
    }} items={[
      { key: 'profile', label: label('profile', <UserRound size={15} />), children: panel(<AccountProfile {...profile} email={status.email} />) },
      { key: 'sync', label: label('sync', <Cloud size={15} />), children: panel(<SettingsGatewayContext value={settingsGateway}><AccountSync api={api} status={status} busy={busy} run={run} onOpenSecurity={() => onTabChange('security')} /></SettingsGatewayContext>) },
      { key: 'devices', label: label('devices', <Laptop size={15} />), children: panel(<AccountDevices api={api} status={status} target={authorizationTarget} onOpenAuthorization={onOpenAuthorization} busy={busy} run={run} />) },
      { key: 'security', label: label('security', <ShieldCheck size={15} />), children: panel(<AccountSecurity api={api} status={status} busy={busy} run={run} />) },
    ]} />
  </div>
}

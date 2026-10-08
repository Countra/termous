import { useState, type ReactNode } from 'react'
import { Avatar, Button, Modal, Skeleton, Tabs, Tag, Tooltip } from 'antd'
import { ChevronDown, Cloud, CloudOff, Ellipsis, KeyRound, Laptop, LogOut, ShieldCheck, ShieldX, UserRound } from 'lucide-react'
import type { CloudTab, CloudAuthorizationTarget } from '#common/contracts'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import { isCloudConnectionError } from '#entities/cloud'
import { SettingsGatewayContext, type SettingsGateway } from '#entities/settings'
import { AccountAuth, AccountDevices, AccountEmergencyRecovery, AccountProfile, AccountSecurity, AccountSync, useCloudAccount, type CloudProfileController } from '#features/cloud-account'
import { WorkspaceEmptyState, FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { RemoteAccountAccess } from '#features/remote-control'
import { AccountLoginLayout } from './AccountLoginLayout'
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
  const loggedIn = status?.authenticated
  const emergencyAvailable = status?.device_status === 'active' && Boolean(status.binding_id)
    && (!loggedIn || status.error_code === 'login_required' || status.error_code === 'refresh_unconfirmed')
  const disconnected = loggedIn && isCloudConnectionError(status?.error_code)
  const needsVerification = loggedIn && status?.error_code === 'refresh_unconfirmed'
  const failedWhileDisconnected = status?.phase === 'ready' && !status.error_code && isCloudConnectionError(error)
  const feedback = error || status?.error_code ? <FeedbackMessage type="warning"
      title={disconnected ? t('cloud.connectionUnavailable') : failedWhileDisconnected ? t('cloud.operationFailed') : t(`cloud.errors.${error ?? status?.error_code}`, { defaultValue: t('cloud.operationFailed') })}
      description={disconnected ? t('cloud.connectionRetryHint') : undefined}
    /> : null

  if (!status || !loggedIn) return <FeedbackMessageScope scope={status?.generation ?? 'account'}>
    <AccountLoginLayout busy={busy} onUseOffline={onUseOffline} securityAction={emergencyAvailable && status ? <AccountEmergencyRecovery key={status.generation} api={api} generation={status.generation} busy={busy} run={run}>
      <Button type="text" icon={<ShieldCheck size={15} />} disabled={busy} aria-haspopup="menu">{t('cloud.authorization.securityOptions')}<ChevronDown size={13} aria-hidden="true" /></Button>
    </AccountEmergencyRecovery> : null}>
      {feedback}
      {status ? <>
        {status.configured ? <AccountAuth key={status.generation} api={api} generation={status.generation} busy={busy} run={run} />
          : <WorkspaceEmptyState icon={<CloudOff size={20} />} title={t('cloud.unconfiguredTitle')} description={t('cloud.unconfigured')} />}
      </> : error ? <WorkspaceEmptyState icon={<CloudOff size={20} />} title={t('nav.account')} action={<Button onClick={() => void refresh()}>{t('cloud.retry')}</Button>} />
        : <div role="status" aria-label={t('cloud.loading')}><Skeleton active paragraph={{ rows: 3 }} /></div>}
    </AccountLoginLayout>
  </FeedbackMessageScope>

  const name = profile.profile?.name || status.email || t('nav.account')
  const deviceLabel = t(status.device_status === 'active' ? 'cloud.trusted' : status.device_status === 'revoked' ? 'cloud.deviceStates.revoked' : 'cloud.pendingApproval')
  const label = (tab: CloudTab, icon: ReactNode) => <span className={styles['tab-label']}><span aria-hidden="true">{icon}</span>{t(`cloud.tabs.${tab}`)}</span>
  const panel = (tab: CloudTab, content: ReactNode) => <FeedbackMessageScope active={activeTab === tab}><div className={styles['tab-scroll']}><div className={styles['tab-content']}>{content}</div></div></FeedbackMessageScope>

  return <FeedbackMessageScope scope={status.generation}><div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.identity}>
        <Avatar className={styles.avatar} size={48} src={profile.profile?.avatar || undefined} icon={<UserRound size={24} />} />
        <div className={styles['identity-text']}><Tooltip title={name}><h1>{name}</h1></Tooltip><p title={status.email}>{profile.profile?.name && status.email ? status.email : t('cloud.accountConnected')}</p></div>
      </div>
      <div className={styles['header-actions']}>
        <Tag className={styles.trust} icon={status.device_status === 'revoked' ? <ShieldX size={13} /> : <ShieldCheck size={13} />}>{deviceLabel}</Tag>
        {needsVerification ? <Button icon={<KeyRound size={15} />} disabled={busy} onClick={() => setReauthGeneration(status.generation)}>{t('cloud.reconnectAccount')}</Button> : null}
        <Button type="text" icon={<LogOut size={15} />} loading={busy} onClick={() => void run(() => api.logout(status.generation))}>{t('cloud.logout')}</Button>
        {emergencyAvailable ? <AccountEmergencyRecovery key={status.generation} api={api} generation={status.generation} busy={busy} run={run}>
          <Button type="text" icon={<Ellipsis size={18} />} disabled={busy} aria-label={t('cloud.authorization.moreActions')} aria-haspopup="menu" />
        </AccountEmergencyRecovery> : null}
      </div>
    </header>
    {feedback}
    <Modal key={`reauth-${status.generation}`} open={reauthGeneration === status.generation} width={460} centered title={t('cloud.reconnectAccount')} footer={null} destroyOnHidden closable={!busy} mask={{ closable: !busy }} keyboard={!busy} onCancel={() => { if (!busy) setReauthGeneration(undefined) }}><FeedbackMessageScope active={Boolean(reauthGeneration === status.generation)}>
      {error ? <FeedbackMessage type="warning" title={t(`cloud.errors.${error}`, { defaultValue: t('cloud.operationFailed') })} /> : null}
      <AccountAuth key={status.generation} api={api} generation={status.generation} email={status.email} reauthenticate busy={busy} run={run} />
    </FeedbackMessageScope></Modal>
    <Tabs className={styles.tabs} key={`tabs-${status.generation}`} activeKey={activeTab} onChange={(tab) => {
      if (tab === 'profile' || tab === 'sync' || tab === 'devices' || tab === 'security') onTabChange(tab)
    }} items={[
      { key: 'profile', label: label('profile', <UserRound size={15} />), children: panel('profile', <AccountProfile {...profile} email={status.email} />) },
      { key: 'sync', label: label('sync', <Cloud size={15} />), children: panel('sync', <SettingsGatewayContext value={settingsGateway}><AccountSync api={api} status={status} busy={busy} run={run} onOpenSecurity={() => onTabChange('security')} /></SettingsGatewayContext>) },
      { key: 'devices', label: label('devices', <Laptop size={15} />), children: panel('devices', <RemoteAccountAccess key={status.generation} generation={status.generation} currentDevice={status.device_id ?? ''} trusted={status.device_status === 'active'}>{renderDeviceActions => <AccountDevices api={api} status={status} target={authorizationTarget} onOpenAuthorization={onOpenAuthorization} busy={busy} run={run} renderDeviceActions={renderDeviceActions} />}</RemoteAccountAccess>) },
      { key: 'security', label: label('security', <ShieldCheck size={15} />), children: panel('security', <AccountSecurity api={api} status={status} busy={busy} run={run} />) },
    ]} />
  </div></FeedbackMessageScope>
}

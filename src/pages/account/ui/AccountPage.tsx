import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Avatar, Button, Tabs, Tag, Tooltip } from 'antd'
import { Cloud, Ellipsis, KeyRound, Laptop, LogOut, ShieldCheck, ShieldX, UserRound } from 'lucide-react'
import type { CloudTab, CloudAuthorizationTarget } from '#common/contracts'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import { isCloudConnectionError } from '#entities/cloud'
import { SettingsGatewayContext, type SettingsGateway } from '#entities/settings'
import { AccountDevices, AccountEmergencyRecovery, AccountProfile, AccountSecurity, AccountSync, useCloudAccount, type CloudProfileController } from '#features/cloud-account'
import { FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { RemoteAccountAccess } from '#features/remote-control'
import { AccountAuthDialog } from './AccountAuthDialog'
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

export function AccountPage(props: Props) {
  const status = useSyncExternalStore(props.api.subscribeStatus, props.api.getStatus)
  return status?.authenticated ? <AccountWorkspace {...props} /> : <AccountAuthDialog api={props.api} onClose={props.onUseOffline} />
}

function AccountWorkspace({ api, settingsGateway, profile, activeTab, onTabChange, authorizationTarget, onOpenAuthorization }: Props) {
  const { t } = useTranslation()
  const { status, busy, error, run } = useCloudAccount(api)
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

  if (!status || !loggedIn) return null

  const name = profile.profile?.name || status.email || t('nav.account')
  const deviceLabel = t(status.device_status === 'active' ? 'cloud.trusted' : status.device_status === 'revoked' ? 'cloud.deviceStates.revoked' : 'cloud.pendingApproval')
  const label = (tab: CloudTab, icon: ReactNode) => <span className={styles['tab-label']}><span aria-hidden="true">{icon}</span>{t(`cloud.tabs.${tab}`)}</span>
  const panel = (tab: CloudTab, content: ReactNode) => <FeedbackMessageScope active={activeTab === tab}><div className={styles['tab-scroll']} data-tour={`account-${tab}`}><div className={styles['tab-content']}>{content}</div></div></FeedbackMessageScope>

  return <FeedbackMessageScope scope={status.generation}><div className={styles.page} data-tour="account-workspace">
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
    {reauthGeneration !== status.generation ? feedback : null}
    {reauthGeneration === status.generation ? <AccountAuthDialog key={`reauth-${status.generation}`} api={api} reauthenticate onClose={() => setReauthGeneration(undefined)} /> : null}
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

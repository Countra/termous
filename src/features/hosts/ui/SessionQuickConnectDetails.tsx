import { CircleAlert, CircleCheck, FolderOpen, MonitorPlay, Star, Terminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Host } from '#entities/host'
import { formatSSHProfileEndpoint } from '../model/hostDirectory.ts'
import { formatDateTime } from '../model/hostLauncherListModel.ts'
import type { SessionProfileQuickConnectItem } from '../model/sessionProfileQuickConnect.ts'
import styles from './SessionQuickConnectDetails.module.scss'

export function SSHQuickConnectDetails({ host }: { host: Host }) {
  const { t } = useTranslation()
  return (
    <DetailsCard name={host.name} technology="SSH" icon={<Terminal size={16} />}
      endpoint={formatSSHProfileEndpoint(host)}
      marker={host.favorite ? <><Star size={11} />{t('workbench.hostLauncher.favorite')}</> : undefined}
    >
      <DetailRow label={t('hosts.authMethod')}>{t(`hosts.auth.${host.auth_method}`)}</DetailRow>
      <DetailRow label={t('hosts.platform.label')}>{t(`hosts.platform.${host.platform}`)}</DetailRow>
      {host.last_connected_at && <DetailRow label={t('workbench.hostLauncher.lastConnected')}>
        {formatDateTime(host.last_connected_at, t('fields.none'))}
      </DetailRow>}
      {host.note?.trim() && <DetailRow label={t('hosts.note')}><span className={styles.note}>{host.note}</span></DetailRow>}
    </DetailsCard>
  )
}

export function ProfileQuickConnectDetails({ item }: { item: SessionProfileQuickConnectItem }) {
  const { t } = useTranslation()
  const { profile, host, unavailableReason } = item
  const warning = unavailableReason
    ? t(unavailableReason === 'host_missing' ? 'workbench.quickConnect.profiles.hostMissing' : 'workbench.hostLauncher.profiles.routeMissing')
    : undefined
  return (
    <DetailsCard name={profile.name} technology={profile.technology.toUpperCase()}
      icon={profile.intent === 'files' ? <FolderOpen size={16} /> : <MonitorPlay size={16} />}
      endpoint={profile.endpoint} warning={warning}
      marker={profile.isDefault ? <><CircleCheck size={11} />{t('hosts.access.default')}</> : undefined}
    >
      <DetailRow label={t('workbench.quickConnect.details.host')}>
        {host?.name ?? t(profile.hostId ? 'workbench.quickConnect.profiles.hostMissing' : 'workbench.quickConnect.details.standalone')}
      </DetailRow>
      {profile.route ? <DetailRow label={t('workbench.hostLauncher.profiles.details.route')}>
        <span className={styles.route}>
          <span>{profile.route.name}</span>
          {profile.route.endpoint !== profile.endpoint && <small>{profile.route.endpoint}</small>}
        </span>
      </DetailRow> : profile.intent === 'remote_desktop' && profile.availability === 'ready'
        ? <DetailRow label={t('workbench.hostLauncher.profiles.details.route')}>{t('workbench.hostLauncher.profiles.details.direct')}</DetailRow>
        : null}
    </DetailsCard>
  )
}

function DetailsCard({ name, technology, icon, endpoint, marker, warning, children }: {
  name: string
  technology: string
  icon: ReactNode
  endpoint: string
  marker?: ReactNode
  warning?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className={styles.card}>
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden="true">{icon}</span>
        <div className={styles.title}>
          <strong>{name}</strong>
          {marker && <small className={styles.marker}>{marker}</small>}
        </div>
        <span className={styles.technology}>{technology}</span>
      </header>
      {endpoint && <div className={styles.endpoint}>
        <span>{t('workbench.hostLauncher.profiles.details.endpoint')}</span>
        <code>{endpoint}</code>
      </div>}
      <dl className={styles.facts}>{children}</dl>
      {warning && <p className={styles.warning}><CircleAlert size={13} aria-hidden="true" /><span>{warning}</span></p>}
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

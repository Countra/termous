import { Button, Tooltip } from 'antd'
import {
  FileKey2,
  FolderSync,
  MonitorPlay,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  projectFileAccessProfile,
  type FileAccessProfile,
} from '#entities/file-access-profile'
import type { HostAccessCatalog } from '#entities/host-asset'
import type { HostReachability } from '#entities/host'
import {
  projectRemoteDesktopAccessProfile,
  type RemoteDesktopAccessProfile,
} from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { SSHProfileReachabilityIndex } from '../model/sshProfileReachability.ts'
import styles from './HostAccess.module.scss'

interface AccessProfileCatalogProps {
  catalog: HostAccessCatalog
  busy: boolean
  sshReachability: SSHProfileReachabilityIndex
  refreshingSSHProfileIds: ReadonlySet<string>
  reachabilityError?: string
  onRefreshSSHReachability: (profileId: string) => void
  onCreateSSH: () => void
  onEditSSH: (profile: SSHAccessProfile) => void
  onDeleteSSH: (profile: SSHAccessProfile) => void
  onSetDefaultSSH: (profile: SSHAccessProfile) => void
  onEditFile: (profile: FileAccessProfile) => void
  onSetDefaultFile: (profile: FileAccessProfile) => void
  onCreateRemoteDesktop: () => void
  onEditRemoteDesktop: (profile: RemoteDesktopAccessProfile) => void
  onDeleteRemoteDesktop: (profile: RemoteDesktopAccessProfile) => void
  onSetDefaultRemoteDesktop: (profile: RemoteDesktopAccessProfile) => void
}

export function AccessProfileCatalog({
  catalog,
  busy,
  sshReachability,
  refreshingSSHProfileIds,
  reachabilityError,
  onRefreshSSHReachability,
  onCreateSSH,
  onEditSSH,
  onDeleteSSH,
  onSetDefaultSSH,
  onEditFile,
  onSetDefaultFile,
  onCreateRemoteDesktop,
  onEditRemoteDesktop,
  onDeleteRemoteDesktop,
  onSetDefaultRemoteDesktop,
}: AccessProfileCatalogProps) {
  const { t } = useTranslation()
  const sshById = new Map(catalog.ssh.map((profile) => [profile.id, profile]))

  return (
    <div className={styles.catalog}>
      <AccessProfileSection
        icon={<FileKey2 size={16} />}
        title={t('hosts.access.ssh.title')}
        count={catalog.ssh.length}
        actionLabel={t('hosts.access.ssh.add')}
        actionDisabled={busy}
        onAdd={onCreateSSH}
      >
        {catalog.ssh.length === 0 ? (
          <ProfileEmpty label={t('hosts.access.ssh.empty')} />
        ) : catalog.ssh.map((profile) => (
          <AccessProfileRow
            key={profile.id}
            name={profile.name || `${profile.username}@${profile.address}`}
            type="SSH"
            detail={`${profile.username}@${profile.address}:${profile.port}`}
            isDefault={profile.is_default}
            busy={busy}
            reachability={sshReachability[profile.id]}
            reachabilityError={reachabilityError}
            refreshingReachability={refreshingSSHProfileIds.has(profile.id)}
            deleteDisabled={profile.is_default && catalog.ssh.length > 1}
            onRefreshReachability={() => onRefreshSSHReachability(profile.id)}
            onEdit={() => onEditSSH(profile)}
            onDelete={() => onDeleteSSH(profile)}
            onSetDefault={() => onSetDefaultSSH(profile)}
          />
        ))}
      </AccessProfileSection>

      <AccessProfileSection
        icon={<FolderSync size={16} />}
        title={t('hosts.access.file.title')}
        count={catalog.files.length}
      >
        {catalog.files.length === 0 ? (
          <ProfileEmpty label={t('hosts.access.file.empty')} />
        ) : catalog.files.map((profile) => {
          const projection = projectFileAccessProfile(profile)
          const ssh = sshById.get(projection.routeDependency.profileId)
          return (
            <AccessProfileRow
              key={profile.id}
              name={profile.name}
              type={projection.technology.label}
              detail={ssh
                ? t('hosts.access.file.boundTo', { name: ssh.name || ssh.address })
                : t('hosts.access.file.missingSSH')}
              isDefault={profile.is_default}
              busy={busy}
              onEdit={() => onEditFile(profile)}
              onSetDefault={() => onSetDefaultFile(profile)}
            />
          )
        })}
      </AccessProfileSection>

      <AccessProfileSection
        icon={<MonitorPlay size={16} />}
        title={t('hosts.access.desktop.title')}
        count={catalog.remote_desktops.length}
        actionLabel={t('hosts.access.desktop.add')}
        actionDisabled={busy}
        onAdd={onCreateRemoteDesktop}
      >
        {catalog.remote_desktops.length === 0 ? (
          <ProfileEmpty label={t('hosts.access.desktop.empty')} />
        ) : catalog.remote_desktops.map((profile) => {
          const projection = projectRemoteDesktopAccessProfile(profile)
          const ssh = sshById.get(projection.routeDependency.profileId)
          return (
            <AccessProfileRow
              key={profile.id}
              name={profile.name}
              type={projection.technology.label}
              detail={`${projection.endpoint} · ${ssh?.name || t('hosts.access.file.missingSSH')}`}
              isDefault={profile.is_default}
              busy={busy}
              deleteDisabled={profile.is_default && catalog.remote_desktops.length > 1}
              onEdit={() => onEditRemoteDesktop(profile)}
              onDelete={() => onDeleteRemoteDesktop(profile)}
              onSetDefault={() => onSetDefaultRemoteDesktop(profile)}
            />
          )
        })}
      </AccessProfileSection>
    </div>
  )
}

function AccessProfileSection({
  icon,
  title,
  count,
  actionLabel,
  actionDisabled = false,
  onAdd,
  children,
}: {
  icon: ReactNode
  title: string
  count: number
  actionLabel?: string
  actionDisabled?: boolean
  onAdd?: () => void
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <header className={styles['section-header']}>
        <span className={styles['section-icon']} aria-hidden="true">{icon}</span>
        <strong>{title}</strong>
        <small>{count}</small>
        {actionLabel && onAdd ? (
          <Button
            type="text"
            size="small"
            icon={<Plus size={14} />}
            disabled={actionDisabled}
            onClick={onAdd}
          >
            {actionLabel}
          </Button>
        ) : null}
      </header>
      <div className={styles.rows}>{children}</div>
    </section>
  )
}

function AccessProfileRow({
  name,
  type,
  detail,
  isDefault,
  busy,
  deleteDisabled = false,
  onEdit,
  onDelete,
  onSetDefault,
  reachability,
  reachabilityError,
  refreshingReachability = false,
  onRefreshReachability,
}: {
  name: string
  type: string
  detail: string
  isDefault: boolean
  busy: boolean
  deleteDisabled?: boolean
  onEdit: () => void
  onDelete?: () => void
  onSetDefault: () => void
  reachability?: HostReachability
  reachabilityError?: string
  refreshingReachability?: boolean
  onRefreshReachability?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className={styles.row} data-default={isDefault ? 'true' : 'false'}>
      <span className={styles['row-kind']}>{type}</span>
      <span className={styles['row-copy']}>
        <span>
          <strong>{name}</strong>
          {isDefault ? <em><Star size={10} />{t('hosts.access.default')}</em> : null}
        </span>
        <small>{detail}</small>
      </span>
      {onRefreshReachability ? (
        <ProfileReachability state={reachability} error={reachabilityError} />
      ) : null}
      <span className={styles['row-actions']}>
        {onRefreshReachability ? (
          <Tooltip title={t('hosts.access.reachability.refresh', { name })}>
            <Button
              type="text"
              size="small"
              loading={refreshingReachability}
              icon={<RefreshCw size={13} />}
              aria-label={t('hosts.access.reachability.refresh', { name })}
              disabled={busy || refreshingReachability}
              onClick={onRefreshReachability}
            />
          </Tooltip>
        ) : null}
        {!isDefault ? (
          <Tooltip title={t('hosts.access.setDefault')}>
            <Button
              type="text"
              size="small"
              icon={<Star size={14} />}
              aria-label={t('hosts.access.setDefault')}
              disabled={busy}
              onClick={onSetDefault}
            />
          </Tooltip>
        ) : null}
        <Tooltip title={t('app.edit')}>
          <Button
            type="text"
            size="small"
            icon={<Pencil size={14} />}
            aria-label={`${t('app.edit')} ${name}`}
            disabled={busy}
            onClick={onEdit}
          />
        </Tooltip>
        {onDelete ? (
          <Tooltip title={deleteDisabled ? t('hosts.access.switchDefaultBeforeDelete') : t('app.delete')}>
            <span>
              <Button
                danger
                type="text"
                size="small"
                icon={<Trash2 size={14} />}
                aria-label={`${t('app.delete')} ${name}`}
                disabled={busy || deleteDisabled}
                onClick={onDelete}
              />
            </span>
          </Tooltip>
        ) : null}
      </span>
    </div>
  )
}

function ProfileReachability({
  state,
  error,
}: {
  state?: HostReachability
  error?: string
}) {
  const { t } = useTranslation()
  const status = state?.status ?? 'unknown'
  const label = status === 'online' && state?.latency_ms !== undefined
    ? t('hosts.access.reachability.onlineLatency', { latency: state.latency_ms })
    : t(`hosts.access.reachability.${status}`)
  const detail = state?.error_message || error || t('hosts.access.reachability.directHint')
  return (
    <Tooltip title={`${label} · ${detail}`}>
      <span className={styles['row-reachability']} data-status={status}>
        <i aria-hidden="true" />
        {label}
      </span>
    </Tooltip>
  )
}

function ProfileEmpty({ label }: { label: string }) {
  return <div className={styles.empty}>{label}</div>
}

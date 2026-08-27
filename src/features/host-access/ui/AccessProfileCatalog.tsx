import { Button, Tooltip } from 'antd'
import {
  CircleCheck,
  FileKey2,
  FolderSync,
  MonitorPlay,
  Pencil,
  Plus,
  RefreshCw,
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
  sshReachabilityRefreshing: boolean
  sshReachabilityError?: string
  onRefreshSSHReachability: () => void
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
  sshReachabilityRefreshing,
  sshReachabilityError,
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
  const refreshReachabilityLabel = sshReachabilityError
    ? t('hosts.access.reachability.refreshFailed')
    : t('hosts.access.reachability.refreshAll')

  return (
    <div className={styles.catalog}>
      <AccessProfileSection
        icon={<FileKey2 size={16} />}
        title={t('hosts.access.ssh.title')}
        count={catalog.ssh.length}
        actionLabel={t('hosts.access.ssh.add')}
        actionDisabled={busy}
        headerAction={(
          <Tooltip title={sshReachabilityError
            ? `${refreshReachabilityLabel} · ${sshReachabilityError}`
            : refreshReachabilityLabel}
          >
            <Button
              type="default"
              size="small"
              className={styles['section-refresh']}
              loading={sshReachabilityRefreshing}
              icon={<RefreshCw size={14} strokeWidth={2} aria-hidden="true" />}
              aria-label={refreshReachabilityLabel}
              data-error={sshReachabilityError ? 'true' : 'false'}
              disabled={busy || catalog.ssh.length === 0 || sshReachabilityRefreshing}
              onClick={onRefreshSSHReachability}
            />
          </Tooltip>
        )}
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
            showReachability
            deleteDisabled={profile.is_default && catalog.ssh.length > 1}
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
  headerAction,
  onAdd,
  children,
}: {
  icon: ReactNode
  title: string
  count: number
  actionLabel?: string
  actionDisabled?: boolean
  headerAction?: ReactNode
  onAdd?: () => void
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <header className={styles['section-header']}>
        <span className={styles['section-icon']} aria-hidden="true">{icon}</span>
        <strong>{title}</strong>
        <small>{count}</small>
        {headerAction || (actionLabel && onAdd) ? (
          <span className={styles['section-actions']}>
            {headerAction}
            {actionLabel && onAdd ? (
              <Button
                type="default"
                size="small"
                className={styles['section-add']}
                icon={<Plus size={13} strokeWidth={2.2} aria-hidden="true" />}
                disabled={actionDisabled}
                onClick={onAdd}
              >
                {actionLabel}
              </Button>
            ) : null}
          </span>
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
  showReachability = false,
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
  showReachability?: boolean
}) {
  const { t } = useTranslation()
  const setDefaultLabel = `${t('hosts.access.setDefault')} ${name}`
  const deleteDisabledReason = t('hosts.access.switchDefaultBeforeDelete')
  return (
    <div className={styles.row} data-default={isDefault ? 'true' : 'false'}>
      <span className={styles['row-kind']}>{type}</span>
      <span className={styles['row-copy']}>
        <span>
          <strong>{name}</strong>
          {isDefault ? <em><CircleCheck size={10} />{t('hosts.access.default')}</em> : null}
        </span>
        <small>{detail}</small>
      </span>
      <span className={styles['row-controls']}>
        <span className={styles['row-status']}>
          {showReachability ? <ProfileReachability state={reachability} /> : null}
        </span>
        <span className={styles['row-actions']}>
          {!isDefault ? (
            <Tooltip title={setDefaultLabel}>
              <Button
                type="text"
                size="small"
                icon={<CircleCheck size={14} />}
                aria-label={setDefaultLabel}
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
            <Tooltip title={deleteDisabled ? deleteDisabledReason : t('app.delete')}>
              <span
                role={deleteDisabled ? 'note' : undefined}
                tabIndex={deleteDisabled ? 0 : undefined}
                aria-label={deleteDisabled ? deleteDisabledReason : undefined}
              >
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
      </span>
    </div>
  )
}

function ProfileReachability({
  state,
}: {
  state?: HostReachability
}) {
  const { t } = useTranslation()
  const status = state?.status ?? 'unknown'
  const label = status === 'online' && state?.latency_ms !== undefined
    ? t('hosts.access.reachability.onlineLatency', { latency: state.latency_ms })
    : t(`hosts.access.reachability.${status}`)
  return (
    <span className={styles['row-reachability']} data-status={status}>
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

function ProfileEmpty({ label }: { label: string }) {
  return <div className={styles.empty}>{label}</div>
}

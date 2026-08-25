import { Button, Tooltip } from 'antd'
import {
  FileKey2,
  FolderSync,
  MonitorPlay,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { HostAccessCatalog } from '#entities/host-asset'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import styles from './HostAccess.module.scss'

interface AccessProfileCatalogProps {
  catalog: HostAccessCatalog
  busy: boolean
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
          const ssh = sshById.get(profile.sftp.ssh_profile_id)
          return (
            <AccessProfileRow
              key={profile.id}
              name={profile.name}
              type="SFTP"
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
          const ssh = sshById.get(profile.ssh_profile_id)
          return (
            <AccessProfileRow
              key={profile.id}
              name={profile.name}
              type="VNC"
              detail={`${profile.vnc.loopback_host}:${profile.vnc.port} · ${ssh?.name || t('hosts.access.file.missingSSH')}`}
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
      <span className={styles['row-actions']}>
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

function ProfileEmpty({ label }: { label: string }) {
  return <div className={styles.empty}>{label}</div>
}

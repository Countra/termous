import { Button, Popconfirm } from 'antd'
import {
  Cable,
  FileText,
  MonitorPlay,
  MousePointer2,
  Network,
  Pencil,
  Scaling,
  Server,
  Trash2,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopProfile } from '#entities/remote-desktop'
import type { Host } from '#entities/host'
import { ConnectionActionButton, termousPopconfirmProps, uiStyles } from '#shared/ui'
import styles from './RemoteDesktopLauncher.module.scss'

interface RemoteDesktopProfileOverviewProps {
  profile: RemoteDesktopProfile
  host?: Host
  disabled: boolean
  connecting: boolean
  deleting: boolean
  onEdit: () => void
  onDelete: () => Promise<void>
  onConnect: () => void
}

export function RemoteDesktopProfileOverview({
  profile,
  host,
  disabled,
  connecting,
  deleting,
  onEdit,
  onDelete,
  onConnect,
}: RemoteDesktopProfileOverviewProps) {
  const { t } = useTranslation()
  const endpoint = `${profile.vnc.loopback_host}:${profile.vnc.port}`

  return (
    <main className={styles.editor} data-profile-view="overview">
      <header className={styles['overview-heading']}>
        <span className={styles['overview-icon']} aria-hidden="true">
          <MonitorPlay size={23} />
        </span>
        <div className={styles['overview-title']}>
          <span>{t('remoteDesktop.profileDetail')}</span>
          <h2>{profile.name}</h2>
          <small>{host ? `${host.username}@${host.address}:${host.port}` : t('remoteDesktop.hostUnavailable')}</small>
        </div>
      </header>

      <div className={styles['overview-body']}>
        {!host ? (
          <div className={styles['host-warning']} role="status">
            <Server size={16} aria-hidden="true" />
            <span>{t('remoteDesktop.hostUnavailableHint')}</span>
          </div>
        ) : null}
        <dl className={styles['overview-grid']}>
          <OverviewItem icon={<Server size={16} />} label={t('remoteDesktop.sshHost')} value={host?.name ?? t('fields.none')} />
          <OverviewItem icon={<Network size={16} />} label={t('remoteDesktop.vncEndpoint')} value={endpoint} mono />
          <OverviewItem icon={<Scaling size={16} />} label={t('remoteDesktop.displayMode')} value={t(`remoteDesktop.display.${profile.vnc.default_display_mode}`)} />
          <OverviewItem icon={<Users size={16} />} label={t('remoteDesktop.shared')} value={t(profile.vnc.shared ? 'remoteDesktop.enabled' : 'remoteDesktop.disabled')} />
          <OverviewItem icon={<MousePointer2 size={16} />} label={t('remoteDesktop.viewOnly')} value={t(profile.vnc.default_view_only ? 'remoteDesktop.enabled' : 'remoteDesktop.disabled')} />
          <OverviewItem icon={<FileText size={16} />} label={t('remoteDesktop.description')} value={profile.description || t('fields.none')} wide />
        </dl>
      </div>

      <footer className={styles.footer}>
        <Popconfirm
          {...termousPopconfirmProps}
          title={t('remoteDesktop.deleteProfileTitle')}
          description={t('remoteDesktop.deleteProfileDescription', { name: profile.name })}
          okText={t('app.delete')}
          cancelText={t('app.cancel')}
          okButtonProps={{ danger: true }}
          disabled={disabled}
          onConfirm={onDelete}
        >
          <Button
            danger
            type="text"
            icon={<Trash2 size={15} />}
            loading={deleting}
            disabled={disabled}
          >
            {t('app.delete')}
          </Button>
        </Popconfirm>
        <div className={styles['footer-actions']}>
          <Button
            className={uiStyles['secondary-button']}
            icon={<Pencil size={15} />}
            disabled={disabled}
            onClick={onEdit}
          >
            {t('app.edit')}
          </Button>
          <ConnectionActionButton
            icon={<Cable size={16} />}
            loading={connecting}
            disabled={disabled || !host}
            onClick={onConnect}
          >
            {t('app.connect')}
          </ConnectionActionButton>
        </div>
      </footer>
    </main>
  )
}

function OverviewItem({
  icon,
  label,
  value,
  mono = false,
  wide = false,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  mono?: boolean
  wide?: boolean
}) {
  return (
    <div className={`${styles['overview-item']} ${wide ? styles['is-wide'] : ''}`}>
      <dt>
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className={mono ? styles['is-mono'] : ''}>{value}</dd>
    </div>
  )
}

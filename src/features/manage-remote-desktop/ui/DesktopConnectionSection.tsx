import { Segmented } from 'antd'
import { LockKeyhole, Network, Route } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopRoute } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { CustomSelect, ProfileEditorFieldFeedback, ProfileEditorSectionHeading } from '#shared/ui'
import styles from './DesktopProfileForm.module.scss'
import controls from './DesktopProfileControls.module.scss'

interface Props {
  route: RemoteDesktopRoute
  sshProfileId: string
  sshProfiles: SSHAccessProfile[]
  routeError?: string
  disabled: boolean
  onRouteChange: (route: RemoteDesktopRoute) => void
  onSSHChange: (id: string) => void
  children: ReactNode
}

export function DesktopConnectionSection({
  route, sshProfileId, sshProfiles, routeError, disabled,
  onRouteChange, onSSHChange, children,
}: Props) {
  const { t } = useTranslation()
  const id = useId()
  return <section className={`${styles.section} ${styles['connection-section']}`} aria-labelledby={`${id}-title`}>
    <ProfileEditorSectionHeading
      classNames={styles} id={`${id}-title`}
      icon={<Route size={16} />} title={t('remoteDesktop.connectionSection')}
    />
    <div className={styles['route-setting']}>
      <span id={`${id}-route`} className={styles['route-label']}>{t('remoteDesktop.route.label')}</span>
      <Segmented<RemoteDesktopRoute>
        name={`${id}-route-mode`} block className={controls.control}
        value={route} disabled={disabled}
        aria-labelledby={`${id}-route`}
        aria-controls={`${id}-fields`}
        options={[
          {
            value: 'ssh_tunnel', label: t('remoteDesktop.route.sshTunnel'),
            icon: <LockKeyhole size={13} aria-hidden="true" />,
            disabled: sshProfiles.length === 0 && route !== 'ssh_tunnel',
          },
          {
            value: 'direct', label: t('remoteDesktop.route.direct'),
            icon: <Network size={13} aria-hidden="true" />,
          },
        ]}
        onChange={onRouteChange}
      />
      {sshProfiles.length === 0 ? <p className={styles.hint}>{t('remoteDesktop.editor.noSSH')}</p> : null}
    </div>
    <div id={`${id}-fields`} className={styles['connection-details']}>
      {route === 'ssh_tunnel' ? <div className={styles.field} data-invalid={routeError ? 'true' : 'false'}>
        <CustomSelect
          label={t('hosts.access.desktop.sshRoute')}
          value={sshProfileId} disabled={disabled || sshProfiles.length === 0}
          status={routeError ? 'error' : undefined}
          aria-invalid={routeError ? true : undefined}
          aria-describedby={routeError ? `${id}-error` : undefined}
          options={sshProfiles.map(profile => ({
            value: profile.id,
            label: profile.name || `${profile.username}@${profile.address}`,
            description: `${profile.username}@${profile.address}:${profile.port}`,
          }))}
          onChange={onSSHChange}
        />
        <ProfileEditorFieldFeedback classNames={styles} id={`${id}-error`} message={routeError} />
      </div> : null}
      {children}
    </div>
  </section>
}

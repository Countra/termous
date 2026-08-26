import { Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import {
  Cable,
  ChevronDown,
  FolderOpen,
  MonitorPlay,
  Settings2,
  Star,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton, contextActionMenuPopupClassName } from '#shared/ui'
import type { HostLauncherIntent } from '../model/hostLauncherIntent.ts'
import type {
  HostLauncherProfileMenu,
  HostLauncherProfileMenuItem,
} from '../model/hostLauncherProfiles.ts'
import styles from './HostLauncherProfileAction.module.scss'

export interface HostLauncherProfileActionProps {
  menu: HostLauncherProfileMenu
  busy: boolean
  pendingProfileId: string | null
  onRun: (item: HostLauncherProfileMenuItem) => void
  onManage: () => void
}

export function HostLauncherProfileAction({
  menu,
  busy,
  pendingProfileId,
  onRun,
  onManage,
}: HostLauncherProfileActionProps) {
  const { t } = useTranslation()
  const defaultItem = menu.defaultItem
  const ready = menu.defaultResolution === 'resolved' && defaultItem?.availability === 'ready'
  const showProfileMenu = menu.items.length >= 2
    || (!ready && menu.items.some((item) => item.availability === 'ready'))
  const status = defaultItem && ready
    ? defaultItem.name
    : t(`workbench.hostLauncher.profiles.status.${menu.defaultResolution}`)
  const detail = defaultItem && ready
    ? profileDetail(defaultItem, t)
    : t('workbench.hostLauncher.profiles.manageHint')

  const items: MenuProps['items'] = menu.items.map((item) => ({
    key: item.profileId,
    disabled: item.availability !== 'ready',
    icon: profileIcon(item.intent, 15),
    label: (
      <Tooltip
        arrow={false}
        placement="left"
        title={profileDetail(item, t)}
        mouseEnterDelay={0.35}
      >
        <span className={styles['menu-item']}>
          <span>{item.name}</span>
          {item.isDefault ? (
            <Star
              size={12}
              fill="currentColor"
              aria-label={t('hosts.access.default')}
            />
          ) : null}
        </span>
      </Tooltip>
    ),
  }))

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    const item = menu.items.find((candidate) => candidate.profileId === key)
    if (item?.availability === 'ready') onRun(item)
  }

  return (
    <section className={styles.root} aria-label={t(`workbench.hostLauncher.profiles.context.${menu.intent}`)}>
      <div className={`${styles.context} ${ready ? '' : styles['is-unavailable']}`}>
        <span className={styles.icon} aria-hidden="true">
          {profileIcon(menu.intent, 16)}
        </span>
        <span className={styles.copy}>
          <small>{t(`workbench.hostLauncher.profiles.context.${menu.intent}`)}</small>
          <strong>{status}</strong>
          <span>{detail}</span>
        </span>
        {!ready ? (
          <Button
            type="text"
            className={styles.manage}
            aria-label={t('workbench.hostLauncher.profiles.manage')}
            icon={<Settings2 size={15} />}
            disabled={busy}
            onClick={onManage}
          />
        ) : null}
      </div>
      <div className={`${styles.actions} ${showProfileMenu ? styles['has-menu'] : ''}`}>
        <ConnectionActionButton
          block
          size="large"
          className={styles.primary}
          icon={profileIcon(menu.intent, 17)}
          loading={Boolean(defaultItem && pendingProfileId === defaultItem.profileId)}
          disabled={busy || !ready || !defaultItem}
          onClick={() => {
            if (defaultItem && ready) onRun(defaultItem)
          }}
        >
          {primaryLabel(menu.intent, t)}
        </ConnectionActionButton>
        {showProfileMenu ? (
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{ items, onClick: handleMenuClick }}
            classNames={{ root: `${contextActionMenuPopupClassName} ${styles.popup}` }}
            disabled={busy}
          >
            <Button
              type="default"
              className={styles.more}
              aria-label={t(`workbench.hostLauncher.profiles.more.${menu.intent}`)}
              icon={<ChevronDown size={16} />}
              disabled={busy}
            />
          </Dropdown>
        ) : null}
      </div>
    </section>
  )
}

function primaryLabel(
  intent: HostLauncherIntent,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (intent === 'files') return t('workbench.hostLauncher.openFiles')
  if (intent === 'remote_desktop') return t('workbench.hostLauncher.openRemoteDesktop')
  return t('app.connect')
}

function profileIcon(intent: HostLauncherIntent, size: number) {
  if (intent === 'files') return <FolderOpen size={size} />
  if (intent === 'remote_desktop') return <MonitorPlay size={size} />
  return <Cable size={size} />
}

function profileDetail(
  item: HostLauncherProfileMenuItem,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (item.availability !== 'ready') {
    return t('workbench.hostLauncher.profiles.routeMissing')
  }
  if (item.route && item.intent === 'remote_desktop') {
    return t('workbench.hostLauncher.profiles.desktopDetail', {
      endpoint: item.endpoint,
      route: item.route.name,
    })
  }
  if (item.route) {
    return t('workbench.hostLauncher.profiles.fileDetail', { route: item.route.name })
  }
  return item.endpoint
}

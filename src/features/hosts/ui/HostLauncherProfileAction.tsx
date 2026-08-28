import { Button } from 'antd'
import {
  Cable,
  FolderOpen,
  MonitorPlay,
  Settings2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton } from '#shared/ui'
import type { HostLauncherData } from '../model/types.ts'
import type { HostLauncherIntent } from '../model/hostLauncherIntent.ts'
import type {
  HostLauncherProfileMenu,
  HostLauncherProfileMenuItem,
} from '../model/hostLauncherProfiles.ts'
import { HostLauncherProfileSelect } from './HostLauncherProfileSelect.tsx'
import styles from './HostLauncherProfileAction.module.scss'

export interface HostLauncherProfileActionProps {
  menu: HostLauncherProfileMenu
  data: HostLauncherData
  selectedItem: HostLauncherProfileMenuItem | null
  busy: boolean
  pendingProfileId: string | null
  onSelect: (item: HostLauncherProfileMenuItem) => void
  onRun: (item: HostLauncherProfileMenuItem) => void
  onManage: () => void
}

export function HostLauncherProfileAction({
  menu,
  data,
  selectedItem,
  busy,
  pendingProfileId,
  onSelect,
  onRun,
  onManage,
}: HostLauncherProfileActionProps) {
  const { t } = useTranslation()
  const ready = selectedItem?.availability === 'ready'

  return (
    <section className={styles.root} aria-label={t(`workbench.hostLauncher.profiles.context.${menu.intent}`)}>
      <header className={styles.header}>
        <span className={styles.context}>
          <span className={styles.icon} aria-hidden="true">
            {profileIcon(menu.intent, 15)}
          </span>
          <strong>{t(`workbench.hostLauncher.profiles.context.${menu.intent}`)}</strong>
          <small>{t('workbench.hostLauncher.profiles.count', { count: menu.items.length })}</small>
        </span>
        <Button
          type="text"
          size="small"
          className={styles.manage}
          icon={<Settings2 size={13} />}
          disabled={busy}
          onClick={onManage}
        >
          {t('workbench.hostLauncher.profiles.manage')}
        </Button>
      </header>
      <div className={styles.actions}>
        <HostLauncherProfileSelect
          menu={menu}
          data={data}
          selectedItem={selectedItem}
          busy={busy}
          onSelect={onSelect}
        />
        <ConnectionActionButton
          block
          size="large"
          className={styles.primary}
          icon={profileIcon(menu.intent, 17)}
          loading={Boolean(selectedItem && pendingProfileId === selectedItem.profileId)}
          disabled={busy || !ready || !selectedItem}
          onClick={() => {
            if (selectedItem && ready) onRun(selectedItem)
          }}
        >
          {primaryLabel(menu.intent, t)}
        </ConnectionActionButton>
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

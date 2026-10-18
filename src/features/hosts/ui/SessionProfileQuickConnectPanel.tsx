import { Input, type InputRef } from 'antd'
import { ArrowUpRight, Folder, LoaderCircle, MonitorPlay, Search } from 'lucide-react'
import { useId, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { HostAvatar } from '#entities/host'
import { uiStyles } from '#shared/ui'
import type { SessionProfileQuickConnectItem } from '../model/sessionProfileQuickConnect.ts'
import { ProfileQuickConnectDetails } from './SessionQuickConnectDetails.tsx'
import { SessionQuickConnectHoverCard } from './SessionQuickConnectHoverCard.tsx'
import styles from './SessionQuickConnect.module.scss'

interface Props {
  intent: 'files' | 'remote_desktop'
  active: boolean
  inputRef: Ref<InputRef>
  panelRef: Ref<HTMLElement>
  items: SessionProfileQuickConnectItem[]
  totalCount: number
  query: string
  pendingId: string | null
  getHostIconUrl?: (iconId: string) => string
  onQueryChange: (query: string) => void
  onConnect: (profileId: string) => void
  onClose: () => void
  onOpenLauncher?: () => void
}

export function SessionProfileQuickConnectPanel({
  intent, active, inputRef, panelRef, items, totalCount, query, pendingId, getHostIconUrl,
  onQueryChange, onConnect, onClose, onOpenLauncher,
}: Props) {
  const { t } = useTranslation()
  const searchId = useId()
  const title = t(`workbench.quickConnect.profiles.${intent === 'files' ? 'files' : 'remoteDesktop'}`)

  return (
    <section ref={panelRef} className={styles.panel} role="dialog" aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose() }
      }}
    >
      <Input ref={inputRef} id={searchId} name="session-profile-quick-connect-search"
        className={`${uiStyles['search-input']} ${styles.search}`} value={query} allowClear variant="borderless"
        prefix={<Search size={14} aria-hidden="true" />} placeholder={t('workbench.quickConnect.profiles.search')}
        aria-label={t('workbench.quickConnect.profiles.search')}
        onChange={(event) => onQueryChange(event.target.value)}
        onPressEnter={() => {
          const available = items.filter((item) => !item.unavailableReason)
          if (available.length === 1 && pendingId === null) onConnect(available[0].profile.profileId)
        }}
      />
      <div className={styles.list}>
        {items.length === 0 ? (
          <div className={styles.empty}>{t(`workbench.quickConnect.profiles.${totalCount === 0 ? 'empty' : 'noResults'}`)}</div>
        ) : items.map((item) => {
          const { profile, host, unavailableReason } = item
          const detail = unavailableReason
            ? t(unavailableReason === 'route_missing' ? 'workbench.hostLauncher.profiles.routeMissing' : 'workbench.quickConnect.profiles.hostMissing')
            : [host?.name, profile.endpoint].filter(Boolean).join(' · ')
          return (
            <SessionQuickConnectHoverCard key={profile.profileId} active={active && pendingId === null} resetKey={query}
              unavailableLabel={unavailableReason ? `${profile.name} · ${detail}` : undefined}
              content={<ProfileQuickConnectDetails item={item} />}
            >
              <button type="button" className={styles.row}
                disabled={pendingId !== null || unavailableReason !== null}
                aria-busy={pendingId === profile.profileId}
                onClick={() => onConnect(profile.profileId)}
              >
                <HostAvatar host={host} getIconUrl={getHostIconUrl} className={styles['host-icon']} size={28}
                  fallbackIcon={intent === 'files' ? <Folder size={15} /> : <MonitorPlay size={15} />}
                />
                <span className={styles.copy}><strong>{profile.name}</strong><small>{detail}</small></span>
                <span className={styles['profile-technology']}>
                  {pendingId === profile.profileId ? <LoaderCircle size={14} className={styles['profile-spinner']} aria-hidden="true" /> : profile.technology.toUpperCase()}
                </span>
              </button>
            </SessionQuickConnectHoverCard>
          )
        })}
      </div>
      <footer className={`${styles.footer} ${onOpenLauncher ? styles['launcher-footer'] : ''}`}>
        {onOpenLauncher && <button type="button" disabled={pendingId !== null} onClick={onOpenLauncher}>
          {t('workbench.quickConnect.moreConnections')}<ArrowUpRight size={13} aria-hidden="true" />
        </button>}
        <small>{t('workbench.quickConnect.profiles.count', { count: totalCount })}</small>
      </footer>
    </section>
  )
}

import { Button, Empty, Input } from 'antd'
import { MonitorPlay, Plus, Search } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { Host } from '#entities/host'
import { uiStyles } from '#shared/ui'
import styles from './RemoteDesktopLauncher.module.scss'

interface RemoteDesktopProfileCatalogProps {
  profiles: RemoteDesktopAccessProfile[]
  hosts: Host[]
  query: string
  selectedId: string
  disabled: boolean
  onQueryChange: (value: string) => void
  onSelect: (profileId: string) => void
  onConnect: (profileId: string) => void
  onCreate: () => void
}

export function RemoteDesktopProfileCatalog({
  profiles,
  hosts,
  query,
  selectedId,
  disabled,
  onQueryChange,
  onSelect,
  onConnect,
  onCreate,
}: RemoteDesktopProfileCatalogProps) {
  const { t } = useTranslation()
  const focusableProfileId = profiles.some((profile) => profile.id === selectedId)
    ? selectedId
    : profiles[0]?.id

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return
    }
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'),
    )
    if (options.length === 0) {
      return
    }
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, options.length - 1)
          : Math.max(currentIndex < 0 ? options.length - 1 : currentIndex - 1, 0)
    event.preventDefault()
    const nextOption = options[nextIndex]
    nextOption?.focus()
    if (nextOption?.dataset.profileId) {
      onSelect(nextOption.dataset.profileId)
    }
  }

  return (
    <aside className={styles.catalog} aria-label={t('remoteDesktop.profiles')}>
      <div className={styles['catalog-toolbar']}>
        <Input
          allowClear
          value={query}
          prefix={<Search size={15} aria-hidden="true" />}
          placeholder={t('remoteDesktop.searchProfiles')}
          aria-label={t('remoteDesktop.searchProfiles')}
          className={uiStyles['search-input']}
          disabled={disabled}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div
        className={styles.list}
        role={profiles.length === 0 ? undefined : 'listbox'}
        aria-label={profiles.length === 0 ? undefined : t('remoteDesktop.profiles')}
        onKeyDown={handleListKeyDown}
      >
        {profiles.length === 0 ? (
          <div className={styles['catalog-empty']}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<strong role="status" aria-live="polite">{t('remoteDesktop.noProfiles')}</strong>}
            >
              {query ? (
                <Button type="text" size="small" disabled={disabled} onClick={() => onQueryChange('')}>
                  {t('remoteDesktop.clearSearch')}
                </Button>
              ) : null}
            </Empty>
          </div>
        ) : profiles.map((profile) => {
          const host = hosts.find((item) => item.id === profile.host_id)
          const endpoint = `${profile.vnc.loopback_host}:${profile.vnc.port}`
          return (
            <button
              key={profile.id}
              type="button"
              role="option"
              data-profile-id={profile.id}
              aria-selected={profile.id === selectedId}
              aria-label={`${profile.name} ${host?.name ?? t('fields.none')} ${endpoint}`}
              disabled={disabled}
              tabIndex={profile.id === focusableProfileId ? 0 : -1}
              className={`${styles.item} ${profile.id === selectedId ? styles['is-active'] : ''}`}
              onClick={() => onSelect(profile.id)}
              onDoubleClick={host ? () => onConnect(profile.id) : undefined}
            >
              <span className={styles['item-icon']} aria-hidden="true"><MonitorPlay size={17} /></span>
              <span className={styles['item-copy']}>
                <strong>{profile.name}</strong>
                <small>{host?.name ?? t('fields.none')}</small>
                <span>{endpoint}</span>
              </span>
            </button>
          )
        })}
      </div>
      <footer className={styles['catalog-footer']}>
        <Button
          block
          className={uiStyles['secondary-button']}
          icon={<Plus size={15} />}
          disabled={disabled || hosts.length === 0}
          onClick={onCreate}
        >
          {t('remoteDesktop.newProfile')}
        </Button>
      </footer>
    </aside>
  )
}

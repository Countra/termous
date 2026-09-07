import { Cable, CircleAlert, CircleCheck, FolderOpen, MonitorPlay } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AssociationSelect,
  type AssociationSelectItem,
} from '#shared/ui'
import {
  formatDateTime,
} from '../model/hostLauncherListModel.ts'
import {
  resolveHostLauncherProfileDetails,
  type HostLauncherResolvedProfileDetails,
} from '../model/hostLauncherProfileDetails.ts'
import type {
  HostLauncherProfileMenu,
  HostLauncherProfileMenuItem,
} from '../model/hostLauncherProfiles.ts'
import type { HostLauncherData } from '../model/types.ts'
import {
  accessibleProfileDetails,
  credentialLabel,
  profileDetail,
  proxyTypeLabel,
} from './hostLauncherProfilePresentation.ts'
import styles from './HostLauncherProfileSelect.module.scss'

const unselectedValue = '__host_launcher_profile_unselected__'

interface HostLauncherSelectItem extends AssociationSelectItem {
  kind: 'status' | 'profile'
  profile: HostLauncherProfileMenuItem | null
  details: HostLauncherResolvedProfileDetails | null
  detail: string
}

interface HostLauncherProfileSelectProps {
  menu: HostLauncherProfileMenu
  data: HostLauncherData
  selectedItem: HostLauncherProfileMenuItem | null
  busy: boolean
  onSelect: (item: HostLauncherProfileMenuItem) => void
}

export function HostLauncherProfileSelect({
  menu,
  data,
  selectedItem,
  busy,
  onSelect,
}: HostLauncherProfileSelectProps) {
  const { t } = useTranslation()
  const statusText = t(`workbench.hostLauncher.profiles.status.${menu.defaultResolution}`)
  const profileDetailsData = useMemo(() => ({
    credentials: data.credentials,
    fileAccessProfiles: data.fileAccessProfiles,
    hostAssets: data.hostAssets,
    proxies: data.proxies,
    remoteDesktopProfiles: data.remoteDesktopProfiles,
    sshAccessProfiles: data.sshAccessProfiles,
  }), [
    data.credentials,
    data.fileAccessProfiles,
    data.hostAssets,
    data.proxies,
    data.remoteDesktopProfiles,
    data.sshAccessProfiles,
  ])
  const items = useMemo<HostLauncherSelectItem[]>(() => [
    {
      value: unselectedValue,
      label: statusText,
      kind: 'status',
      profile: null,
      details: null,
      detail: t('workbench.hostLauncher.profiles.manageHint'),
      searchText: '',
      disabled: true,
    },
    ...menu.items.map((profile) => {
      const detail = profileDetail(profile, t)
      const details = resolveHostLauncherProfileDetails(profileDetailsData, profile)
      return {
        value: profile.profileId,
        label: profile.name,
        kind: 'profile' as const,
        profile,
        details,
        detail,
        searchText: [
          profile.name,
          profile.technology,
          profile.endpoint,
          profile.route?.name,
          profile.route?.endpoint,
          details?.sshCredential?.name,
          details?.remoteDesktop?.targetCredential?.name,
          details?.jump?.hostName,
          details?.jump?.profileName,
          details?.proxy?.name,
          details?.lastDirectory,
          details?.remoteDesktop?.description,
        ].filter(Boolean).join(' ').toLocaleLowerCase(),
        disabled: profile.availability !== 'ready',
        ariaLabel: [
          profile.name,
          profile.technology.toUpperCase(),
          detail,
          profile.route?.endpoint !== profile.endpoint ? profile.route?.endpoint : '',
          ...accessibleProfileDetails(profile, details, t),
          profile.isDefault ? t('hosts.access.default') : '',
        ].filter(Boolean).join(', '),
      }
    }),
  ], [
    menu.items,
    profileDetailsData,
    statusText,
    t,
  ])
  const value = selectedItem?.profileId ?? unselectedValue
  const interactive = menu.items.length > 1
    || (!selectedItem && menu.items.some((item) => item.availability === 'ready'))
  const selectedOption = items.find((item) => item.value === value)

  if (!interactive) {
    return (
      <div className={styles['static-field']}>
        <span className={styles.label}>
          {t('workbench.hostLauncher.profiles.selection')}
        </span>
        <div
          className={`${styles.static} ${selectedItem?.availability !== 'ready' ? styles['is-unavailable'] : ''}`}
        >
          <ProfileSelection item={selectedOption} />
        </div>
      </div>
    )
  }

  return (
    <AssociationSelect
      label={t('workbench.hostLauncher.profiles.selection')}
      value={value}
      items={items}
      disabled={busy}
      className={styles.field}
      popupClassName={styles.popup}
      detailClassName={styles['detail-tooltip']}
      isItemVisible={(item) => item.kind === 'profile'}
      renderSelection={(item) => <ProfileSelection item={item} />}
      renderOption={(item) => <ProfileOption item={item} />}
      renderDetails={(item) => item.kind === 'profile' && item.profile && item.details
        ? <ProfileDetails profile={item.profile} details={item.details} />
        : null}
      onChange={(_, item) => {
        if (item?.profile?.availability === 'ready') onSelect(item.profile)
      }}
    />
  )
}

function ProfileSelection({ item }: { item?: HostLauncherSelectItem }) {
  const { t } = useTranslation()
  const profile = item?.profile
  if (!profile) {
    return (
      <span className={`${styles.selection} ${styles['is-unavailable']}`}>
        <span className={styles['selection-icon']} aria-hidden="true">
          <CircleAlert size={15} />
        </span>
        <span className={styles['selection-copy']}>
          <strong>{item?.label ?? t('workbench.hostLauncher.profiles.status.empty')}</strong>
          <small>{item?.detail ?? t('workbench.hostLauncher.profiles.manageHint')}</small>
        </span>
      </span>
    )
  }

  return (
    <span className={`${styles.selection} ${profile.availability !== 'ready' ? styles['is-unavailable'] : ''}`}>
      <span className={styles['selection-icon']} aria-hidden="true">
        {technologyIcon(profile.technology, 15)}
      </span>
      <span className={styles['selection-copy']}>
        <strong>{profile.name}</strong>
        <small>{item.detail}</small>
      </span>
      {profile.isDefault ? (
        <span className={styles['default-mark']}>
          <CircleCheck size={12} aria-hidden="true" />
          {t('hosts.access.default')}
        </span>
      ) : null}
    </span>
  )
}

function ProfileOption({ item }: { item: HostLauncherSelectItem }) {
  const { t } = useTranslation()
  const profile = item.profile
  if (!profile) return null

  return (
    <span className={`${styles.option} ${profile.availability !== 'ready' ? styles['is-unavailable'] : ''}`}>
      <span className={styles['option-icon']} aria-hidden="true">
        {technologyIcon(profile.technology, 15)}
      </span>
      <span className={styles['option-copy']}>
        <span className={styles['option-title']}>
          <strong>{profile.name}</strong>
          <small>{profile.technology.toUpperCase()}</small>
          {profile.isDefault ? (
            <span className={styles['default-mark']}>
              <CircleCheck size={11} aria-hidden="true" />
              {t('hosts.access.default')}
            </span>
          ) : null}
        </span>
        <span className={styles['option-detail']}>
          {profile.availability !== 'ready' ? <CircleAlert size={11} aria-hidden="true" /> : null}
          <span>{item.detail}</span>
        </span>
      </span>
    </span>
  )
}

function ProfileDetails({
  profile,
  details,
}: {
  profile: HostLauncherProfileMenuItem
  details: HostLauncherResolvedProfileDetails
}) {
  const { t } = useTranslation()
  const route = profile.route
  const showDirectRoute = profile.intent === 'remote_desktop'
    && profile.availability === 'ready'
    && route === null
  const desktop = details.remoteDesktop
  const showDetailsList = Boolean(
    profile.endpoint
    || route
    || showDirectRoute
    || details.lastDirectory
    || desktop,
  )

  return (
    <div className={styles.details}>
      <div className={styles['details-header']}>
        <span className={styles['details-icon']} aria-hidden="true">
          {technologyIcon(profile.technology, 15)}
        </span>
        <span className={styles['details-title']}>
          <strong>{profile.name}</strong>
          <small>{profile.technology.toUpperCase()}</small>
        </span>
        {profile.isDefault ? (
          <span className={styles['default-mark']}>
            <CircleCheck size={12} aria-hidden="true" />
            {t('hosts.access.default')}
          </span>
        ) : null}
      </div>
      {showDetailsList ? (
        <dl className={styles['details-list']}>
          {profile.endpoint ? (
            <div>
              <dt>{t('workbench.hostLauncher.profiles.details.endpoint')}</dt>
              <dd className={styles.endpoint}>{profile.endpoint}</dd>
            </div>
          ) : null}
          {route ? (
            <div>
              <dt>{t('workbench.hostLauncher.profiles.details.route')}</dt>
              <dd className={styles['route-value']}>
                <span>{route.name}</span>
                {route.endpoint !== profile.endpoint ? (
                  <small>{route.endpoint}</small>
                ) : null}
              </dd>
            </div>
          ) : null}
          {showDirectRoute ? (
            <div>
              <dt>{t('workbench.hostLauncher.profiles.details.route')}</dt>
              <dd>{t('workbench.hostLauncher.profiles.details.direct')}</dd>
            </div>
          ) : null}
          {details.sshCredential ? (
            <DetailRow
              label={profile.intent === 'remote_desktop'
                ? t('workbench.hostLauncher.profiles.details.sshCredential')
                : t('hosts.credential')}
              value={credentialLabel(details.sshCredential, t)}
            />
          ) : null}
          {desktop ? (
            <DetailRow
              label={t('workbench.hostLauncher.profiles.details.targetCredential')}
              value={desktop.targetCredential
                ? credentialLabel(desktop.targetCredential, t)
                : t('fields.none')}
            />
          ) : null}
          {details.jump ? (
            <div>
              <dt>{t('hosts.jumpHost')}</dt>
              <dd className={styles['route-value']}>
                <span>{[details.jump.hostName, details.jump.profileName].filter(Boolean).join(' · ')}</span>
                <small>{details.jump.endpoint}</small>
                {details.jump.credential ? (
                  <small>{credentialLabel(details.jump.credential, t)}</small>
                ) : null}
              </dd>
            </div>
          ) : null}
          {details.proxy ? (
            <DetailRow
              label={t('hosts.proxy')}
              value={`${details.proxy.name} · ${proxyTypeLabel(details.proxy.type, t)}`}
            />
          ) : null}
          {details.fingerprint ? (
            <DetailRow
              label={t('workbench.hostLauncher.profiles.details.fingerprint')}
              value={details.fingerprint}
              mono
            />
          ) : null}
          {details.lastConnectedAt ? (
            <DetailRow
              label={t('workbench.hostLauncher.lastConnected')}
              value={formatDateTime(details.lastConnectedAt, t('fields.none'))}
            />
          ) : null}
          {details.lastDirectory ? (
            <DetailRow
              label={t('workbench.hostLauncher.profiles.details.lastDirectory')}
              value={details.lastDirectory}
              mono
            />
          ) : null}
          {desktop?.description ? (
            <DetailRow
              label={t('remoteDesktop.description')}
              value={desktop.description}
            />
          ) : null}
          {desktop ? (
            <>
              <DetailRow
                label={t('remoteDesktop.shared')}
                value={desktop.shared ? t('remoteDesktop.enabled') : t('remoteDesktop.disabled')}
              />
              <DetailRow
                label={t('remoteDesktop.viewOnly')}
                value={desktop.viewOnly ? t('remoteDesktop.enabled') : t('remoteDesktop.disabled')}
              />
              <DetailRow
                label={t('remoteDesktop.displayMode')}
                value={t(`remoteDesktop.display.${desktop.displayMode}`)}
              />
            </>
          ) : null}
        </dl>
      ) : null}
      {profile.availability !== 'ready' ? (
        <p className={styles['details-warning']}>
          <CircleAlert size={12} aria-hidden="true" />
          <span>{t('workbench.hostLauncher.profiles.routeMissing')}</span>
        </p>
      ) : null}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? styles.endpoint : undefined}>{value}</dd>
    </div>
  )
}

function technologyIcon(technology: HostLauncherProfileMenuItem['technology'], size: number): ReactNode {
  if (technology === 'sftp') return <FolderOpen size={size} />
  if (technology === 'vnc') return <MonitorPlay size={size} />
  return <Cable size={size} />
}

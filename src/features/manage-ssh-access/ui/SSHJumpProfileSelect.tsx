import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Unplug,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HostAvatar, type HostGroup } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  AssociationSelect,
  type AssociationSelectItem,
  type AssociationSelectProps,
} from '#shared/ui'
import {
  buildSSHJumpProfileChoices,
  type SSHJumpProfileChoice,
} from '../model/sshJumpProfileChoices.ts'
import styles from './SSHJumpProfileSelect.module.scss'

interface SSHJumpSelectItem extends AssociationSelectItem {
  kind: 'none' | 'profile' | 'missing'
  choice?: SSHJumpProfileChoice
}

interface SSHJumpProfileSelectProps extends Pick<
  AssociationSelectProps<SSHJumpSelectItem>,
  'status' | 'aria-invalid' | 'aria-describedby'
> {
  label: string
  value: string
  profiles: SSHAccessProfile[]
  hosts: HostAsset[]
  groups: HostGroup[]
  editingProfileId?: string
  disabled?: boolean
  getHostIconUrl: (iconId: string) => string
  onChange: (value: string) => void
}

export function SSHJumpProfileSelect({
  label,
  value,
  profiles,
  hosts,
  groups,
  editingProfileId = '',
  disabled = false,
  getHostIconUrl,
  onChange,
  status,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SSHJumpProfileSelectProps) {
  const { t } = useTranslation()
  const choices = useMemo(
    () => buildSSHJumpProfileChoices({ profiles, hosts, groups, editingProfileId }),
    [editingProfileId, groups, hosts, profiles],
  )
  const items = useMemo<SSHJumpSelectItem[]>(() => {
    const next: SSHJumpSelectItem[] = [
      {
        value: '',
        label: t('hosts.noJumpHost'),
        kind: 'none',
        searchText: t('hosts.noJumpHost').toLocaleLowerCase(),
      },
      ...choices.map((choice) => {
        const hostName = choice.hostName ?? t('hosts.access.ssh.jumpHostUnavailable')
        const authLabel = t(`hosts.auth.${choice.profile.auth_method}`)
        const unavailableReasonKey = getUnavailableReasonKey(choice.availability)
        const unavailableReason = unavailableReasonKey ? t(unavailableReasonKey) : ''
        const optionDetails = t('hosts.access.ssh.jumpOptionAria', {
          host: hostName,
          profile: choice.profileName,
          endpoint: choice.endpoint,
          auth: authLabel,
        })
        return {
          value: choice.profile.id,
          label: `${hostName} / ${choice.profileName}`,
          kind: 'profile' as const,
          searchText: `${choice.searchText} ${authLabel}`.toLocaleLowerCase(),
          choice,
          disabled: choice.availability !== 'available',
          ariaLabel: unavailableReason
            ? t('hosts.access.ssh.jumpOptionUnavailableAria', {
                details: optionDetails,
                reason: unavailableReason,
              })
            : optionDetails,
        }
      }),
    ]

    if (value && !next.some((option) => option.value === value)) {
      next.splice(1, 0, {
        value,
        label: value === editingProfileId
          ? t('hosts.access.errors.jumpSelf')
          : t('hosts.access.ssh.jumpProfileUnavailable'),
        kind: 'missing',
        searchText: '',
        disabled: true,
      })
    }
    return next
  }, [choices, editingProfileId, t, value])

  return (
    <AssociationSelect
      label={label}
      value={value}
      items={items}
      disabled={disabled}
      status={status}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      renderSelection={(item) => (
        <SelectedJumpProfile item={item} getHostIconUrl={getHostIconUrl} />
      )}
      renderOption={(item) => (
        <JumpProfileOption item={item} getHostIconUrl={getHostIconUrl} />
      )}
      renderDetails={(item) => item.kind === 'profile' && item.choice
        ? <JumpProfileDetails choice={item.choice} getHostIconUrl={getHostIconUrl} />
        : null}
      onChange={(nextValue) => onChange(nextValue)}
    />
  )
}

function SelectedJumpProfile({
  item,
  getHostIconUrl,
}: {
  item?: SSHJumpSelectItem
  getHostIconUrl: (iconId: string) => string
}) {
  const { t } = useTranslation()
  if (!item || item.kind === 'missing') {
    return (
      <span className={`${styles.selection} ${styles['is-missing']}`}>
        <CircleAlert size={14} aria-hidden="true" />
        <span>{item?.label ?? ''}</span>
      </span>
    )
  }
  if (item.kind === 'none' || !item.choice) {
    return (
      <span className={styles.selection}>
        <Unplug size={14} aria-hidden="true" />
        <span>{item.label}</span>
      </span>
    )
  }
  const choice = item.choice
  const hostName = choice.hostName ?? t('hosts.access.ssh.jumpHostUnavailable')
  return (
    <span className={styles.selection}>
      <HostAvatar
        host={choice.host ?? { name: hostName }}
        getIconUrl={getHostIconUrl}
        size={18}
        iconSize={12}
        compact
      />
      <span className={styles['selection-host']}>{hostName}</span>
      <ChevronRight size={10} aria-hidden="true" />
      <strong>{choice.profileName}</strong>
    </span>
  )
}

function JumpProfileOption({
  item,
  getHostIconUrl,
}: {
  item: SSHJumpSelectItem
  getHostIconUrl: (iconId: string) => string
}) {
  const { t } = useTranslation()
  if (item.kind === 'missing') {
    return (
      <span className={`${styles.option} ${styles['is-missing']}`}>
        <CircleAlert size={14} aria-hidden="true" />
        <span className={styles.identity}>{item.label}</span>
      </span>
    )
  }
  if (item.kind === 'none' || !item.choice) {
    return (
      <span className={styles.option}>
        <span className={styles['option-icon']} aria-hidden="true"><Unplug size={14} /></span>
        <span className={styles.identity}>{item.label}</span>
      </span>
    )
  }

  const choice = item.choice
  const hostName = choice.hostName ?? t('hosts.access.ssh.jumpHostUnavailable')
  return (
    <span className={styles.option}>
      <HostAvatar
        host={choice.host ?? { name: hostName }}
        getIconUrl={getHostIconUrl}
        size={22}
        iconSize={13}
        compact
      />
      <span className={styles.identity}>
        <span className={styles['host-name']}>{hostName}</span>
        <ChevronRight size={10} aria-hidden="true" />
        <strong>{choice.profileName}</strong>
      </span>
    </span>
  )
}

function JumpProfileDetails({
  choice,
  getHostIconUrl,
}: {
  choice: SSHJumpProfileChoice
  getHostIconUrl: (iconId: string) => string
}) {
  const { t } = useTranslation()
  const hostName = choice.hostName ?? t('hosts.access.ssh.jumpHostUnavailable')
  const groupName = !choice.host || choice.groupMissing
    ? t('hosts.access.ssh.jumpGroupUnavailable')
    : choice.groupName ?? t('hosts.ungrouped')
  const unavailableReasonKey = getUnavailableReasonKey(choice.availability)
  const unavailableReason = unavailableReasonKey ? t(unavailableReasonKey) : ''

  return (
    <div className={styles.details}>
      <div className={styles['details-header']}>
        <HostAvatar
          host={choice.host ?? { name: hostName }}
          getIconUrl={getHostIconUrl}
          size={28}
          iconSize={15}
        />
        <span className={styles['details-host']}>
          <strong>{hostName}</strong>
          <small>{groupName}</small>
        </span>
        {choice.profile.is_default ? (
          <span className={styles['default-state']}>
            <CircleCheck size={12} aria-hidden="true" />
            {t('hosts.access.default')}
          </span>
        ) : null}
      </div>
      <dl className={styles['details-list']}>
        <div>
          <dt>{t('hosts.access.profileName')}</dt>
          <dd>{choice.profileName}</dd>
        </div>
        <div>
          <dt>{t('hosts.access.ssh.endpoint')}</dt>
          <dd className={styles.endpoint}>{choice.endpoint}</dd>
        </div>
        <div>
          <dt>{t('hosts.authMethod')}</dt>
          <dd>{t(`hosts.auth.${choice.profile.auth_method}`)}</dd>
        </div>
      </dl>
      {unavailableReason ? (
        <p className={styles['unavailable-reason']}>
          <CircleAlert size={12} aria-hidden="true" />
          <span>{unavailableReason}</span>
        </p>
      ) : null}
    </div>
  )
}

function getUnavailableReasonKey(availability: SSHJumpProfileChoice['availability']) {
  if (availability === 'nested_jump') return 'hosts.access.ssh.jumpNestedUnsupported'
  if (availability === 'consumer_route_locked') {
    return 'hosts.access.ssh.jumpConsumerRouteLocked'
  }
  return ''
}

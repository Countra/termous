import type { AppLanguage } from '#common/contracts'
import type { HostGroup } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export type SSHJumpProfileAvailability =
  | 'available'
  | 'nested_jump'
  | 'consumer_route_locked'

export interface SSHJumpProfileChoice {
  profile: SSHAccessProfile
  host?: HostAsset
  hostName?: string
  profileName: string
  groupName?: string
  groupMissing: boolean
  endpoint: string
  availability: SSHJumpProfileAvailability
  searchText: string
}

interface BuildSSHJumpProfileChoicesInput {
  profiles: SSHAccessProfile[]
  hosts: HostAsset[]
  groups: HostGroup[]
  language: AppLanguage
  editingProfileId?: string
}

export function buildSSHJumpProfileChoices({
  profiles,
  hosts,
  groups,
  language,
  editingProfileId = '',
}: BuildSSHJumpProfileChoicesInput): SSHJumpProfileChoice[] {
  const displayNameCollator = new Intl.Collator(language, {
    usage: 'sort',
    numeric: true,
    sensitivity: 'base',
  })
  const hostsById = new Map(hosts.map((host) => [host.id, host]))
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const consumerRouteLocked = Boolean(
    editingProfileId
    && profiles.some((profile) => profile.jump_ssh_profile_id === editingProfileId),
  )

  return profiles
    .filter((profile) => profile.id !== editingProfileId)
    .map((profile) => {
      const host = hostsById.get(profile.host_id)
      const group = host?.group_id ? groupsById.get(host.group_id) : undefined
      const endpoint = formatSSHJumpEndpoint(profile)
      const profileName = profile.name.trim() || endpoint
      const hostName = host?.name.trim() || undefined
      const groupName = group?.name.trim() || undefined
      const availability: SSHJumpProfileAvailability = consumerRouteLocked
        ? 'consumer_route_locked'
        : profile.jump_ssh_profile_id
          ? 'nested_jump'
          : 'available'

      return {
        profile,
        host,
        hostName,
        profileName,
        groupName,
        groupMissing: Boolean(host?.group_id && !group),
        endpoint,
        availability,
        searchText: [
          hostName,
          profile.host_id,
          groupName,
          profileName,
          profile.username,
          profile.address,
          String(profile.port),
          endpoint,
          profile.auth_method,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase(),
      }
    })
    .sort((left, right) => compareSSHJumpProfileChoices(left, right, displayNameCollator))
}

export function formatSSHJumpEndpoint(
  profile: Pick<SSHAccessProfile, 'address' | 'port' | 'username'>,
) {
  const address = profile.address.includes(':')
    && !(profile.address.startsWith('[') && profile.address.endsWith(']'))
    ? `[${profile.address}]`
    : profile.address
  return `${profile.username}@${address}:${profile.port}`
}

function compareSSHJumpProfileChoices(
  left: SSHJumpProfileChoice,
  right: SSHJumpProfileChoice,
  displayNameCollator: Intl.Collator,
) {
  if (Boolean(left.host) !== Boolean(right.host)) return left.host ? -1 : 1
  return displayNameCollator.compare(left.hostName ?? '', right.hostName ?? '')
    || compareStableIdentifier(left.profile.host_id, right.profile.host_id)
    || Number(right.profile.is_default) - Number(left.profile.is_default)
    || left.profile.sort_order - right.profile.sort_order
    || displayNameCollator.compare(left.profileName, right.profileName)
    || compareStableIdentifier(left.profile.id, right.profile.id)
}

function compareStableIdentifier(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

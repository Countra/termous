import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
} from './types.ts'

export function remoteDesktopAccessProfileToInput(
  profile: RemoteDesktopAccessProfile,
): RemoteDesktopAccessProfileInput {
  return {
    host_id: profile.host_id,
    name: profile.name,
    description: profile.description,
    route: profile.route,
    route_config_version: profile.route_config_version,
    ssh_profile_id: profile.ssh_profile_id,
    protocol: profile.protocol,
    protocol_config_version: profile.protocol_config_version,
    vnc: { ...profile.vnc },
  }
}

export function sortRemoteDesktopAccessProfiles(
  profiles: RemoteDesktopAccessProfile[],
) {
  return [...profiles].sort((left, right) => (
    left.host_id.localeCompare(right.host_id)
    || left.sort_order - right.sort_order
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ))
}

export function selectDefaultRemoteDesktopAccessProfile(
  profiles: RemoteDesktopAccessProfile[],
  hostId: string,
) {
  const defaults = profiles.filter((profile) => profile.host_id === hostId && profile.is_default)
  return defaults.length === 1 ? defaults[0] : undefined
}

import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopProtocol,
} from './types.ts'

export interface RemoteDesktopTechnologyDescriptor {
  id: RemoteDesktopProtocol
  label: string
}

export interface RemoteDesktopAccessProfileProjection {
  profileId: string
  hostId: string
  name: string
  technology: RemoteDesktopTechnologyDescriptor
  endpoint: string
  routeDependency: {
    kind: 'ssh_profile'
    profileId: string
  }
  isDefault: boolean
  sortOrder: number
}

const technologyDescriptors = {
  vnc: { id: 'vnc', label: 'VNC' },
} satisfies Record<RemoteDesktopProtocol, RemoteDesktopTechnologyDescriptor>

type RemoteDesktopProfileProjectors = {
  [Protocol in RemoteDesktopProtocol]: (
    profile: Extract<RemoteDesktopAccessProfile, { protocol: Protocol }>,
  ) => RemoteDesktopAccessProfileProjection
}

const profileProjectors = {
  vnc: (profile) => ({
    profileId: profile.id,
    hostId: profile.host_id,
    name: profile.name,
    technology: technologyDescriptors.vnc,
    endpoint: formatHostPort(profile.vnc.loopback_host, profile.vnc.port),
    routeDependency: {
      kind: 'ssh_profile',
      profileId: profile.ssh_profile_id,
    },
    isDefault: profile.is_default,
    sortOrder: profile.sort_order,
  }),
} satisfies RemoteDesktopProfileProjectors

export function getRemoteDesktopTechnologyDescriptor(protocol: RemoteDesktopProtocol) {
  return technologyDescriptors[protocol]
}

export function projectRemoteDesktopAccessProfile(
  profile: RemoteDesktopAccessProfile,
): RemoteDesktopAccessProfileProjection {
  const projector = profileProjectors[profile.protocol] as (
    candidate: RemoteDesktopAccessProfile,
  ) => RemoteDesktopAccessProfileProjection
  return projector(profile)
}

function formatHostPort(host: string, port: number) {
  const normalizedHost = host.includes(':') && !host.startsWith('[')
    ? `[${host}]`
    : host
  return `${normalizedHost}:${port}`
}

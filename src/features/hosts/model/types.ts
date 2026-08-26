import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type { FileSession } from '#entities/file'
import type { ForwardInstance } from '#entities/forward'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { Host, HostGroup, HostIcon, HostReachability } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

interface HostConfigurationData {
  groups: HostGroup[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
}

export interface HostManagementData extends HostConfigurationData {
  hosts: Host[]
  hostAssets: HostAsset[]
  sshAccessProfiles: SSHAccessProfile[]
  hostIcons: HostIcon[]
  sessions: Session[]
  fileSessions: FileSession[]
  forwards: ForwardInstance[]
  remoteDesktopSessions: RemoteDesktopSession[]
}

export interface HostLauncherProfileData {
  sshAccessProfiles: SSHAccessProfile[]
  fileAccessProfiles: FileAccessProfile[]
  remoteDesktopProfiles: RemoteDesktopAccessProfile[]
}

export interface HostLauncherData extends HostConfigurationData, HostLauncherProfileData {
  hostAssets: HostAsset[]
  hostReachability: Record<string, HostReachability>
}

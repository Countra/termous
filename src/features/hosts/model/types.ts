import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type { FileSession } from '#entities/file'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { Host, HostGroup, HostIcon, HostReachability } from '#entities/host'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

interface HostConfigurationData {
  hosts: Host[]
  groups: HostGroup[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
}

export interface HostManagementData extends HostConfigurationData {
  hostIcons: HostIcon[]
  sessions: Session[]
  fileSessions: FileSession[]
}

export interface HostLauncherProfileData {
  sshAccessProfiles: SSHAccessProfile[]
  fileAccessProfiles: FileAccessProfile[]
  remoteDesktopProfiles: RemoteDesktopAccessProfile[]
}

export interface HostLauncherData extends HostConfigurationData, HostLauncherProfileData {
  hostReachability: Record<string, HostReachability>
}

import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type { Host, HostGroup, HostIcon, HostReachability } from '#entities/host'

interface HostConfigurationData {
  hosts: Host[]
  groups: HostGroup[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
}

export interface HostManagementData extends HostConfigurationData {
  hostIcons: HostIcon[]
}

export interface HostLauncherData extends HostConfigurationData {
  hostReachability: Record<string, HostReachability>
}

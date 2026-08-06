import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type { Host, HostGroup, HostReachability } from '#entities/host'

export interface HostManagementData {
  hosts: Host[]
  groups: HostGroup[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
}

export interface HostLauncherData extends HostManagementData {
  hostReachability: Record<string, HostReachability>
}

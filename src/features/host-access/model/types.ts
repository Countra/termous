import type { FileAccessProfile, FileAccessProfileMetadataInput } from '#entities/file-access-profile'
import type { HostAccessCatalog, HostAsset, HostAssetInput } from '#entities/host-asset'
import type { HostReachability } from '#entities/host'
import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
} from '#entities/remote-desktop'
import type {
  ProvisionedSSHAccessProfile,
  SSHAccessProfile,
  SSHAccessProfileInput,
  SSHAccessProfileReferences,
} from '#entities/ssh-access-profile'

export interface HostAccessManagementGateway {
  loadCatalog: (hostId: string) => Promise<HostAccessCatalog>
  listSSHProfiles: () => Promise<SSHAccessProfile[]>
  updateHostAsset: (
    id: string,
    expectedUpdatedAt: string,
    input: HostAssetInput,
  ) => Promise<HostAsset>
  createSSHProfile: (
    hostId: string,
    input: SSHAccessProfileInput,
  ) => Promise<ProvisionedSSHAccessProfile>
  updateSSHProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: SSHAccessProfileInput,
  ) => Promise<SSHAccessProfile>
  deleteSSHProfile: (id: string, expectedUpdatedAt: string) => Promise<void>
  setDefaultSSHProfile: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<SSHAccessProfile>
  inspectSSHProfileReferences: (id: string) => Promise<SSHAccessProfileReferences>
  updateFileProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: FileAccessProfileMetadataInput,
  ) => Promise<FileAccessProfile>
  setDefaultFileProfile: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<FileAccessProfile>
  createRemoteDesktopProfile: (
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
  updateRemoteDesktopProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
  deleteRemoteDesktopProfile: (id: string, expectedUpdatedAt: string) => Promise<void>
  saveRemoteDesktopTargetAuth: (
    id: string,
    expectedUpdatedAt: string,
    password: string,
  ) => Promise<RemoteDesktopAccessProfile>
  deleteRemoteDesktopTargetAuth: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<RemoteDesktopAccessProfile>
  setDefaultRemoteDesktopProfile: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<RemoteDesktopAccessProfile>
}

export interface SSHProfileReachabilityGateway {
  loadSSHProfileReachability: () => Promise<HostReachability[]>
  refreshSSHProfileReachability: (
    sshProfileIds?: string[],
    force?: boolean,
  ) => Promise<HostReachability[]>
  sshProfileReachabilityEventsUrl: () => string
}

export type HostAccessWorkspaceGateway = HostAccessManagementGateway & SSHProfileReachabilityGateway

export type HostAccessProfileKind = 'ssh' | 'file' | 'remote_desktop'

export type HostAccessProfileEditorIntent =
  | { kind: 'ssh'; mode: 'create' }
  | { kind: 'ssh'; mode: 'edit'; profileId: string }
  | { kind: 'file'; mode: 'edit'; profileId: string }
  | { kind: 'remote_desktop'; mode: 'create' }
  | { kind: 'remote_desktop'; mode: 'edit'; profileId: string }

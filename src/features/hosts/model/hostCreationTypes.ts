import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type { HostAssetInput } from '#entities/host-asset'
import type { SSHAccessProfile, SSHAccessProfileDraft } from '#entities/ssh-access-profile'
import type { VNCAccessProfileDraft, VNCTargetAuthDraft } from '#features/manage-remote-desktop'

export type HostCreationConnectionKind = 'ssh' | 'file' | 'remote_desktop'

export interface HostCreationSSH {
  id: string
  draft: SSHAccessProfileDraft
  fileName: string
  isDefault: boolean
  fileIsDefault: boolean
}

export interface HostCreationDesktop {
  id: string
  draft: VNCAccessProfileDraft
  targetAuthDraft: VNCTargetAuthDraft
  isDefault: boolean
}

export interface HostCreationDraft {
  clientRequestId: string
  host: HostAssetInput
  ssh: HostCreationSSH[]
  remoteDesktops: HostCreationDesktop[]
}

export interface HostCreationDependencies {
  sshProfiles: readonly SSHAccessProfile[]
  credentials: readonly Pick<CredentialView, 'id' | 'type'>[]
  proxies: readonly Pick<ConnectionProxy, 'id'>[]
}

export interface HostCreationIssue {
  kind: 'asset' | HostCreationConnectionKind
  id?: string
  field: string
  code: string
}

export interface HostCreationValidation {
  issues: HostCreationIssue[]
  firstIssue?: HostCreationIssue
  incomplete: Record<HostCreationConnectionKind, string[]>
}

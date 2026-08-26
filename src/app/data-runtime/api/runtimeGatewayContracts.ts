import type {
  AppearanceSettings,
  CompletionSettings,
  ConnectionSettings,
  Settings,
  ShortcutSettingsPatch,
  TerminalFont,
  TerminalSettings,
  WindowSettings,
} from '#common/contracts'
import type { ConnectionProxy, ConnectionProxyInput } from '#entities/connection-proxy'
import type {
  FileAccessProfile,
  FileAccessProfileMetadataInput,
} from '#entities/file-access-profile'
import type {
  CredentialInput,
  CredentialView,
  PrivateKeyCredentialBundleInput,
  PrivateKeyCredentialBundleResult,
} from '#entities/credential'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
  FileSession,
  FileSessionCreateInput,
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
} from '#entities/file'
import type {
  ForwardInstance,
  ForwardProfile,
  ForwardProfileInput,
  ForwardStartRequest,
} from '#entities/forward'
import type {
  Host,
  HostGroup,
  HostIcon,
  HostIconReorderItem,
  HostInput,
  HostReachability,
} from '#entities/host'
import type {
  HostAccessCatalog,
  HostAsset,
  HostAssetInput,
} from '#entities/host-asset'
import type { LocalShell, Session } from '#entities/session'
import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import type {
  ProvisionedSSHAccessProfile,
  SSHAccessProfile,
  SSHAccessProfileInput,
  SSHAccessProfileReferences,
} from '#entities/ssh-access-profile'
import type {
  CodeSnippet,
  CodeSnippetGroup,
  CodeSnippetGroupInput,
  CodeSnippetInput,
} from '#entities/snippet'
import type { GroupReorderItem } from '#shared/model'

export interface AppDataSnapshotGateway {
  settings: () => Promise<Settings>
  terminalFonts: () => Promise<TerminalFont[]>
  codeSnippetGroups: () => Promise<CodeSnippetGroup[]>
  codeSnippets: () => Promise<CodeSnippet[]>
  fileBookmarkGroups: () => Promise<FileBookmarkGroup[]>
  fileBookmarks: () => Promise<FileBookmark[]>
  localPathMappings: () => Promise<LocalPathMapping[]>
  hostGroups: () => Promise<HostGroup[]>
  hostIcons: () => Promise<HostIcon[]>
  connectionProxies: () => Promise<ConnectionProxy[]>
  hosts: () => Promise<Host[]>
  hostReachability: () => Promise<HostReachability[]>
  credentials: () => Promise<CredentialView[]>
  sessions: () => Promise<Session[]>
  fileSessions: () => Promise<FileSession[]>
  sshAccessProfiles: () => Promise<SSHAccessProfile[]>
  fileAccessProfiles: () => Promise<FileAccessProfile[]>
  forwardProfiles: () => Promise<ForwardProfile[]>
  forwards: () => Promise<ForwardInstance[]>
  remoteDesktopProfiles: () => Promise<RemoteDesktopAccessProfile[]>
  remoteDesktopSessions: () => Promise<RemoteDesktopSession[]>
}

export interface CredentialCommandGateway {
  createCredential: (input: CredentialInput) => Promise<CredentialView>
  updateCredential: (id: string, input: CredentialInput) => Promise<CredentialView>
  deleteCredential: (id: string) => Promise<void>
  createPrivateKeyCredentialBundle: (
    input: PrivateKeyCredentialBundleInput,
  ) => Promise<PrivateKeyCredentialBundleResult>
}

export interface FileCatalogCommandGateway {
  createFileBookmarkGroup: (input: FileBookmarkGroupInput) => Promise<FileBookmarkGroup>
  updateFileBookmarkGroup: (id: string, input: FileBookmarkGroupInput) => Promise<FileBookmarkGroup>
  deleteFileBookmarkGroup: (id: string) => Promise<void>
  reorderFileBookmarkGroups: (items: FileBookmarkGroupReorderItem[]) => Promise<FileBookmarkGroup[]>
  fileBookmarks: () => Promise<FileBookmark[]>
  createFileBookmark: (input: FileBookmarkInput) => Promise<FileBookmark>
  updateFileBookmark: (id: string, input: FileBookmarkInput) => Promise<FileBookmark>
  deleteFileBookmark: (id: string) => Promise<void>
  reorderFileBookmarks: (items: FileBookmarkReorderItem[]) => Promise<FileBookmark[]>
  createLocalPathMapping: (input: LocalPathMappingInput) => Promise<LocalPathMapping>
  updateLocalPathMapping: (id: string, input: LocalPathMappingInput) => Promise<LocalPathMapping>
  deleteLocalPathMapping: (id: string) => Promise<void>
  reorderLocalPathMappings: (items: LocalPathMappingReorderItem[]) => Promise<LocalPathMapping[]>
}

export interface ForwardProfileCommandGateway {
  createForwardProfile: (input: ForwardProfileInput) => Promise<ForwardProfile>
  updateForwardProfile: (id: string, input: ForwardProfileInput) => Promise<ForwardProfile>
  deleteForwardProfile: (id: string) => Promise<void>
}

export interface HostCommandGateway {
  uploadHostIcon: (file: File) => Promise<HostIcon>
  renameHostIcon: (id: string, displayName: string) => Promise<HostIcon>
  reorderHostIcons: (items: HostIconReorderItem[]) => Promise<HostIcon[]>
  deleteHostIcon: (id: string) => Promise<void>
  createHost: (input: HostInput) => Promise<Host>
  createHostGroup: (name: string) => Promise<HostGroup>
  updateHostGroup: (id: string, name: string) => Promise<HostGroup>
  deleteHostGroup: (id: string) => Promise<void>
  reorderHostGroups: (items: GroupReorderItem[]) => Promise<HostGroup[]>
  createConnectionProxy: (input: ConnectionProxyInput) => Promise<ConnectionProxy>
  updateConnectionProxy: (id: string, input: ConnectionProxyInput) => Promise<ConnectionProxy>
  deleteConnectionProxy: (id: string) => Promise<void>
  updateHost: (id: string, input: HostInput) => Promise<Host>
  deleteHost: (id: string) => Promise<void>
  refreshHostReachability: (hostIds?: string[], force?: boolean) => Promise<HostReachability[]>
  hostAssets: () => Promise<HostAsset[]>
  hostAsset: (id: string) => Promise<HostAsset>
  updateHostAsset: (
    id: string,
    expectedUpdatedAt: string,
    input: HostAssetInput,
  ) => Promise<HostAsset>
  hostAccessCatalog: (hostId: string) => Promise<HostAccessCatalog>
  sshAccessProfiles: (hostId?: string) => Promise<SSHAccessProfile[]>
  sshAccessProfile: (id: string) => Promise<SSHAccessProfile>
  createSSHAccessProfile: (
    hostId: string,
    input: SSHAccessProfileInput,
  ) => Promise<ProvisionedSSHAccessProfile>
  updateSSHAccessProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: SSHAccessProfileInput,
  ) => Promise<SSHAccessProfile>
  deleteSSHAccessProfile: (id: string, expectedUpdatedAt: string) => Promise<void>
  setDefaultSSHAccessProfile: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<SSHAccessProfile>
  inspectSSHAccessProfileReferences: (id: string) => Promise<SSHAccessProfileReferences>
  fileAccessProfiles: (hostId?: string) => Promise<FileAccessProfile[]>
  fileAccessProfile: (id: string) => Promise<FileAccessProfile>
  updateFileAccessProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: FileAccessProfileMetadataInput,
  ) => Promise<FileAccessProfile>
  setDefaultFileAccessProfile: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<FileAccessProfile>
  remoteDesktopAccessProfiles: (hostId?: string) => Promise<RemoteDesktopAccessProfile[]>
  remoteDesktopAccessProfile: (id: string) => Promise<RemoteDesktopAccessProfile>
  createRemoteDesktopAccessProfile: (
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
  updateRemoteDesktopAccessProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
  deleteRemoteDesktopAccessProfile: (id: string, expectedUpdatedAt: string) => Promise<void>
  setDefaultRemoteDesktopAccessProfile: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<RemoteDesktopAccessProfile>
}

export interface SettingsCommandGateway {
  settings: () => Promise<Settings>
  updateLanguage: (language: Settings['language']) => Promise<Settings>
  updateAppearanceSettings: (appearance: AppearanceSettings) => Promise<Settings>
  updateTerminalSettings: (terminal: TerminalSettings) => Promise<Settings>
  updateCompletionSettings: (completion: CompletionSettings) => Promise<Settings>
  updateConnectionSettings: (connection: ConnectionSettings) => Promise<Settings>
  updateShortcutSettings: (patch: ShortcutSettingsPatch) => Promise<Settings>
  updateWindowSettings: (windowSettings: WindowSettings) => Promise<Settings>
  terminalFonts: () => Promise<TerminalFont[]>
  uploadTerminalFont: (file: File) => Promise<TerminalFont>
  deleteTerminalFont: (id: string) => Promise<void>
}

export interface SnippetCommandGateway {
  createCodeSnippet: (input: CodeSnippetInput) => Promise<CodeSnippet>
  updateCodeSnippet: (id: string, input: CodeSnippetInput) => Promise<CodeSnippet>
  deleteCodeSnippet: (id: string) => Promise<void>
  markCodeSnippetUsed: (id: string) => Promise<CodeSnippet>
  createCodeSnippetGroup: (input: CodeSnippetGroupInput) => Promise<CodeSnippetGroup>
  updateCodeSnippetGroup: (id: string, input: CodeSnippetGroupInput) => Promise<CodeSnippetGroup>
  deleteCodeSnippetGroup: (id: string) => Promise<void>
  reorderCodeSnippetGroups: (items: GroupReorderItem[]) => Promise<CodeSnippetGroup[]>
}

export interface ForwardRuntimeGateway {
  getForward: (id: string) => Promise<ForwardInstance>
  forwards: () => Promise<ForwardInstance[]>
}

export interface ForwardCommandGateway extends ForwardRuntimeGateway {
  startForward: (input: ForwardStartRequest) => Promise<ForwardInstance>
  stopForward: (id: string) => Promise<void>
}

export type SSHSessionCreateInput =
  | { hostId: string; sshProfileId?: never }
  | { hostId?: never; sshProfileId: string }

export interface SessionCommandGateway {
  createSession: (hostId: string, cols: number, rows: number) => Promise<Session>
  createSSHSession: (
    input: SSHSessionCreateInput,
    cols: number,
    rows: number,
  ) => Promise<Session>
  createLocalSession: (shell: LocalShell, cols: number, rows: number) => Promise<Session>
  deleteSession: (id: string) => Promise<void>
  refreshSessionInventory: (
    id: string,
    force?: boolean,
    options?: { signal?: AbortSignal },
  ) => Promise<Session>
}

export interface FileSessionCommandGateway {
  createFileSession: (input: FileSessionCreateInput) => Promise<FileSession>
  deleteFileSession: (id: string) => Promise<void>
  reconnectFileSession: (id: string) => Promise<FileSession>
}

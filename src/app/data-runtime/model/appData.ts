import type { Settings, TerminalFont } from '#common/contracts'
import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileSession,
  LocalPathMapping,
} from '#entities/file'
import type { ForwardInstance, ForwardProfile } from '#entities/forward'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { Host, HostGroup, HostIcon, HostReachability } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { CodeSnippet, CodeSnippetGroup } from '#entities/snippet'
import type { Session } from './sessionTypes'

export interface AppData {
  hosts: Host[]
  hostAssets: HostAsset[]
  groups: HostGroup[]
  hostIcons: HostIcon[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
  sessions: Session[]
  fileSessions: FileSession[]
  sshAccessProfiles: SSHAccessProfile[]
  fileAccessProfiles: FileAccessProfile[]
  forwardProfiles: ForwardProfile[]
  forwards: ForwardInstance[]
  remoteDesktopProfiles: RemoteDesktopAccessProfile[]
  remoteDesktopSessions: RemoteDesktopSession[]
  snippetGroups: CodeSnippetGroup[]
  snippets: CodeSnippet[]
  fileBookmarkGroups: FileBookmarkGroup[]
  fileBookmarks: FileBookmark[]
  localPathMappings: LocalPathMapping[]
  settings: Settings
  terminalFonts: TerminalFont[]
  hostReachability: Record<string, HostReachability>
}

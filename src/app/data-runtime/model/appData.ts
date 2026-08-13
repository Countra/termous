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
import type { Host, HostGroup, HostIcon, HostReachability } from '#entities/host'
import type { CodeSnippet, CodeSnippetGroup } from '#entities/snippet'
import type { Session } from './sessionTypes'

export interface AppData {
  hosts: Host[]
  groups: HostGroup[]
  hostIcons: HostIcon[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
  sessions: Session[]
  fileSessions: FileSession[]
  forwardProfiles: ForwardProfile[]
  forwards: ForwardInstance[]
  snippetGroups: CodeSnippetGroup[]
  snippets: CodeSnippet[]
  fileBookmarkGroups: FileBookmarkGroup[]
  fileBookmarks: FileBookmark[]
  localPathMappings: LocalPathMapping[]
  settings: Settings
  terminalFonts: TerminalFont[]
  hostReachability: Record<string, HostReachability>
}

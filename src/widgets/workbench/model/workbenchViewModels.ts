import type { TerminalSettings } from '#common/contracts'
import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type { FileBookmark, FileBookmarkGroup, FileSession } from '#entities/file'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { Host, HostGroup, HostReachability } from '#entities/host'
import type { Session } from '#entities/session'
import type { CodeSnippet, CodeSnippetGroup } from '#entities/snippet'

export interface WorkbenchHostView {
  hosts: Host[]
  groups: HostGroup[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
  hostReachability: Record<string, HostReachability>
}

export interface WorkbenchSessionView {
  sessions: Session[]
  terminalSettings: TerminalSettings
}

export interface WorkbenchFilesView {
  fileBookmarkGroups: FileBookmarkGroup[]
  fileBookmarks: FileBookmark[]
  fileSessions: FileSession[]
  fileAccessProfiles: FileAccessProfile[]
}

export interface WorkbenchSnippetView {
  snippetGroups: CodeSnippetGroup[]
  snippets: CodeSnippet[]
}

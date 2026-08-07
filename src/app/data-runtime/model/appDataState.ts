import type {
  Settings,
  TerminalFont,
} from '#common/contracts'
import type { HostGroup, HostReachability, HostReachabilityEvent } from '#entities/host'
import type {
  FileBookmark,
  FileBookmarkGroup,
  LocalPathMapping,
  FileSessionClosureState,
} from '#entities/file'
import {
  defaultAppearanceSettings,
  defaultCompletionSettings,
  defaultShortcutSettings,
  defaultTerminalSettings,
  defaultWindowSettings,
} from '#features/settings'
import type { AppData } from './appData'
import type { Session } from './sessionTypes'

export type LoadMode = 'initial' | 'background' | 'silent'

const initialSettings: Settings = {
  language: 'zh-CN',
  appearance: defaultAppearanceSettings,
  terminal: defaultTerminalSettings,
  completion: defaultCompletionSettings,
  shortcuts: defaultShortcutSettings,
  window: defaultWindowSettings,
}

export const initialData: AppData = {
  hosts: [],
  groups: [],
  proxies: [],
  credentials: [],
  sessions: [],
  fileSessions: [],
  forwardProfiles: [],
  forwards: [],
  snippetGroups: [],
  snippets: [],
  fileBookmarkGroups: [],
  fileBookmarks: [],
  localPathMappings: [],
  settings: initialSettings,
  terminalFonts: [],
  hostReachability: {},
}

export function removeMatchingFileSessionClosure(
  closures: Record<string, FileSessionClosureState>,
  sourceSessionId: string,
  fileSessionId: string,
) {
  const closure = closures[sourceSessionId]
  if (!closure || closure.session.id !== fileSessionId) {
    return closures
  }
  const next = { ...closures }
  delete next[sourceSessionId]
  return next
}

export function reconcileActiveSession(current: Session | null, nextSessions: Session[], mode: LoadMode) {
  if (current) {
    const updated = nextSessions.find((session) => session.id === current.id)
    if (updated) {
      return updated
    }
  }
  if (mode === 'initial') {
    return nextSessions[0] ?? null
  }
  return null
}

export function upsertTerminalFont(fonts: TerminalFont[], next: TerminalFont) {
  const exists = fonts.some((font) => font.id === next.id)
  if (exists) {
    return fonts.map((font) => (font.id === next.id ? next : font))
  }
  return [next, ...fonts]
}

export function upsertHostGroup(groups: HostGroup[], next: HostGroup) {
  const exists = groups.some((group) => group.id === next.id)
  const merged = exists ? groups.map((group) => (group.id === next.id ? next : group)) : [...groups, next]
  return [...merged].sort(sortHostGroups)
}

export function sortHostGroups(left: HostGroup, right: HostGroup) {
  if (left.sort_order !== right.sort_order) {
    return left.sort_order - right.sort_order
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name)
  }
  return left.id.localeCompare(right.id)
}

export function sortConnectionProxies(proxies: AppData['proxies']) {
  return [...proxies].sort((left, right) => (
    left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ))
}

export function upsertConnectionProxy(
  proxies: AppData['proxies'],
  next: AppData['proxies'][number],
) {
  const exists = proxies.some((proxy) => proxy.id === next.id)
  return sortConnectionProxies(
    exists
      ? proxies.map((proxy) => (proxy.id === next.id ? next : proxy))
      : [...proxies, next],
  )
}

export function upsertSession(sessions: Session[], next: Session) {
  const exists = sessions.some((session) => session.id === next.id)
  if (exists) {
    return sessions.map((session) => (session.id === next.id ? next : session))
  }
  return [...sessions, next]
}

export function markHostRecentlyConnected(
  hosts: AppData['hosts'],
  sessions: Session[],
  sessionId: string,
  patch: Partial<Session>,
) {
  const sessionsWithPatch = sessions.map((session) => (session.id === sessionId ? { ...session, ...patch } : session))
  const updatedSession = sessionsWithPatch.find((session) => session.id === sessionId)
  if (updatedSession?.kind !== 'ssh' || updatedSession.status !== 'connected' || !updatedSession.host_id) {
    return { hosts, sessions: sessionsWithPatch }
  }
  const connectedAt = updatedSession.connected_at ?? new Date().toISOString()
  return {
    hosts: hosts.map((host) => (host.id === updatedSession.host_id ? { ...host, last_connected_at: connectedAt } : host)),
    sessions: sessionsWithPatch,
  }
}

export function upsertFileBookmarkGroup(groups: FileBookmarkGroup[], next: FileBookmarkGroup) {
  const exists = groups.some((group) => group.id === next.id)
  const merged = exists ? groups.map((group) => (group.id === next.id ? next : group)) : [...groups, next]
  return sortFileBookmarkGroups(merged)
}

export function sortFileBookmarkGroups(groups: FileBookmarkGroup[]) {
  return [...groups].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name)
    }
    return left.id.localeCompare(right.id)
  })
}

export function upsertFileBookmark(bookmarks: FileBookmark[], next: FileBookmark) {
  const exists = bookmarks.some((bookmark) => bookmark.id === next.id)
  const merged = exists ? bookmarks.map((bookmark) => (bookmark.id === next.id ? next : bookmark)) : [...bookmarks, next]
  return sortFileBookmarks(merged)
}

export function sortFileBookmarks(bookmarks: FileBookmark[]) {
  return [...bookmarks].sort((left, right) => {
    if (left.group_id !== right.group_id) {
      return left.group_id.localeCompare(right.group_id)
    }
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name)
    }
    return left.id.localeCompare(right.id)
  })
}

export function upsertLocalPathMapping(mappings: LocalPathMapping[], next: LocalPathMapping) {
  const exists = mappings.some((mapping) => mapping.id === next.id)
  const merged = exists ? mappings.map((mapping) => (mapping.id === next.id ? next : mapping)) : [...mappings, next]
  return sortLocalPathMappings(merged)
}

export function sortLocalPathMappings(mappings: LocalPathMapping[]) {
  return [...mappings].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name)
    }
    return left.id.localeCompare(right.id)
  })
}

export function bumpSessionRevision(revisions: Map<string, number>, sessionId: string) {
  revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1)
}

export function sessionInventorySignature(session: Partial<Session>) {
  return [
    session.inventory_status ?? 'idle',
    session.inventory_message ?? '',
    session.linux_system_info?.collected_at ?? '',
  ].join('\u0000')
}

export function indexHostReachability(states: HostReachability[]) {
  return states.reduce<Record<string, HostReachability>>((acc, state) => {
    acc[state.host_id] = state
    return acc
  }, {})
}

export function mergeHostReachabilityStates(
  current: Record<string, HostReachability>,
  states: HostReachability[],
) {
  if (states.length === 0) {
    return current
  }
  return { ...current, ...indexHostReachability(states) }
}

export function mergeHostReachabilityEvent(
  current: Record<string, HostReachability>,
  event: HostReachabilityEvent,
) {
  if (event.type === 'snapshot' && event.items) {
    return indexHostReachability(event.items)
  }
  if (event.state) {
    return { ...current, [event.state.host_id]: event.state }
  }
  return current
}

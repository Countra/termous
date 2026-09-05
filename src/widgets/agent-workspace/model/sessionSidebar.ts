import type { AgentSessionGroup } from '#entities/agent'
import { compareAgentSessionOrder } from '#entities/agent'
import type { AgentWorkspaceSession } from './types.ts'

export type SessionSidebarPlacement = 'before' | 'after'
export type SessionSidebarExecute = (key: string, operation: () => Promise<void> | void) => Promise<boolean>
export type SessionSidebarDrag = { kind: 'session' | 'group'; id: string }
export type SessionSidebarDrop =
  | { kind: 'group'; id?: string }
  | { kind: 'pin-area' }
  | { kind: 'session-order' | 'group-order'; id: string; placement: SessionSidebarPlacement }

export const sessionSidebarStorageKey = 'termous.ui.agent.sidebar.collapsed.v1'
export const sessionSidebarPinSection = '$pinned'
export const sessionSidebarUngroupedSection = '$ungrouped'

export function parseSessionSidebarCollapsed(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))]
    : []
}

export function sessionSidebarNameValid(value: string, maxBytes = 200, maxCharacters?: number) {
  const title = value.trim()
  return title.length > 0 && (maxCharacters === undefined
    ? new TextEncoder().encode(title).length <= maxBytes
    : Array.from(title).length <= maxCharacters)
}

export function partitionSidebarSessions(sessions: AgentWorkspaceSession[], groups: AgentSessionGroup[]) {
  const groupIds = new Set(groups.map(({ id }) => id))
  const unique = [...new Map(sessions.filter(({ archived }) => !archived).map((session) => [session.id, session])).values()]
  const pinned = unique.filter(({ pinned }) => pinned).sort((left, right) => (
    (left.pin_order ?? 0) - (right.pin_order ?? 0) || left.id.localeCompare(right.id)
  ))
  const ordinary = unique.filter(({ pinned }) => !pinned).sort(compareAgentSessionOrder)
  const grouped = new Map(groups.map(({ id }) => [id, ordinary.filter((session) => session.group_id === id)]))
  return {
    pinned,
    grouped,
    ungrouped: ordinary.filter(({ group_id }) => !group_id || !groupIds.has(group_id)),
    groups: [...groups].sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id)),
  }
}

// 只接受本侧栏发起、且当前数据中仍存在的拖动；外部文本不能伪装成会话 ID。
export function validSessionSidebarDrop(
  source: SessionSidebarDrag | undefined,
  target: SessionSidebarDrop,
  sessions: AgentWorkspaceSession[],
  groups: AgentSessionGroup[],
  pendingIds: ReadonlySet<string>,
) {
  if (!source || pendingIds.has(source.id)) return false
  if (source.kind === 'group') {
    return target.kind === 'group-order' && source.id !== target.id
      && !pendingIds.has('group-order') && !pendingIds.has(target.id)
      && groups.some(({ id }) => id === source.id) && groups.some(({ id }) => id === target.id)
  }
  const session = sessions.find(({ id, archived }) => id === source.id && !archived)
  if (!session) return false
  if (target.kind === 'group') {
    return (Boolean(session.pinned) || (session.group_id || undefined) !== target.id)
      && (!session.pinned || !pendingIds.has('pin-order'))
      && (!target.id || groups.some(({ id }) => id === target.id) && !pendingIds.has(target.id))
  }
  if (target.kind === 'pin-area') return !session.pinned && !pendingIds.has('pin-order')
  if (target.kind !== 'session-order' || source.id === target.id
    || pendingIds.has('session-order') || pendingIds.has(target.id)) return false
  const destination = sessions.find(({ id, archived }) => id === target.id && !archived)
  return Boolean(destination) && !(session.pinned || destination?.pinned ? pendingIds.has('pin-order') : false)
    && (destination?.pinned || !destination?.group_id || !pendingIds.has(destination.group_id))
}

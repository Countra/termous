import { agentDetachedCommands, type AgentDetachedCommandName } from '#common/contracts'
import type { AgentSurfaceModel } from './agentSurfaceModel.ts'
import type { AgentWorkspaceMessage } from '#widgets/agent-workspace'
import { AgentSurfaceRestoreCache } from './agentSurfaceRestoreCache.ts'

export function agentEditorOwner(model: AgentSurfaceModel) {
  return `${model.workspace?.selected_session_id ?? 'new'}:${model.workspace?.queued_turn_edit?.turn_id ?? 'draft'}`
}

export function agentSurfaceActions(model: AgentSurfaceModel) {
  const groups = {
    workspace: model.workspace, management: model.workspace?.session_management, archive: model.archive,
    readiness: model.readiness, reference: model.reference, surface: model
  }
  const result = new Map<AgentDetachedCommandName, (...args: unknown[]) => unknown>()
  for (const name of agentDetachedCommands) {
    const [group, key] = name.split('.')
    const value = groups[group as keyof typeof groups] as Record<string, unknown> | undefined
    if (typeof value?.[key] === 'function') result.set(name, value[key] as (...args: unknown[]) => unknown)
  }
  return result
}

function serialize(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || value instanceof Blob || value instanceof AbortController || value instanceof AbortSignal) return undefined
  if (value instanceof Set) return [...value]
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const result = serialize(entry)
    return result === undefined ? [] : [[key, result]]
  }))
  return value
}

// 消息投影不可变；独立窗口输入时复用未变片段，弱引用不保留被分页淘汰的历史。
export class AgentSurfaceMessageCache {
  private readonly messages = new WeakMap<AgentWorkspaceMessage, { metadata: unknown; parts: Array<{ id: string; value: unknown }> }>()
  private readonly parts = new WeakMap<AgentWorkspaceMessage['parts'][number], unknown>()

  project(message: AgentWorkspaceMessage) {
    const cached = this.messages.get(message)
    if (cached) return cached
    const { parts, ...metadata } = message
    const value = { metadata: serialize({ ...metadata, partIds: parts.map(part => part.id) }), parts: parts.map(part => {
      if (!this.parts.has(part)) this.parts.set(part, serialize(part))
      return { id: part.id, value: this.parts.get(part) }
    }) }
    this.messages.set(message, value)
    return value
  }
}

export function projectAgentSurface(model: AgentSurfaceModel, cache = new AgentSurfaceMessageCache()): Record<string, unknown> {
  const partitions: Record<string, unknown> = { capabilities: [...agentSurfaceActions(model).keys()] }
  // 长工具轮按 Part 分区，流式文字不反复携带整条消息的全部历史步骤。
  for (const [group, value] of Object.entries(model)) {
    if (!value || typeof value !== 'object') { if (typeof value !== 'function') partitions[group] = value; continue }
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'function') continue
      if (key === 'messages' && Array.isArray(entry)) {
        partitions[`${group}.messageIds`] = entry.map(message => message.id)
        for (const message of entry) {
          const projected = cache.project(message)
          partitions[`message:${group}:${message.id}`] = projected.metadata
          for (const part of projected.parts) partitions[`part:${group}:${message.id}:${part.id}`] = part.value
        }
      } else partitions[`${group}.${key}`] = serialize(entry)
    }
  }
  if (model.workspace) partitions['workspace.draft_attachments'] = model.workspace.draft_attachments.map(({ file, ...item }) => ({ ...item, mime_type: file?.type ?? item.mime_type }))
  return partitions
}

export function restoreAgentSurface(partitions: Record<string, unknown>, cache = new AgentSurfaceRestoreCache()): AgentSurfaceModel {
  const model: Record<string, unknown> = {}
  const messageGroups = new Set<string>()
  for (const [path, value] of Object.entries(partitions)) {
    if (value === null || value === undefined) continue
    const [group, key] = path.split('.')
    if (!['workspace', 'archive', 'readiness', 'reference', 'warning'].includes(group)) continue
    if (!key) model[group] = value
    else {
      const target = (model[group] ??= {}) as Record<string, unknown>
      if (key === 'messageIds') {
        messageGroups.add(group)
        target.messages = cache.messages(group, value as string[], partitions)
      }
      else target[key] = value
    }
  }
  const result = model as AgentSurfaceModel
  if (result.workspace?.session_management) result.workspace.session_management = {
    ...result.workspace.session_management,
    pendingIds: result.workspace.session_management.pendingIds
      ? cache.pendingIds(result.workspace.session_management.pendingIds as unknown as string[]) : new Set(),
  }
  if (result.archive?.pendingIds) result.archive.pendingIds = cache.pendingIds(result.archive.pendingIds as unknown as string[])
  cache.retain(messageGroups)
  return result
}

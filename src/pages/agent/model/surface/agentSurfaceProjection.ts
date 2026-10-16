import { agentDetachedCommands, type AgentDetachedCommandName } from '#common/contracts'
import type { AgentSurfaceModel } from './agentSurfaceModel.ts'

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

export function projectAgentSurface(model: AgentSurfaceModel): Record<string, unknown> {
  const partitions: Record<string, unknown> = { capabilities: [...agentSurfaceActions(model).keys()] }
  // 分区分别比较；流式更新只传递当前对话及实际发生变化的投影。
  for (const [group, value] of Object.entries(model)) {
    if (!value || typeof value !== 'object') { if (typeof value !== 'function') partitions[group] = value; continue }
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'function') continue
      if (key === 'messages' && Array.isArray(entry)) {
        partitions[`${group}.messageIds`] = entry.map(message => message.id)
        for (const message of entry) partitions[`message:${group}:${message.id}`] = serialize(message)
      } else partitions[`${group}.${key}`] = serialize(entry)
    }
  }
  if (model.workspace) partitions['workspace.draft_attachments'] = model.workspace.draft_attachments.map(({ file, ...item }) => ({ ...item, mime_type: file?.type ?? item.mime_type }))
  return partitions
}

export function restoreAgentSurface(partitions: Record<string, unknown>): AgentSurfaceModel {
  const model: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(partitions)) {
    if (value === null || value === undefined) continue
    const [group, key] = path.split('.')
    if (!['workspace', 'archive', 'readiness', 'reference', 'warning'].includes(group)) continue
    if (!key) model[group] = value
    else {
      const target = (model[group] ??= {}) as Record<string, unknown>
      if (key === 'messageIds') target.messages = (value as string[]).flatMap(id => {
        const message = partitions[`message:${group}:${id}`]
        return message ? [message] : []
      })
      else target[key] = value
    }
  }
  const result = model as AgentSurfaceModel
  if (result.workspace?.session_management) result.workspace.session_management.pendingIds = new Set(result.workspace.session_management.pendingIds as unknown as string[])
  if (result.archive?.pendingIds) result.archive.pendingIds = new Set(result.archive.pendingIds as unknown as string[])
  return result
}

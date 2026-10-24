import type { AgentWorkspaceMessage } from '#widgets/agent-workspace'

type Metadata = Omit<AgentWorkspaceMessage, 'parts'> & { partIds: string[] }
type Entry = { metadata: Metadata; message: AgentWorkspaceMessage }
type MessageWindow = { entries: Map<string, Entry>; messages: AgentWorkspaceMessage[] }

export class AgentSurfaceRestoreCache {
  private readonly windows = new Map<string, MessageWindow>()
  private readonly sets = new WeakMap<string[], Set<string>>()

  messages(group: string, ids: string[], partitions: Record<string, unknown>) {
    const previous = this.windows.get(group)
    const entries = new Map<string, Entry>()
    const messages: AgentWorkspaceMessage[] = []
    for (const id of ids) {
      const metadata = partitions[`message:${group}:${id}`] as Metadata | undefined
      if (!metadata) continue
      const cached = previous?.entries.get(id)
      let entry: Entry
      // 输入确认通常不改历史；先比较分区引用，避免为长消息反复分配片段数组。
      if (cached?.metadata === metadata && metadata.partIds.length === cached.message.parts.length
        && metadata.partIds.every((partId, index) => partitions[`part:${group}:${id}:${partId}`] === cached.message.parts[index])) entry = cached
      else {
        const { partIds, ...fields } = metadata
        const parts = partIds.map(partId => partitions[`part:${group}:${id}:${partId}`])
          .filter(Boolean) as AgentWorkspaceMessage['parts']
        entry = { metadata, message: { ...fields, parts } }
      }
      entries.set(id, entry)
      messages.push(entry.message)
    }
    const value = previous && sameItems(previous.messages, messages) ? previous.messages : messages
    // 只保留当前分页窗口，删除的片段、关闭的归档及切走的会话不留历史版本。
    this.windows.set(group, { entries, messages: value })
    return value
  }

  retain(groups: Set<string>) {
    for (const group of this.windows.keys()) if (!groups.has(group)) this.windows.delete(group)
  }

  pendingIds(ids: string[]) {
    let set = this.sets.get(ids)
    if (!set) { set = new Set(ids); this.sets.set(ids, set) }
    return set
  }
}

function sameItems<T>(left: T[], right: T[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

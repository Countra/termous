import { mergeAgentProgress, mergeAgentRetryActivity, type AgentMessage } from '#entities/agent'
import { mergeCompactionValue } from './agentWorkspaceCompaction.ts'
import type { AgentWorkspaceState } from './agentWorkspaceStateTypes.ts'

const partLimit = 200
const sessionLimit = 3
const byteLimit = 16 * 1024 * 1024

// 只回收可重读的内容；草稿、审批、任务状态与事件水位不随展示缓存淘汰。
export class AgentContentWindow {
  private readonly accessed = new Map<string, number>()
  private readonly sizes = new WeakMap<object, number>()
  readonly historical = new Set<string>()
  readonly retainOldest = new Set<string>()
  readonly hasOlder = new Map<string, boolean>()
  private clock = 0
  private previous?: Pick<AgentWorkspaceState, 'selected_session_id' | 'messages' | 'runs' | 'active_run_ids' | 'run_events' | 'run_part_overlays'>

  apply(state: AgentWorkspaceState): AgentWorkspaceState {
    // 草稿、用量等更新不触碰正文，不能使整段历史重新投影或重新创建图片目录。
    const previous = this.previous
    if (previous && previous.selected_session_id === state.selected_session_id && previous.messages === state.messages
      && previous.runs === state.runs && previous.active_run_ids === state.active_run_ids
      && previous.run_events === state.run_events && previous.run_part_overlays === state.run_part_overlays) return state
    const selected = state.selected_session_id
    if (selected) this.accessed.set(selected, ++this.clock)
    const messages: Record<string, AgentMessage[]> = {}
    const entries = Object.entries(state.messages).sort(([a], [b]) =>
      Number(b === selected) - Number(a === selected) || (this.accessed.get(b) ?? 0) - (this.accessed.get(a) ?? 0))
    let bytes = 0
    for (const [id, values] of entries) {
      if (Object.keys(messages).length >= sessionLimit) continue
      const bounded = this.boundMessages(values, this.retainOldest.has(id))
      const size = this.measure(bounded)
      if (bytes + size > byteLimit && id !== selected) continue
      messages[id] = bounded
      if (values[0] && bounded[0] && timelineBoundary(id, values[0], 'first') !== timelineBoundary(id, bounded[0], 'first')) {
        this.hasOlder.set(id, true)
      }
      bytes += size
    }
    const events: AgentWorkspaceState['run_events'] = {}
    const overlays: AgentWorkspaceState['run_part_overlays'] = {}
    const visibleMessages = new Set(Object.values(messages).flatMap(values => values.map(message => message.id)))
    const visibleParts = new Set(Object.values(messages).flatMap(values => values.flatMap(message => message.parts.map(part => part.id))))
    for (const [id, run] of Object.entries(state.runs)) {
      if (!messages[run.session_id]) continue
      if (!visibleMessages.has(run.assistant_message_id) && state.active_run_ids[run.session_id] !== id) continue
      // 完整片段已合并到消息，不在事件中重复保留正文。
      const original = state.run_events[id] ?? []
      const retained = original.filter(event => event.kind !== 'message_part' && event.kind !== 'message_delta').slice(-200)
      events[id] = retained.length === original.length ? original : retained
      const pending = Object.entries(state.run_part_overlays[id] ?? {}).filter(([part]) => visibleParts.has(part))
      if (pending.length) overlays[id] = Object.fromEntries(pending)
    }
    for (const id of this.accessed.keys()) {
      if (!messages[id]) { this.accessed.delete(id); this.historical.delete(id); this.retainOldest.delete(id) }
    }
    for (const id of this.hasOlder.keys()) if (!messages[id]) this.hasOlder.delete(id)
    const result = { ...state, messages: reuseRecord(state.messages, messages), run_events: reuseRecord(state.run_events, events),
      run_part_overlays: reuseRecord(state.run_part_overlays, overlays) }
    // 只记已经裁剪的窗口，不能把裁剪前的大历史留在缓存里。
    this.previous = { selected_session_id: result.selected_session_id, messages: result.messages, runs: result.runs,
      active_run_ids: result.active_run_ids, run_events: result.run_events, run_part_overlays: result.run_part_overlays }
    return result
  }

  boundMessages(values: AgentMessage[], oldest = false): AgentMessage[] {
    const bounded = trimAgentMessages(values, partLimit, oldest)
    if (this.measure(bounded) <= byteLimit) return bounded
    // 用字节上限定位最大连续窗口，避免大正文场景反复构造近 200 份数组与元数据。
    let low = 1, high = partLimit - 1
    let best = trimAgentMessages(values, 1, oldest)
    while (low <= high) {
      const count = Math.floor((low + high) / 2)
      const candidate = trimAgentMessages(values, count, oldest)
      if (this.measure(candidate) <= byteLimit) { best = candidate; low = count + 1 }
      else high = count - 1
    }
    return best
  }

  private measure(value: unknown): number {
    if (typeof value === 'string') return value.length * 2
    if (!value || typeof value !== 'object') return 8
    const cached = this.sizes.get(value)
    if (cached !== undefined) return cached
    let bytes = 32
    for (const [key, field] of Object.entries(value)) bytes += key.length * 2 + this.measure(field)
    this.sizes.set(value, bytes)
    return bytes
  }
}

function reuseRecord<T>(previous: Record<string, T>, next: Record<string, T>): Record<string, T> {
  const keys = Object.keys(next)
  return keys.length === Object.keys(previous).length && keys.every(key => next[key] === previous[key]) ? previous : next
}

export function trimAgentMessages(values: AgentMessage[], limit = partLimit, oldest = false): AgentMessage[] {
  let remaining = limit
  const result: AgentMessage[] = []
  for (const message of oldest ? values : [...values].reverse()) {
    if (!remaining) break
    const count = Math.max(1, message.parts.length)
    const parts = count > remaining ? oldest ? message.parts.slice(0, remaining) : message.parts.slice(-remaining) : message.parts
    const first = Math.max(0, (parts[0]?.sequence ?? 1) - 1)
    const last = parts[parts.length - 1]?.sequence ?? 0
    const inWindow = (activity: { after_part_sequence: number }) => activity.after_part_sequence >= first && activity.after_part_sequence <= last
    const compactions = retainMatching(message.compactions, inWindow)
    const retries = retainMatching(message.retries, inWindow)
    const progress = retainMatching(message.progress, inWindow)
    const imageSources = retainMatching(message.image_sources, source => parts.some(part => part.kind === 'text' && part.text.includes(source.reference)))
    // 未变化的会话不能因其他 Run 的事件被重建，否则会使页面投影和图片缓存逐事件失效。
    result.push(parts === message.parts && compactions === message.compactions && retries === message.retries
      && progress === message.progress && imageSources === message.image_sources ? message
      : { ...message, parts, compactions, retries, progress, image_sources: imageSources })
    remaining -= Math.min(count, remaining)
  }
  if (!oldest) result.reverse()
  return result.length === values.length && result.every((message, index) => message === values[index]) ? values : result
}

function retainMatching<T>(values: T[] | undefined, predicate: (value: T) => boolean) {
  if (!values) return values
  const filtered = values.filter(predicate)
  return filtered.length === values.length ? values : filtered
}

export function mergeTimelineMessages(previous: AgentMessage[], incoming: AgentMessage[]) {
  const messages = new Map(previous.map(message => [message.id, message]))
  for (const message of incoming) {
    const old = messages.get(message.id)
    if (!old) { messages.set(message.id, message); continue }
    const parts = new Map(old.parts.map(part => [part.id, part]))
    for (const part of message.parts) {
      if ((parts.get(part.id)?.revision ?? 0) <= part.revision) parts.set(part.id, part)
    }
    messages.set(message.id, { ...(old.revision > message.revision ? old : message), parts: [...parts.values()].sort((a, b) => a.sequence - b.sequence),
      compactions: mergeActivities(old.compactions, message.compactions, value => value.compaction_id, mergeCompactionValue),
      retries: mergeActivities(old.retries, message.retries, value => value.retry_id, mergeAgentRetryActivity),
      progress: mergeActivities(old.progress, message.progress, value => value.pattern_id, mergeAgentProgress),
      image_sources: mergeActivities(old.image_sources, message.image_sources, value => value.reference, (_old, incoming) => incoming),
    })
  }
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence)
}

function mergeActivities<T>(previous: T[] | undefined, incoming: T[] | undefined, key: (value: T) => string, merge: (old: T | undefined, next: T) => T): T[] | undefined {
  if (!previous?.length) return incoming
  if (!incoming?.length) return previous
  const values = new Map(previous.map(value => [key(value), value]))
  for (const value of incoming) values.set(key(value), merge(values.get(key(value)), value))
  return [...values.values()]
}

export function timelineBoundary(sessionId: string, message: AgentMessage, edge: 'first' | 'last') {
  const part = edge === 'first' ? message.parts[0] : message.parts[message.parts.length - 1]
  return btoa(JSON.stringify({ s: sessionId, m: message.sequence, p: part?.sequence ?? 0 })).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

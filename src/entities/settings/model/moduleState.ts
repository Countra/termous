import { coreSettingsModules, desktopSettingsModules, type SettingsCatalogue, type SettingsEvent, type SettingsModuleId, type SettingsSnapshot, type SettingsUpdate } from '#common/contracts'

const knownModules = new Set<string>([...coreSettingsModules, ...desktopSettingsModules, 'terminal_local'])
export function settingsErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  // Electron contextBridge 只保留 Error 的标准字段；已校验的 IPC 错误码仍保留在 message 中。
  if ('message' in error && typeof error.message === 'string') return error.message.match(/\bSETTINGS_[A-Z_]+\b/)?.[0]
  return undefined
}
function freezeSnapshot(snapshot: SettingsSnapshot): SettingsSnapshot {
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  const clone = structuredClone(snapshot)
  freeze(clone)
  return clone
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SETTINGS_INVALID_RESPONSE')
  return value as Record<string, unknown>
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('SETTINGS_INVALID_REVISION')
  return value
}
function moduleId(value: unknown): SettingsModuleId {
  if (typeof value !== 'string' || !knownModules.has(value)) throw new Error('SETTINGS_UNSUPPORTED_MODULE')
  return value as SettingsModuleId
}
export function decodeSettingsSnapshot(input: unknown, expected?: SettingsModuleId): SettingsSnapshot {
  const data = object(input)
  const id = moduleId(data.id)
  if (id !== (expected ?? id) || data.schema_version !== 1) throw new Error('SETTINGS_UNSUPPORTED_VERSION')
  const state = object(data.state)
  if (!['applied', 'restart_required', 'unavailable'].includes(String(state.status))) throw new Error('SETTINGS_INVALID_STATE')
  return { id, schema_version: 1, revision: revision(data.revision), value: object(data.value), state: state as SettingsSnapshot['state'] }
}
export function decodeSettingsCatalogue(input: unknown): SettingsCatalogue {
  const data = object(input)
  if (!Array.isArray(data.modules)) throw new Error('SETTINGS_INVALID_CATALOGUE')
  const ids = new Set<string>()
  if (typeof data.instance_id !== 'string' || !data.instance_id) throw new Error('SETTINGS_INVALID_CATALOGUE')
  return { instance_id: data.instance_id, modules: data.modules.map((raw) => {
    const item = object(raw)
    const id = moduleId(item.id)
    if (ids.has(id) || item.schema_version !== 1 || !['include', 'exclude'].includes(String(item.backup)) || !['immediate', 'restart'].includes(String(item.apply))) throw new Error('SETTINGS_INVALID_CATALOGUE')
    ids.add(id)
    if (item.error !== undefined && typeof item.error !== 'string') throw new Error('SETTINGS_INVALID_CATALOGUE')
    return { id, schema_version: 1, backup: item.backup as 'include' | 'exclude', apply: item.apply as 'immediate' | 'restart',
      ...(item.snapshot ? { snapshot: decodeSettingsSnapshot(item.snapshot, id) } : { error: String(item.error ?? 'SETTINGS_UNAVAILABLE') }) }
  }) }
}
export function decodeSettingsEvent(input: unknown): SettingsEvent {
  const data = object(input)
  if (typeof data.instance_id !== 'string' || !data.instance_id) throw new Error('SETTINGS_INVALID_EVENT')
  if (data.type === 'resync') return { instance_id: data.instance_id, type: 'resync' }
  if (data.type === 'changed') return { instance_id: data.instance_id, type: 'changed', module: moduleId(data.module), revision: revision(data.revision) }
  throw new Error('SETTINGS_INVALID_EVENT')
}

export interface SettingsTransport {
  read(id: SettingsModuleId, signal?: AbortSignal): Promise<SettingsSnapshot>
  update(id: SettingsModuleId, request: SettingsUpdate, signal?: AbortSignal): Promise<SettingsSnapshot>
}

// 每个运行实例只有一份确认快照；草稿、队列和失效代次按模块隔离。
export class SettingsModuleStore {
  private generation = 0
  private values = new Map<SettingsModuleId, SettingsSnapshot>()
  private queues = new Map<SettingsModuleId, Promise<unknown>>()
  private conflicts = new Map<SettingsModuleId, number>()
  private listeners = new Set<() => void>()
  private drafts = new Map<SettingsModuleId, Record<string, unknown>>()
  private readonly transport: SettingsTransport
  constructor(transport: SettingsTransport) { this.transport = transport }
  get epoch() { return this.generation }

  snapshot(id: SettingsModuleId) { return this.values.get(id) }
  draft(id: SettingsModuleId) { const draft = this.drafts.get(id); return draft && structuredClone(draft) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  // 临时断线只使在途读写失效；确认值与草稿保留到恢复连接或明确切换实例。
  invalidateRequests() { this.generation++; this.queues.clear(); this.conflicts.clear() }
  reset() { this.invalidateRequests(); this.values.clear(); this.drafts.clear(); this.notify() }
  private notify() { for (const listener of this.listeners) listener() }
  merge(snapshot: SettingsSnapshot) {
    const previous = this.values.get(snapshot.id)
    if (previous && previous.revision > snapshot.revision) return previous
    if (previous && previous.revision === snapshot.revision && JSON.stringify(previous.value) === JSON.stringify(snapshot.value) && JSON.stringify(previous.state) === JSON.stringify(snapshot.state)) return previous
    snapshot = freezeSnapshot(snapshot)
    this.values.set(snapshot.id, snapshot)
    this.notify()
    return snapshot
  }
  async read(id: SettingsModuleId, signal?: AbortSignal) {
    const generation = this.generation
    const snapshot = await this.transport.read(id, signal)
    if (generation !== this.generation || signal?.aborted) throw new Error('SETTINGS_REQUEST_SUPERSEDED')
    return this.merge(snapshot)
  }
  update(id: SettingsModuleId, patch: Record<string, unknown>, options: { expectedRevision?: number; signal?: AbortSignal } = {}) {
    const generation = this.generation
    const conflict = this.conflicts.get(id) ?? 0
    const draft = structuredClone(patch)
    this.drafts.set(id, draft)
    const run = async () => {
      if (generation !== this.generation || conflict !== (this.conflicts.get(id) ?? 0)) throw new Error('SETTINGS_REQUEST_SUPERSEDED')
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const expected = options.expectedRevision ?? (this.snapshot(id) ?? await this.read(id, options.signal)).revision
      if (generation !== this.generation) throw new Error('SETTINGS_REQUEST_SUPERSEDED')
      try {
        const result = await this.transport.update(id, { expected_revision: expected, patch: draft }, options.signal)
        if (generation !== this.generation || options.signal?.aborted) throw new Error('SETTINGS_REQUEST_SUPERSEDED')
        if (this.drafts.get(id) === draft) this.drafts.delete(id)
        return this.merge(result)
      } catch (error) {
        if (generation !== this.generation) throw error
        if (settingsErrorCode(error) === 'SETTINGS_REVISION_CONFLICT') {
          this.conflicts.set(id, conflict + 1)
          // 只刷新确认值；保留草稿并使同一旧版本下排队的写入失效，不自动重试。
          try { await this.read(id, options.signal) } catch { /* 原始冲突由调用方展示，后续手动刷新仍可恢复。 */ }
        }
        throw error
      }
    }
    const pending = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(run)
    this.queues.set(id, pending)
    void pending.finally(() => { if (this.queues.get(id) === pending) this.queues.delete(id) }).catch(() => undefined)
    return pending
  }
}

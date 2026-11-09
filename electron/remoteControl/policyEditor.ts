import { randomUUID } from 'node:crypto'
import type { RemotePolicyChange, RemotePolicyEditor, RemotePolicyReceipt } from '#common/contracts'
import { RemoteCore, RemoteCoreError, validId } from './core.ts'

interface Session { owner: number; generation: string; id: string; selection?: { id: string; path: string } }

// 编辑会话与原生选择结果仅存在于主进程，渲染层不能提交任意目录路径。
export class RemotePolicyEditorSession {
  private current?: Session
  private core: RemoteCore
  constructor(core: RemoteCore) { this.core = core }

  private session(owner: number, generation: string, id: string) {
    const value = this.current
    if (!value || value.owner !== owner || value.generation !== generation || value.id !== id) throw new RemoteCoreError('remote_editor_closed')
    return value
  }

  async open(owner: number, generation: string, id: string) {
    if (!validId(generation) || !validId(id)) throw new RemoteCoreError('remote_invalid_request')
    const existing = this.current
    if (!existing || existing.owner !== owner || existing.generation !== generation || existing.id !== id) this.current = { owner, generation, id }
    const current = this.current
    const value = await this.core.request<RemotePolicyEditor>(`/remote-control/policy/editor?generation=${encodeURIComponent(generation)}`)
    if (this.current !== current) throw new RemoteCoreError('remote_editor_closed')
    return value
  }

  close(owner: number, id?: string) {
    if (this.current?.owner === owner && (id === undefined || this.current.id === id)) this.current = undefined
    return true
  }

  async select(owner: number, generation: string, id: string, pick: () => Promise<string | undefined>) {
    const current = this.session(owner, generation, id)
    current.selection = undefined
    const path = await pick()
    if (this.current !== current) throw new RemoteCoreError('remote_editor_closed')
    if (!path) return null
    current.selection = { id: randomUUID(), path }
    return current.selection.id
  }

  async change(owner: number, generation: string, id: string, revision: number, input: unknown) {
    const current = this.session(owner, generation, id)
    if (!Number.isSafeInteger(revision) || revision < 0 || !validChange(input)) throw new RemoteCoreError('remote_invalid_request')
    let change: unknown = input
    if (input.kind === 'directory_add') {
      if (current.selection?.id !== input.selection) throw new RemoteCoreError('remote_invalid_request')
      change = { kind: input.kind, path: current.selection.path, write: input.write }
      current.selection = undefined
    }
    return this.core.request<RemotePolicyReceipt>('/remote-control/policy', { generation, revision, change }, 'PATCH')
  }
}

function validChange(input: unknown): input is RemotePolicyChange {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('kind' in input)) return false
  const c = input as Record<string, unknown>
  let keys: string[]
  switch (c.kind) {
    case 'enabled': case 'agent': keys = ['kind', 'enabled']; if (typeof c.enabled !== 'boolean') return false; break
    case 'mode': keys = ['kind', 'mode']; if (c.mode !== 'full' && c.mode !== 'custom') return false; break
    case 'hosts': case 'desktops': case 'exchange': {
      keys = ['kind', 'add', 'remove', 'reauthorize']
      const seen = new Set<string>()
      for (const key of keys.slice(1)) {
        const list = c[key]
        if (list === undefined) continue
        if (!Array.isArray(list) || list.length > 256) return false
        for (const id of list) { if (!validId(id) || seen.has(id)) return false; seen.add(id) }
      }
      if (c.kind === 'exchange' && Array.isArray(c.reauthorize) && c.reauthorize.length) return false
      break
    }
    case 'host_desktop': {
      keys = ['kind', 'host_desktop']
      const g = c.host_desktop as Record<string, unknown> | undefined
      const fields = ['observe', 'control', 'secure_capture', 'secure_control']
      if (!g || Object.keys(g).some(key => !fields.includes(key)) || fields.some(key => typeof g[key] !== 'boolean')) return false
      if (g.control && !g.observe || g.secure_capture && !g.observe || g.secure_control && (!g.control || !g.secure_capture)) return false
      break
    }
    case 'directory_add': keys = ['kind', 'selection', 'write']; if (!validId(c.selection) || typeof c.write !== 'boolean') return false; break
    case 'directory_remove': keys = ['kind', 'directory_id']; if (!validId(c.directory_id)) return false; break
    default: return false
  }
  return Object.keys(c).every(key => keys.includes(key))
}

import type { RemoteLauncher, RemotePolicy, RemotePolicyChange, RemotePolicyEditor, RemotePolicyResource } from '#common/contracts'
import { unwrap } from '#entities/remote-control'

export interface PolicyEditorState {
  open: boolean; loading: boolean; blocked: boolean; picking: boolean
  view?: RemotePolicyEditor; pending: ReadonlySet<string>; notice?: { reason: unknown; sequence: number }
}
interface Pending { change: RemotePolicyChange; keys: string[] }

export function policyChangeKeys(c: RemotePolicyChange): string[] {
  if (c.kind === 'hosts' || c.kind === 'desktops' || c.kind === 'exchange') return [...(c.add ?? []), ...(c.remove ?? []), ...(c.reauthorize ?? [])].map(id => `${c.kind === 'hosts' ? 'host' : 'desktop'}:${id}`)
  if (c.kind === 'directory_remove') return [`directory:${c.directory_id}`]
  return [c.kind]
}

// 单个弹窗拥有一份确认快照和串行队列，不持久保存未获确认的授权意图。
export class PolicyEditor {
  private state: PolicyEditorState = { open: false, loading: false, blocked: false, picking: false, pending: new Set() }
  private listeners = new Set<() => void>()
  private confirmed?: RemotePolicyEditor
  private queue: Pending[] = []
  private id?: string
  private reading = 0
  private writing = false
  private noticeSequence = 0
  constructor(private api: RemoteLauncher | undefined, private generation: string) {}
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(update: Partial<PolicyEditorState> = {}) {
    const pending = new Set(this.queue.flatMap(item => item.keys))
    const view = this.confirmed ? { ...this.confirmed, policy: this.queue.reduce((p, item) => projectPolicy(p, item.change, this.confirmed!.desktops), this.confirmed.policy) } : undefined
    this.state = { ...this.state, ...update, pending, view }
    this.listeners.forEach(listener => listener())
  }
  private notify(reason: unknown) { return { reason, sequence: ++this.noticeSequence } }

  async open() {
    if (this.id || this.writing) return
    this.id = crypto.randomUUID()
    this.publish({ open: true, blocked: false, notice: undefined })
    await this.refresh()
  }
  async refresh() {
    const id = this.id
    if (!id || this.writing || this.queue.length) return
    const reading = ++this.reading
    this.publish({ loading: !this.confirmed, blocked: true })
    try {
      if (!this.api?.editPolicy) throw { code: 'client_upgrade_required' }
      const view = unwrap(await this.api.editPolicy(this.generation, id))
      if (id !== this.id || reading !== this.reading) return
      this.confirmed = view
      this.publish({ loading: false, blocked: false })
    } catch (reason) {
      if (id === this.id && reading === this.reading) this.publish({ loading: false, blocked: true, notice: this.notify(reason) })
    }
  }
  close() {
    if (this.queue.length || this.writing || this.state.picking) return false
    this.dispose()
    return true
  }
  dispose() {
    const id = this.id
    this.id = undefined; ++this.reading
    this.queue = []; this.confirmed = undefined; this.writing = false
    this.publish({ open: false, loading: false, blocked: false, picking: false, notice: undefined })
    // 即使视图卸载，主进程也会丢弃这个会话的原生目录选择结果。
    if (id) void this.api?.closePolicyEditor?.(id).catch(() => undefined)
  }
  change(change: RemotePolicyChange) {
    if (!this.id || !this.confirmed || this.state.blocked || !this.api?.changePolicy) return
    const keys = policyChangeKeys(change)
    if (!keys.length || keys.some(key => this.state.pending.has(key))) return
    this.queue.push({ change, keys })
    this.publish()
    void this.drain()
  }
  async directory(write: boolean) {
    const id = this.id
    const reading = this.reading
    if (!id || this.state.blocked || this.state.picking || this.state.pending.has('directory_add') || !this.api?.selectPolicyDirectory) return
    this.publish({ picking: true })
    try {
      const selection = unwrap(await this.api.selectPolicyDirectory(this.generation, id))
      if (id !== this.id) return
      this.publish({ picking: false })
      // 写入失败后的补读会结束此前的编辑意图，迟到的原生选择不能继续提交。
      if (selection && reading === this.reading) this.change({ kind: 'directory_add', selection, write })
    } catch (reason) {
      if (id === this.id) this.publish({ picking: false, notice: this.notify(reason) })
    }
  }
  private async drain() {
    if (this.writing) return
    const id = this.id
    if (!id || !this.api?.changePolicy) return
    this.writing = true
    try {
      while (this.id === id && this.confirmed && this.queue.length) {
        const item = this.queue[0]
        const receipt = unwrap(await this.api.changePolicy(this.generation, id, this.confirmed.policy.revision, item.change))
        if (this.id !== id) return
        this.queue.shift()
        this.confirmed = { ...this.confirmed, policy: receipt.policy }
        if (item.change.kind === 'hosts' || item.change.kind === 'desktops') {
          const ids = [...(item.change.add ?? []), ...(item.change.reauthorize ?? [])]
          const field = item.change.kind === 'hosts' ? 'hosts' : 'desktops'
          this.confirmed[field] = this.confirmed[field].map(resource => ids.includes(resource.id) ? { ...resource, status: 'available' } : resource)
        }
        const code = receipt.cleanup_pending ? 'remote_policy_cleanup_pending' : receipt.reconnect_desktop ? 'remote_policy_reconnect' : undefined
        this.publish(code ? { notice: this.notify({ code }) } : {})
      }
    } catch (reason) {
      if (this.id !== id) return
      this.queue = []
      this.publish({ blocked: true, notice: this.notify(reason) })
      this.writing = false
      await this.refresh()
    } finally {
      if (this.id === id) { this.writing = false; this.publish() }
    }
  }
}

// 只用于控件的待提交展示；权限有效性始终以后端回执为准。
export function projectPolicy(source: RemotePolicy, c: RemotePolicyChange, desktops: RemotePolicyResource[]): RemotePolicy {
  const p = structuredClone(source)
  if (c.kind === 'enabled') p.enabled = c.enabled
  else if (c.kind === 'mode') p.access_mode = c.mode
  else if (c.kind === 'agent') p.agent_enabled = c.enabled
  else if (c.kind === 'host_desktop') p.host_desktop = c.host_desktop
  else if (c.kind === 'directory_remove') p.directories = (p.directories ?? []).filter(d => d.id !== c.directory_id)
  else if (c.kind === 'hosts' || c.kind === 'desktops' || c.kind === 'exchange') {
    p.hosts ??= []
    const group = (id: string) => {
      let host = p.hosts!.find(h => h.id === id)
      if (!host) { host = { id, terminal_file_access: false, connections: [] }; p.hosts!.push(host) }
      return host
    }
    if (c.kind === 'hosts') {
      for (const id of c.add ?? []) group(id).terminal_file_access = true
      for (const id of c.remove ?? []) {
        const host = p.hosts.find(h => h.id === id)
        if (host) { host.terminal_file_access = false; host.connections = host.connections?.filter(g => g.kind !== 'ssh' && g.kind !== 'files') }
      }
    } else {
      for (const host of p.hosts) host.connections = host.connections?.filter(g => !(c.remove ?? []).includes(g.id) || (g.kind !== 'desktop_exchange' && (c.kind !== 'desktops' || g.kind !== 'desktop')))
      for (const id of c.add ?? []) {
        const profile = desktops.find(d => d.id === id)
        if (profile?.host_id) {
          const host = group(profile.host_id)
          const kind = c.kind === 'desktops' ? 'desktop' : 'desktop_exchange'
          host.connections ??= []
          if (!host.connections.some(g => g.id === id && g.kind === kind)) host.connections.push({ id, kind })
        }
      }
    }
    p.hosts = p.hosts.filter(h => h.terminal_file_access !== false || h.connections?.length)
  }
  return p
}

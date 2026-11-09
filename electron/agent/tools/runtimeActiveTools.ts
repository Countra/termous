import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { RuntimeToolEntry } from './runtimeToolRegistry.ts'
import { runtimeToolDependencies } from './runtimeToolLifecycle.ts'

// 只管理声明驻留，不接管真实任务、授权或资源回收。
export class RuntimeActiveTools {
  private readonly selected = new Map<string, number>()
  private readonly pending = new Set<string>()
  private readonly inFlight = new Set<string>()
  private clock = 0
  private readonly entries: RuntimeToolEntry[]
  private readonly permanent: AgentTool[]
  constructor(entries: RuntimeToolEntry[], permanent: AgentTool[]) { this.entries = entries; this.permanent = permanent }

  private bundle(name: string) {
    const entry = this.entries.find((item) => item.tool.name === name)
    if (!entry) return []
    const dependencies = entry.trusted ? runtimeToolDependencies(entry.original) : []
    return [name, ...this.entries.filter((item) => item.trusted && dependencies.includes(item.original)).map((item) => item.tool.name)]
  }

  private names(parents: Iterable<string>) {
    return new Set([...this.permanent.map((tool) => tool.name), ...[...parents].flatMap((name) => this.bundle(name))])
  }

  private protectedParents() {
    return [...this.selected.keys()].filter((name) => this.bundle(name).some((member) => this.inFlight.has(member)))
  }

  schedule(entry: RuntimeToolEntry) {
    if (this.permanent.some((tool) => tool.name === entry.tool.name)) return true
    if (this.names([...this.pending, ...this.protectedParents(), ...this.inFlight, entry.tool.name]).size > 32) return false
    this.pending.add(entry.tool.name)
    return true
  }

  touch(name: string) {
    if (this.selected.has(name)) this.selected.set(name, ++this.clock)
    this.inFlight.add(name)
  }
  complete(name: string) { this.inFlight.delete(name) }

  // 目录刷新时先保留待发布入口，再按最近使用顺序恢复驻留声明，避免恢复建议丢在请求边界。
  requested() { return [...new Set([...this.pending, ...[...this.selected].sort((a, b) => b[1] - a[1]).map(([name]) => name)])] }

  // 重建目录按优先级接纳声明，再逆序恢复使用顺序，避免最新纠错入口变成最先被淘汰的项。
  restorePending() {
    for (const name of [...this.pending].reverse()) this.selected.set(name, ++this.clock)
    this.pending.clear()
  }

  publish() {
    const protectedParents = new Set(this.protectedParents())
    for (const name of this.pending) this.selected.set(name, ++this.clock)
    for (const [name] of [...this.selected].sort((a, b) => a[1] - b[1])) {
      if (this.names(this.selected.keys()).size <= 32) break
      if (!this.pending.has(name) && !protectedParents.has(name) && !this.inFlight.has(name)) this.selected.delete(name)
    }
    this.pending.clear()
    return this.active()
  }

  active() {
    const names = this.names(this.selected.keys())
    return [...this.permanent, ...this.entries.filter((entry) => names.has(entry.tool.name)
      && !this.permanent.some((tool) => tool.name === entry.tool.name)).map((entry) => entry.tool)]
  }
}

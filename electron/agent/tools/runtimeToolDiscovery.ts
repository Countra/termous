import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { ToolNavigation } from './runtimeToolNavigation.ts'
import { createToolSearch, type DiscoveryInput } from './runtimeToolSearch.ts'
import { runtimeToolDependencies } from './runtimeToolLifecycle.ts'
import { runtimeCapabilities, runtimeCapability, runtimeCapabilityStep, runtimeOperations, runtimeToolOperations, skillEntryTools } from './runtimeCapabilityCatalog.ts'

const groups = [...new Set(runtimeCapabilities.map((capability) => capability.group))].map((group) => [group,
  [...new Set(runtimeCapabilities.filter((capability) => capability.group === group).flatMap((capability) => capability.keywords.split(' ')))].join(' '),
] as const)

interface Entry { tool: AgentTool; original: string; group: string; keywords: string }

// 目录保留完整已授权工具；活动集合只在完整工具轮结束后发布。
export class RuntimeToolDiscovery {
  private readonly entries: Entry[]
  private readonly permanent: AgentTool[]
  private readonly selected = new Map<string, number>()
  private readonly pinned = new Set<string>()
  private readonly pending = new Set<string>()
  private preferredCapabilities = new Set<string>()
  private readonly unavailable?: (name: string) => string | undefined
  private readonly onLoad?: (name: string) => void
  private clock = 0
  readonly tool: AgentTool

  constructor(tools: AgentTool[], originalName: (name: string) => string | null, permanent: AgentTool[], unavailable?: (name: string) => string | undefined, onLoad?: (name: string) => void) {
    this.unavailable = unavailable
    this.onLoad = onLoad
    this.entries = [...tools, ...permanent].map((tool) => {
      const original = originalName(tool.name) ?? tool.name
      const capability = runtimeCapability(original)
      return { tool: this.withDescription(tool, original), original, group: capability?.group ?? 'other', keywords: capability?.keywords ?? original }
    }).sort((a, b) => a.original.localeCompare(b.original))
    this.tool = {
      name: 'discover_tools', label: '发现工具', executionMode: 'sequential',
      description: '发现准确操作：已知名称用 names，否则用 operation＋query（如 read＋命令输出），也可浏览 group。多个目标分别搜索。最多加载 8 个已授权工具，下一轮才可调用；返回 name 是实际名称，完整参数进入声明。加载不执行操作，请核对职责。',
      parameters: Type.Object({
        query: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
        operation: Type.Optional(Type.Union(Object.keys(runtimeOperations).map((name) => Type.Literal(name)))),
        group: Type.Optional(Type.Union(groups.map(([name]) => Type.Literal(name)))),
        names: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 8 })),
      }, { additionalProperties: false, minProperties: 1 }),
      execute: async (_id, input) => {
        const args = input as DiscoveryInput
        const score = createToolSearch(args, this.preferredCapabilities)
        const scored = this.entries.map((entry) => ({ entry, score: score(entry) }))
          .filter((v) => v.score > 0).sort((a, b) => b.score - a.score || a.entry.original.localeCompare(b.entry.original))
        const blocked = scored.filter(({ entry }) => this.unavailable?.(entry.original))
        const eligible = scored.filter((entry) => !blocked.includes(entry)).slice(0, 8)
        const admitted = eligible.filter(({ entry }) => this.schedule(entry))
        if (admitted.length) this.preferredCapabilities = new Set(admitted.flatMap(({ entry }) => {
          const capability = runtimeCapability(entry.original)
          return capability ? [capability.id] : []
        }))
        const notFound = args.names?.filter((name) => !this.entries.some((entry) => entry.original === name || entry.tool.name === name)) ?? []
        return { content: [{ type: 'text', text: JSON.stringify({
          tools: admitted.map(({ entry }) => ({ name: entry.tool.name, original_name: entry.original, purpose: entry.tool.description, group: entry.group,
            stage: runtimeCapabilityStep(entry.original)?.role, operations: runtimeToolOperations(entry.original), skill: runtimeCapability(entry.original)?.skill })),
          ...(notFound.length ? { not_found: notFound, unavailable_guidance: '这些名称不在当前授权目录中；按能力组查询实际工具，不要猜测名称。' } : {}),
          ...(blocked.length ? { unavailable: blocked.slice(0, 8).map(({ entry }) => ({ name: entry.original, reason: this.unavailable?.(entry.original) })) } : {}),
          ...(admitted.length < eligible.length ? { deferred: eligible.filter((entry) => !admitted.includes(entry)).map(({ entry }) => entry.original), notice: '本轮待加载工具已达容量上限；先使用已加载工具，下一轮再发现其余能力。' } : {}),
          ...(args.group && admitted.some(({ entry }) => entry.group !== args.group) ? { group_correction: '目标资源和动作与所选能力组不一致；已按明确目标返回当前获准目录中的准确候选，请核对各工具职责。' } : {}),
          ...(admitted.length ? { guidance: '按准确操作与能力阶段选择工具；声明可见不等于已授权执行，提交回执不等于目标完成。', skills: [...new Set(admitted.flatMap(({ entry }) => {
            const capability = runtimeCapability(entry.original)
            return capability ? [capability.skill] : []
          }))] } : {}),
          ...(admitted.length === 0 ? { groups: this.catalog(), guidance: '先把目标拆成具体动作与资源，再按能力组、operation 或精确 names 查询；目录仅包含当前获准能力。',
            examples: this.catalog().slice(0, 3).map(({ group }) => ({ group })) } : {}),
        }) }], details: { kind: 'tool_discovery' } }
      },
    }
    this.permanent = [this.tool, ...permanent]
  }

  private withDescription(tool: AgentTool, original: string): AgentTool {
    const capability = runtimeCapability(original)
    const step = runtimeCapabilityStep(original)
    const boundary = capability && !tool.description.includes(capability.purpose) ? `\n职责：${capability.purpose}\n说明：${capability.skill}` : ''
    const guidance = step?.guidance && !tool.description.includes(step.guidance) ? `\n后续：${step.guidance}` : ''
    const action = step && !tool.description.includes('\n动作：') ? `\n动作：${runtimeToolOperations(original).join(', ')}` : ''
    return { ...tool, description: tool.description + boundary + guidance + action }
  }

  // 所有回执由运行时统一观察；这里只安排声明，不执行恢复操作。
  navigate(navigation: ToolNavigation) {
    const next = this.loadNames(navigation.names)
    const admitted = new Set(next.map((item) => item.original_name))
    const unavailable = navigation.names.filter((name) => !admitted.has(name)).map((name) => ({ name,
      reason: this.unavailable?.(name) ?? (this.entries.some((entry) => entry.original === name) ? '本轮声明容量不足，下轮按需发现' : '不在当前授权工具目录中'),
    }))
    return JSON.stringify({ tool_navigation: { guidance: navigation.guidance, available_next_turn: next, skill: navigation.skill,
      ...(unavailable.length ? { unavailable } : {}),
    } })
  }

  private schedule(entry: Entry) {
    if (this.unavailable?.(entry.original)) return false
    if (this.permanent.some((tool) => tool.name === entry.tool.name)) {
      this.onLoad?.(entry.original)
      return true
    }
    const reserved = new Set([...this.pinned, ...this.pending, ...this.cleanupTools(entry).map((tool) => tool.tool.name), entry.tool.name])
    if (reserved.size + this.permanent.length > 32) return false
    this.pinCleanup(entry)
    this.onLoad?.(entry.original)
    this.pending.add(entry.tool.name)
    return true
  }

  catalog() {
    return groups.filter(([id]) => this.entries.some((entry) => entry.group === id)).map(([id, description]) => ({ group: id, description }))
  }

  available(name: string) {
    return this.entries.some((entry) => entry.original === name) && !this.unavailable?.(name)
  }

  loadNames(names: string[]) {
    return names.flatMap((name) => {
      const entry = this.entries.find((candidate) => candidate.original === name)
      return entry && this.schedule(entry) ? [{ name: entry.tool.name, original_name: name }] : []
    })
  }

  loadReferencedTools(_content: string, uri?: string) {
    // Skill 来自当前可信快照；只加载目录中真实存在的引用，不执行文档内操作。
    const names = (uri ? skillEntryTools(uri) : [])
      .filter((name) => this.entries.some((entry) => entry.original === name)).slice(0, 8)
    return this.loadNames(names)
  }

  touch(name: string) {
    if (this.selected.has(name)) this.selected.set(name, ++this.clock)
    const entry = this.entries.find((v) => v.tool.name === name)
    if (!entry) return
    this.pinCleanup(entry)
  }

  used(name: string) {
    const capability = runtimeCapability(name)
    const role = runtimeCapabilityStep(name)?.role
    // 观察和清理服务于当前目标，不因后台补齐候选或截图而切换任务领域。
    if (capability && role && ['submit', 'mutate', 'input', 'preview'].includes(role)) this.preferredCapabilities = new Set([capability.id])
  }

  private cleanupTools(entry: Entry) {
    const names = runtimeToolDependencies(entry.original)
    return this.entries.filter((candidate) => names.includes(candidate.original))
  }

  private pinCleanup(entry: Entry) {
    // 首次加载即预留清理入口，批量发现不能挤占随后释放资源所需的容量。
    for (const candidate of this.cleanupTools(entry)) {
      this.pending.add(candidate.tool.name)
      this.pinned.add(candidate.tool.name)
    }
  }

  publish() {
    for (const name of this.pending) this.selected.set(name, ++this.clock)
    const protectedNames = new Set([...this.pinned, ...this.pending])
    this.pending.clear()
    for (const [name] of [...this.selected].sort((a, b) => a[1] - b[1])) {
      if (this.selected.size + this.permanent.length <= 32) break
      if (!protectedNames.has(name)) this.selected.delete(name)
    }
    return this.active()
  }

  active() {
    return [...this.permanent, ...this.entries.filter((entry) => this.selected.has(entry.tool.name) && !this.unavailable?.(entry.original)).map((entry) => entry.tool)]
  }
}

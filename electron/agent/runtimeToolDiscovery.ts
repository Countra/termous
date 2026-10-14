import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { desktopToolGuide } from './runtimeLocalTools.ts'
import { runtimeToolNavigation } from './runtimeToolNavigation.ts'
import { scoreToolEntry, type DiscoveryInput } from './runtimeToolSearch.ts'
import { runtimeToolDependencies } from './runtimeToolLifecycle.ts'

const groups = [
  ['desktop_observe', '桌面连接 观察 截图 desktop connect capture', /desktops\.(profiles|list|get|connect|attach|detach|capture|close)/u],
  ['desktop_input', '桌面鼠标 键盘 输入 点击 控制 desktop mouse keyboard input control', /desktops\.(control|pointer|keyboard|clipboard|resize|operations)/u],
  ['workflow_edit', '脚本编排 编辑 版本 workflow script edit schema', /desktop_workflows\.(schema|list|get|versions|create|update|duplicate|restore|delete|validate)$/u],
  ['workflow_templates', '模板 快照 图像 区域 裁剪 放大 定位 template snapshot image crop region view', /desktop_workflows\.(captures|templates)\./u],
  ['workflow_runs', '脚本运行 报告 等待 暂停 取消 workflow run report wait', /desktop_workflows\.(runs|assets)\.|^wait_workflow_run$/u],
  ['ssh', '主机 终端 连接 命令 ssh host shell command', /termous\.(hosts|sessions|commands)\./u],
  ['files', '文件 目录 上传 下载 搜索 sftp file directory transfer', /termous\.files\./u],
  ['system', '系统 进程 服务 容器 docker process service system', /termous\.remoteops\./u],
  ['forwarding', '端口 转发 隧道 forwarding tunnel', /termous\.forwarding\./u],
  ['snippets', '代码片段 命令库 snippet', /termous\.snippets\./u],
] as const

interface Entry { tool: AgentTool; original: string; group: string; keywords: string }

// 目录保留完整已授权工具；活动集合只在完整工具轮结束后发布。
export class RuntimeToolDiscovery {
  private readonly entries: Entry[]
  private readonly permanent: AgentTool[]
  private readonly selected = new Map<string, number>()
  private readonly pinned = new Set<string>()
  private readonly pending = new Set<string>()
  private readonly unavailable?: (name: string) => string | undefined
  private readonly onLoad?: (name: string) => void
  private clock = 0
  readonly tool: AgentTool

  constructor(tools: AgentTool[], originalName: (name: string) => string | null, permanent: AgentTool[], unavailable?: (name: string) => string | undefined, onLoad?: (name: string) => void) {
    this.unavailable = unavailable
    this.onLoad = onLoad
    this.entries = [...tools, ...permanent].map((tool) => {
      const original = originalName(tool.name) ?? tool.name
      const group = groups.find((item) => item[2].test(original))
      return { tool: this.withNavigation(tool, original), original, group: group?.[0] ?? 'other', keywords: group?.[1] ?? original }
    }).sort((a, b) => a.original.localeCompare(b.original))
    this.tool = {
      name: 'discover_tools', label: '发现工具', executionMode: 'sequential',
      description: '需要的准确操作未加载或不确定当前工具能否完成目标时，先用此工具搜索，禁止拿相似或相反操作代替。query 填目标动作，或用 group、精确 names，至少一项；最多加载 8 个已授权工具，下一轮才可调用。返回 name 是实际名称，完整参数进入工具声明。',
      parameters: Type.Object({
        query: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
        group: Type.Optional(Type.Union(groups.map(([name]) => Type.Literal(name)))),
        names: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 8 })),
      }, { additionalProperties: false, minProperties: 1 }),
      execute: async (_id, input) => {
        const args = input as DiscoveryInput
        const scored = this.entries.map((entry) => ({ entry, score: scoreToolEntry(entry, args) }))
          .filter((v) => v.score > 0).sort((a, b) => b.score - a.score || a.entry.original.localeCompare(b.entry.original)).slice(0, 8)
        const blocked = scored.filter(({ entry }) => this.unavailable?.(entry.original))
        const eligible = scored.filter((entry) => !blocked.includes(entry))
        const admitted = eligible.filter(({ entry }) => this.schedule(entry))
        const notFound = args.names?.filter((name) => !this.entries.some((entry) => entry.original === name || entry.tool.name === name)) ?? []
        const desktop = admitted.some(({ entry }) => entry.original.includes('desktop'))
        return { content: [{ type: 'text', text: JSON.stringify({
          tools: admitted.map(({ entry }) => ({ name: entry.tool.name, original_name: entry.original, purpose: entry.tool.description, group: entry.group })),
          ...(notFound.length ? { not_found: notFound, unavailable_guidance: '这些名称不在当前授权目录中；按能力组查询实际工具，不要猜测名称。' } : {}),
          ...(blocked.length ? { unavailable: blocked.map(({ entry }) => ({ name: entry.original, reason: this.unavailable?.(entry.original) })) } : {}),
          ...(admitted.length < eligible.length ? { deferred: eligible.filter((entry) => !admitted.includes(entry)).map(({ entry }) => entry.original), notice: '本轮待加载工具已达容量上限；先使用已加载工具，下一轮再发现其余能力。' } : {}),
          ...(desktop ? { guidance: desktopToolGuide, skill: 'skill://termous-desktop-workflows/SKILL.md' } : {}),
          ...(admitted.length === 0 ? { groups: this.catalog(), guidance: '使用能力组或精确工具名重新查询；目录仅包含当前获准能力。' } : {}),
        }) }], details: { kind: 'tool_discovery' } }
      },
    }
    this.permanent = [this.tool, ...permanent]
  }

  private withNavigation(tool: AgentTool, original: string): AgentTool {
    return { ...tool, execute: async (id, input, signal, update) => {
      const result = await tool.execute(id, input, signal, update)
      const navigation = runtimeToolNavigation(original, result)
      if (!navigation) return result
      const restriction = navigation.names.map((name) => this.unavailable?.(name)).find(Boolean)
      const next = navigation.names.flatMap((name) => {
        const entry = this.entries.find((candidate) => candidate.original === name)
        return entry && this.schedule(entry) ? [{ name: entry.tool.name, original_name: name }] : []
      })
      return { ...result, content: [...result.content, { type: 'text', text: JSON.stringify({
        tool_navigation: { guidance: restriction ?? navigation.guidance, available_next_turn: next },
      }) }] }
    } }
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

  loadReferencedTools(content: string) {
    // Skill 来自当前可信快照；只加载目录中真实存在的引用，不执行文档内操作。
    const names = [...new Set(content.match(/termous\.[a-z_]+(?:\.[a-z_]+)+|wait_workflow_run/gu) ?? [])]
      .filter((name) => this.entries.some((entry) => entry.original === name)).slice(0, 8)
    return names.flatMap((name) => {
      const entry = this.entries.find((candidate) => candidate.original === name)
      return entry && this.schedule(entry) ? [{ name: entry.tool.name, original_name: name }] : []
    })
  }

  touch(name: string) {
    if (this.selected.has(name)) this.selected.set(name, ++this.clock)
    const entry = this.entries.find((v) => v.tool.name === name)
    if (!entry) return
    this.pinCleanup(entry)
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

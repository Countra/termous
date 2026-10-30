import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { Compile } from 'typebox/compile'
import type { ToolNavigation } from './runtimeToolNavigation.ts'
import { createToolSearch, toolUsageAlias, type DiscoveryInput } from './runtimeToolSearch.ts'
import type { ToolDeclarationState } from '../contracts/toolCapabilities.ts'
import { runtimeCapability, runtimeCapabilityStep, runtimeToolOperations, skillEntryTools } from './runtimeCapabilityCatalog.ts'
import { RuntimeToolRegistry, type RuntimeToolEntry } from './runtimeToolRegistry.ts'
import { RuntimeActiveTools } from './runtimeActiveTools.ts'
import { runtimeDiscoveryPage } from './runtimeDiscoveryPage.ts'
import { runtimeCapabilityIndex } from './runtimeCapabilityIndex.ts'
import type { RuntimeSkillDirectory } from './runtimeSkillDirectory.ts'
import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'
import type { ObservationTarget } from '../contracts/desktopObservation.ts'

// 目录覆盖本轮全部来源；只在完整工具轮结束后发布新的活动声明。
export class RuntimeToolDiscovery {
  readonly registry: RuntimeToolRegistry
  private readonly activeTools: RuntimeActiveTools
  private preferredCapabilities = new Set<string>()
  private readonly unavailable?: (name: string) => string | undefined
  private readonly onLoad?: (name: string) => void
  readonly tool: AgentTool
  private readonly placeholders = new Map<string, AgentTool['parameters']>()
  private readonly loadTool?: (name: string, signal?: AbortSignal) => Promise<AgentTool['parameters'] | undefined>
  private readonly loadErrors = new Map<string, string>()

  constructor(tools: AgentTool[], originalName: (name: string) => string | null, permanent: AgentTool[], unavailable?: (name: string) => string | undefined,
    onLoad?: (name: string) => void, skills?: RuntimeSkillDirectory,
    loadTool?: (name: string, signal?: AbortSignal) => Promise<AgentTool['parameters'] | undefined>) {
    this.loadTool = loadTool
    this.unavailable = unavailable
    this.onLoad = onLoad
    this.registry = new RuntimeToolRegistry([...tools, ...permanent], originalName, skills)
    for (const entry of this.registry.entries) entry.tool = this.withDescription(entry)
    if (loadTool) for (const entry of this.registry.entries) if (!entry.trusted) this.placeholders.set(entry.tool.name, entry.tool.parameters)
    this.tool = {
      name: 'discover_tools', label: '发现工具', executionMode: 'sequential',
      description: 'Find exact tools or skills. Use names for known names, operation + query for a business action, or group/source to browse. kind defaults to tools; skills returns reading references only. At most 8 results per page; follow next_cursor with identical filters. Returned tools become callable next turn. Discovery never executes or authorizes actions.',
      parameters: Type.Object({
        query: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
        operation: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        group: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        source: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        kind: Type.Optional(Type.Union(['tools', 'skills', 'all'].map((kind) => Type.Literal(kind)))),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
        cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
        names: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { minItems: 1, maxItems: 8 })),
      }, { additionalProperties: false }),
      execute: async (_id, input, signal) => this.discover(input as DiscoveryInput, signal),
    }
    this.activeTools = new RuntimeActiveTools(this.registry.entries, [this.tool, ...permanent])
  }

  private async discover(args: DiscoveryInput, signal?: AbortSignal) {
    const result = runtimeDiscoveryPage(this.registry, args, this.preferredCapabilities, (entry) => Boolean(this.blocked(entry)))
    const found = result.page.flatMap((hit) => hit.tool ? [hit.tool] : [])
    for (const entry of found) if (!entry.trusted && this.loadTool) {
      try {
        const parameters = await this.loadTool(entry.tool.name, signal)
        if (parameters) entry.tool = { ...entry.tool, parameters }
        this.loadErrors.delete(entry.tool.name)
      } catch (error) {
        signal?.throwIfAborted()
        this.loadErrors.set(entry.tool.name, error instanceof Error && /^INTEGRATION_[A-Z_]+$/u.test(error.message) ? error.message : 'INTEGRATION_TOOL_UNAVAILABLE')
      }
    }
    const blocked = found.filter((entry) => this.blocked(entry))
    const eligible = found.filter((entry) => !this.blocked(entry))
    const admitted = eligible.filter((entry) => this.schedule(entry))
    if (admitted.length) this.preferredCapabilities = new Set(admitted.flatMap((entry) => entry.capability ? [entry.capability.id] : []))
    const notFound = args.names?.filter((name) => !this.registry.entries.some((entry) => (!args.source || args.source === entry.source.id) && (entry.original === name || entry.tool.name === name))
      && !this.registry.skills?.catalog.some((skill) => (!args.source || args.source === skill.source.id) && (skill.name === name || skill.entry_uri === name))) ?? []
    const skills = result.page.flatMap((hit) => hit.skill ? [{ name: hit.skill.name, source: hit.skill.source.id, description: hit.skill.description, uri: hit.skill.entry_uri }] : [])
    const purposeSearch = args.kind !== 'skills' && args.operation && args.query && !args.names?.length ? createToolSearch({ ...args, operation: undefined }) : undefined
    const alternatives = purposeSearch ? this.registry.entries.filter(entry => entry.trusted && !this.blocked(entry)
      && (!args.source || args.source === entry.source.id) && toolUsageAlias(entry.original, args.query!)
      && !runtimeToolOperations(entry.original).includes(args.operation!) && purposeSearch(entry) > 0).slice(0, 3)
      .map(entry => ({ source: entry.source.id, original_name: entry.original,
        discovery: { tool: 'discover_tools', arguments: { source: entry.source.id, query: args.query, operation: runtimeToolOperations(entry.original)[0] } },
      })) : []
    return { content: [{ type: 'text' as const, text: JSON.stringify({
      tools: admitted.map((entry) => ({ ...this.registry.describe(entry), match: args.names?.length ? 'exact_name' : args.query ? 'query' : 'browse' })),
      skills, total_matches: result.total, ...(result.next_cursor ? { next_cursor: result.next_cursor } : {}),
      ...(alternatives.length ? { related_actions: alternatives, operation_guidance: 'These tools support the requested purpose but have a different operation. They were not loaded by this explicit operation filter; execution and approval policies remain unchanged.' } : {}),
      ...(result.ambiguous.length ? { ambiguous: result.ambiguous, guidance: 'Choose an exact returned name or source; no ambiguous tool was loaded.' } : {}),
      ...(notFound.length ? { not_found: notFound, unavailable_guidance: 'These names are absent from the selected authorized catalog. Browse or search actual capabilities instead of guessing names.' } : {}),
      ...(blocked.length ? { unavailable: blocked.map((entry) => ({ name: entry.original, source: entry.source.id, reason: this.blocked(entry) })) } : {}),
      ...(admitted.length < eligible.length ? { deferred: eligible.filter((entry) => !admitted.includes(entry)).map((entry) => entry.tool.name), notice: 'Pending declarations reached capacity. Use loaded tools, then discover the deferred tools next turn.' } : {}),
      ...(args.group && admitted.some((entry) => entry.group !== args.group) ? { group_correction: 'The explicit resource and operation identify another capability group; inspect the returned tools.' } : {}),
      ...(!result.page.length && !result.ambiguous.length ? { groups: this.catalog(), guidance: 'No match. Separate the action and resource, browse a source/group, or use exact names. Do not substitute a tool with a different effect.' } : {}),
    }) }], details: { kind: 'tool_discovery' } }
  }

  private withDescription(entry: RuntimeToolEntry): AgentTool {
    const { tool, original, capability } = entry
    if (!entry.trusted) return tool
    const step = runtimeCapabilityStep(original)
    if (tool.description.includes('Built-in Agent:')) {
      const guidance = (step?.role === 'input' || step?.evidence === 'image') && step.guidance ? ` Next action: ${step.guidance}` : ''
      return { ...tool, description: `${tool.description}${guidance}${capability ? ` Reference: ${capability.skill}` : ''}` }
    }
    const boundary = capability && !tool.description.includes(capability.purpose) ? `\n职责：${capability.purpose}\n说明：${capability.skill}` : ''
    const guidance = step?.guidance && !tool.description.includes(step.guidance) ? `\n后续：${step.guidance}` : ''
    const preparation = step?.preparation && !tool.description.includes(step.preparation) ? `\n调用前：${step.preparation}` : ''
    const action = step && !tool.description.includes('\n动作：') ? `\n动作：${runtimeToolOperations(original).join(', ')}` : ''
    return { ...tool, description: tool.description + boundary + preparation + guidance + action }
  }

  resolveNavigation(navigation: ToolNavigation): ToolNavigation {
    const query = navigation.prerequisite
    if (!query) return navigation
    const entry = this.registry.entries.find(candidate => candidate.trusted && candidate.original === query.tool)
    if (!entry || this.blocked(entry)) return { ...navigation, prerequisite: undefined,
      guidance: `${navigation.guidance} The suggested tool is unavailable under current permissions; do not substitute another action.` }
    if (!Compile(entry.tool.parameters).Check(query.arguments)) return { ...navigation, prerequisite: undefined,
      guidance: `${navigation.guidance} Inspect this tool's current schema and supply the missing business parameters; no complete call arguments are available.` }
    return { ...navigation, guidance: `${navigation.guidance} When its declaration is available, call ${query.tool} (callable name ${entry.tool.name}) with ${JSON.stringify(query.arguments)}.` }
  }

  navigate(navigation: ToolNavigation, concise = false) {
    const query = navigation.prerequisite
    const entry = query && this.registry.entries.find(candidate => candidate.trusted && candidate.original === query.tool && !this.blocked(candidate))
    const action = entry && Compile(entry.tool.parameters).Check(query!.arguments) ? { tool: entry.tool.name, arguments: query!.arguments } : undefined
    const next = this.loadNames(navigation.names)
    const admitted = new Set(next.map((item) => item.original_name))
    const unavailable = navigation.names.filter((name) => !admitted.has(name)).map((name) => ({ name,
      status: this.available(name) ? 'deferred' : 'unavailable',
      reason: this.unavailable?.(name) ?? (this.available(name) ? '本轮声明容量不足，下轮按需发现' : '不在当前授权工具目录中'),
      ...(this.available(name) ? { discovery: { tool: 'discover_tools', arguments: { names: [name] } } } : {}),
    }))
    if (concise && !next.length && !unavailable.length) return ''
    return JSON.stringify({ tool_navigation: { ...(concise ? {} : { guidance: navigation.guidance, skill: navigation.skill }), available_next_turn: next,
      ...(unavailable.length ? { unavailable } : {}),
      ...(query && action && admitted.has(query.tool) ? { next_action: action } : {}),
    } })
  }

  private blocked(entry: RuntimeToolEntry) { return entry.trusted ? this.unavailable?.(entry.original) : this.loadErrors.get(entry.tool.name) }
  private schedule(entry: RuntimeToolEntry) {
    if (this.blocked(entry) || !this.activeTools.schedule(entry)) return false
    if (entry.trusted) this.onLoad?.(entry.original)
    return true
  }
  catalog() { return this.registry.groups() }
  declaration(name: string, published: readonly AgentTool[] = this.active()): ToolDeclarationState {
    const entry = this.registry.entries.find(candidate => candidate.trusted && candidate.original === name)
    return { original_name: name, ...(entry ? { name: entry.tool.name, source: entry.source.id } : {}),
      status: !entry || this.blocked(entry) ? 'unavailable' : published.some(tool => tool.name === entry.tool.name) ? 'declared' : 'discoverable' }
  }
  retainedNames() {
    return this.activeTools.requested().flatMap(name => {
      const entry = this.registry.entries.find(candidate => candidate.tool.name === name && candidate.trusted)
      return entry ? [entry.original] : []
    })
  }
  restoreNames(names: string[]) {
    const admitted = this.loadNames(names)
    this.activeTools.restorePending()
    return admitted
  }
  index() { return runtimeCapabilityIndex(this.registry, (name) => this.available(name)) }
  preload(bindings: readonly RuntimeResourceBinding[], target?: ObservationTarget) { this.loadNames(this.registry.initial(bindings, (name) => this.available(name), target)); return this.publish() }
  available(name: string) { return this.registry.entries.some((entry) => entry.trusted && entry.original === name && !this.blocked(entry)) }
  loadNames(names: string[]) {
    return names.flatMap((name) => {
      const entry = this.registry.entries.find((candidate) => candidate.trusted && candidate.original === name)
      return entry && this.schedule(entry) ? [{ name: entry.tool.name, original_name: name }] : []
    })
  }
  loadReferencedTools(_content: string, uri?: string) {
    if (uri && this.registry.skills && !this.registry.skills.builtin(uri)) return []
    return this.loadNames((uri ? skillEntryTools(uri) : []).slice(0, 8))
  }
  touch(name: string) { this.activeTools.touch(name) }
  complete(name: string) { this.activeTools.complete(name) }
  used(name: string) {
    if (!this.available(name)) return
    const capability = runtimeCapability(name)
    const role = runtimeCapabilityStep(name)?.role
    if (capability && role && ['submit', 'mutate', 'input', 'preview'].includes(role)) this.preferredCapabilities = new Set([capability.id])
  }
  publish() {
    this.activeTools.publish()
    const active = this.active()
    const names = new Set(active.map(tool => tool.name))
    for (const entry of this.registry.entries) {
      const placeholder = this.placeholders.get(entry.tool.name)
      if (placeholder && !names.has(entry.tool.name)) entry.tool = { ...entry.tool, parameters: placeholder }
    }
    return active
  }
  active() { return this.activeTools.active().filter((tool) => !this.registry.entries.some((entry) => entry.tool.name === tool.name && this.blocked(entry))) }
}

import { createHash } from 'node:crypto'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'
import type { ObservationTarget } from '../contracts/desktopObservation.ts'
import type { ToolCapability } from '../contracts/toolCapabilities.ts'
import { unclassifiedToolSource, toolIdentity, trustedTool, type ToolSource } from '../contracts/toolSources.ts'
import { capabilityToolName, runtimeCapability, runtimeCapabilityStep, runtimeToolOperations } from './runtimeCapabilityCatalog.ts'
import type { RuntimeSkillDirectory } from './runtimeSkillDirectory.ts'
import { initialTools } from './discovery/initialTools.ts'
import { describeCapabilityTool } from './guidance/description.ts'
import { capabilityEntries } from './discovery/entries.ts'

export interface RuntimeToolEntry {
  tool: AgentTool
  original: string
  source: ToolSource
  trusted: boolean
  group: string
  keywords: string
  searchText: string
  capability?: ToolCapability
}

export class RuntimeToolRegistry {
  readonly entries: RuntimeToolEntry[]
  readonly fingerprint: string
  readonly skills?: RuntimeSkillDirectory
  constructor(tools: AgentTool[], originalName: (name: string) => string | null, skills?: RuntimeSkillDirectory) {
    this.skills = skills
    const seen = new Set<string>()
    this.entries = tools.map((tool) => {
      if (seen.has(tool.name)) throw new Error('AGENT_MCP_TOOL_NAME_CONFLICT')
      seen.add(tool.name)
      const identity = toolIdentity(tool)
      const original = identity?.originalName ?? originalName(tool.name) ?? tool.name
      const trusted = trustedTool(tool)
      const source = identity?.source ?? unclassifiedToolSource
      const capability = trusted ? runtimeCapability(original) : undefined
      tool = trusted ? describeCapabilityTool(tool, original, capability) : tool
      const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties
      return { tool, original, source, trusted, capability, group: capability?.group ?? source.id,
        keywords: capability?.keywords ?? '',
        searchText: [original, tool.label, tool.description, capability?.selection?.use_when ?? '', ...Object.keys(properties ?? {})].join(' ').toLowerCase() }
    }).sort((a, b) => a.source.id.localeCompare(b.source.id) || a.original.localeCompare(b.original))
    this.fingerprint = createHash('sha256').update(JSON.stringify([
      this.entries.map(({ tool, source, original, capability }) => [source.id, original, tool.description, tool.parameters, capability, toolIdentity(tool)?.directoryVersion]), skills?.fingerprint,
    ])).digest('hex')
  }

  groups() {
    return [...new Set(this.entries.map((entry) => entry.group))].map((group) => ({ group,
      description: [...new Set(this.entries.filter((entry) => entry.group === group).map((entry) => entry.capability?.discovery.summary ?? entry.source.id))].join('; ') }))
  }

  initial(bindings: readonly RuntimeResourceBinding[], available: (name: string) => boolean, target?: ObservationTarget): string[] {
    return initialTools(this.entries, bindings, available, target)
  }

  entryNames(capability: ToolCapability, available: (name: string) => boolean = () => true): string[] {
    return capabilityEntries(capability, capabilityToolName).filter(name => this.entries.some(entry => entry.trusted && entry.original === name) && available(name))
  }

  alternatives(capability: ToolCapability, available: (name: string) => boolean = () => true) {
    return (capability.selection?.alternatives ?? []).flatMap(alternative => {
      const related = this.entries.find(entry => entry.trusted && entry.capability?.id === alternative.capability)?.capability
      const names = related ? this.entryNames(related, available) : []
      return names.length ? [{ ...alternative, discovery: { tool: 'discover_tools', arguments: { names } } }] : []
    })
  }

  describe(entry: RuntimeToolEntry, available?: (name: string) => boolean) {
    return { name: entry.tool.name, original_name: entry.original, source: entry.source.id, purpose: entry.tool.description, group: entry.group,
      ...(entry.capability ? { stage: runtimeCapabilityStep(entry.original)?.role, operations: runtimeToolOperations(entry.original), skill: entry.capability.skill,
        ...(entry.capability.selection ? { selection: { use_when: entry.capability.selection.use_when, alternatives: this.alternatives(entry.capability, available) } } : {}) } : {}) }
  }

}

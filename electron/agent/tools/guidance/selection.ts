import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { RuntimeToolRegistry } from '../runtimeToolRegistry.ts'

export function capabilitySelectionGuidance(registry: RuntimeToolRegistry, published: readonly AgentTool[], available: (name: string) => boolean) {
  const declared = new Set(published.map(tool => tool.name))
  const seen = new Set<string>()
  return registry.entries.flatMap(entry => {
    const capability = entry.capability
    if (!entry.trusted || !declared.has(entry.tool.name) || !capability?.selection || seen.has(capability.id)) return []
    seen.add(capability.id)
    const alternatives = registry.alternatives(capability, available).map(alternative => ({
      capability: alternative.capability, when: alternative.when,
      tools: alternative.discovery.arguments.names.map(original => {
        const tool = registry.entries.find(candidate => candidate.trusted && candidate.original === original)!
        return { name: tool.tool.name, status: declared.has(tool.tool.name) ? 'declared' : 'discoverable' }
      }),
    }))
    return [{ current_capability: capability.id, use_when: capability.selection.use_when,
      ...(alternatives.length ? { alternatives } : {}) }]
  })
}

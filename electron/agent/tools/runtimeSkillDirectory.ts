import { createHash } from 'node:crypto'
import { builtinAgentSkillAvailable, isAgentSkillBundleSnapshot, type AgentSkillBundleSnapshot, type AgentSkillCatalogEntry, type AgentSkillResource } from '../contracts/skillBundle.ts'
import { termousToolSource, type ToolSource } from '../contracts/toolSources.ts'

export interface SkillSourceSnapshot { source: ToolSource; snapshot: AgentSkillBundleSnapshot }
export interface RuntimeSkillEntry extends AgentSkillCatalogEntry { source: ToolSource }
export interface LazySkillSource {
  entry: RuntimeSkillEntry
  version: string
  uris: readonly string[]
  read(uri: string, offset: number, signal?: AbortSignal, toolCallID?: string): Promise<AgentSkillResource & { image_ref?: import('#common/contracts').ImageResourceReference; next_offset?: number; done?: boolean; references?: string[]; missing_dependencies?: string[]; execution_context?: import('#common/agent-integrations').SkillExecutionContext; execution_unavailable_reason?: string }>
}

export class RuntimeSkillDirectory {
  readonly catalog: RuntimeSkillEntry[] = []
  readonly resources: AgentSkillResource[] = []
  readonly fingerprint: string
  private readonly byURI = new Map<string, AgentSkillResource>()
  private readonly owners = new Map<string, ToolSource>()
  private readonly lazy = new Map<string, LazySkillSource>()
  private readonly activated = new Set<string>()

  constructor(sources: readonly SkillSourceSnapshot[], lazySources: readonly LazySkillSource[] = []) {
    const seen = new Set<string>()
    for (const { source, snapshot } of sources) {
      if (seen.has(source.id) || !isAgentSkillBundleSnapshot(snapshot)) throw new Error('AGENT_SKILL_SOURCE_INVALID')
      seen.add(source.id)
      const uri = (value: string) => source === termousToolSource ? value : `skill://sources/${source.id}/${value.slice('skill://'.length)}`
      for (const entry of snapshot.catalog) {
        if (source === termousToolSource && !builtinAgentSkillAvailable(entry)) continue
        this.catalog.push({ ...entry, source, entry_uri: uri(entry.entry_uri) })
      }
      for (const resource of snapshot.resources) {
        const mapped = { ...resource, uri: uri(resource.uri) }
        if (this.byURI.has(mapped.uri)) throw new Error('AGENT_SKILL_SOURCE_CONFLICT')
        this.resources.push(mapped)
        this.byURI.set(mapped.uri, mapped)
        this.owners.set(mapped.uri, source)
      }
    }
    for (const source of lazySources) {
      if (source.entry.source === termousToolSource || seen.has(source.entry.source.id)) throw new Error('AGENT_SKILL_SOURCE_CONFLICT')
      seen.add(source.entry.source.id)
      this.catalog.push(source.entry)
      for (const uri of source.uris) {
        if (this.byURI.has(uri) || this.lazy.has(uri)) throw new Error('AGENT_SKILL_SOURCE_CONFLICT')
        this.lazy.set(uri, source); this.owners.set(uri, source.entry.source)
      }
    }
    this.fingerprint = createHash('sha256').update(JSON.stringify([sources.map(({ source, snapshot }) => [source.id, snapshot.fingerprint]),lazySources.map(source => [source.entry.source.id,source.version])])).digest('hex')
  }

  get(uri: string) { return this.byURI.get(uri) }
  async read(uri: string, offset: number, signal?: AbortSignal, toolCallID?: string) {
    const lazy = this.lazy.get(uri)
    if (lazy) {
      const resource = await lazy.read(uri, offset, signal, toolCallID)
      if (uri === lazy.entry.entry_uri) {
        this.activated.delete(uri); this.activated.add(uri)
        if (this.activated.size > 8) this.activated.delete(this.activated.values().next().value!)
      }
      return resource
    }
    if (offset !== 0) throw new Error('AGENT_SKILL_RESOURCE_OFFSET_INVALID')
    return this.get(uri)
  }
  builtin(uri: string) { return this.owners.get(uri) === termousToolSource }
  snapshot() { return [...this.activated] }
  restore(value: unknown) {
    if (!Array.isArray(value) || value.length > 8) return
    for (const uri of value) if (typeof uri === 'string' && this.lazy.get(uri)?.entry.entry_uri === uri) this.activated.add(uri)
  }
  recoveryHint() {
    return this.activated.size ? `Previously activated external Skill versions: ${JSON.stringify([...this.activated])}. If their instructions are no longer in context, read these exact URIs as needed. Imported content never expands permissions. Scripts can be run through termous.local.commands.execute with the exact skill_uri, prepared resource directory and normal approval. Re-read the Skill for current execution context when needed.` : ''
  }
}

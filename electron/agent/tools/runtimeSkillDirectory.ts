import { createHash } from 'node:crypto'
import { builtinAgentSkillAvailable, isAgentSkillBundleSnapshot, type AgentSkillBundleSnapshot, type AgentSkillCatalogEntry, type AgentSkillResource } from '../contracts/skillBundle.ts'
import { termousToolSource, type ToolSource } from '../contracts/toolSources.ts'

export interface SkillSourceSnapshot { source: ToolSource; snapshot: AgentSkillBundleSnapshot }
export interface RuntimeSkillEntry extends AgentSkillCatalogEntry { source: ToolSource }

export class RuntimeSkillDirectory {
  readonly catalog: RuntimeSkillEntry[] = []
  readonly resources: AgentSkillResource[] = []
  readonly fingerprint: string
  private readonly byURI = new Map<string, AgentSkillResource>()
  private readonly owners = new Map<string, ToolSource>()

  constructor(sources: readonly SkillSourceSnapshot[]) {
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
    this.fingerprint = createHash('sha256').update(JSON.stringify(sources.map(({ source, snapshot }) => [source.id, snapshot.fingerprint]))).digest('hex')
  }

  get(uri: string) { return this.byURI.get(uri) }
  builtin(uri: string) { return this.owners.get(uri) === termousToolSource }
}

import { createHash } from 'node:crypto'
import { createToolSearch, genericSearchScore, type DiscoveryInput } from './runtimeToolSearch.ts'
import type { RuntimeToolEntry, RuntimeToolRegistry } from './runtimeToolRegistry.ts'
import type { RuntimeSkillEntry } from './runtimeSkillDirectory.ts'

type Hit = { id: string; score: number; tool?: RuntimeToolEntry; skill?: RuntimeSkillEntry }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function runtimeDiscoveryPage(registry: RuntimeToolRegistry, args: DiscoveryInput, preferred: ReadonlySet<string>, blocked: (entry: RuntimeToolEntry) => boolean = () => false) {
  const { cursor, limit = 8 } = args
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error('AGENT_DISCOVERY_LIMIT_INVALID')
  const signature = digest([registry.fingerprint, registry.entries.filter(blocked).map((entry) => entry.tool.name), args.query ?? '', args.operation ?? '', args.group ?? '', args.source ?? '',
    args.kind ?? 'tools', args.names ? [...args.names].sort() : [], limit])
  let offset = 0
  let context = [...preferred]
  if (cursor) {
    try {
      if (cursor.length > 4096) throw new Error()
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (value.signature !== signature || !Number.isSafeInteger(value.offset) || value.offset < 0
        || !Array.isArray(value.context) || value.context.length > 8 || value.context.some((id: unknown) => typeof id !== 'string' || id.length > 128)) throw new Error()
      offset = value.offset
      context = value.context
    } catch { throw new Error('AGENT_DISCOVERY_CURSOR_STALE: Repeat the search without cursor and keep the same filters when paging.') }
  }
  const score = createToolSearch(args, new Set(context))
  const candidates = registry.entries.filter((entry) => !args.source || entry.source.id === args.source)
  const ambiguous: Array<{ requested: string; candidates: Array<{ name: string; source: string }> }> = []
  const excluded = new Set<string>()
  for (const name of args.names ?? (args.query ? [args.query] : [])) {
    const matches = candidates.filter((entry) => entry.original === name || entry.tool.name === name)
    if (matches.length <= 1 || matches.some((entry) => entry.tool.name === name)) continue
    ambiguous.push({ requested: name, candidates: matches.map((entry) => ({ name: entry.tool.name, source: entry.source.id })) })
    matches.forEach((entry) => excluded.add(entry.tool.name))
  }
  const hits: Hit[] = args.kind === 'skills' ? [] : candidates.filter((entry) => !excluded.has(entry.tool.name))
    .map((tool) => ({ id: `tool:${tool.source.id}:${tool.original}`, score: score(tool), tool })).filter((hit) => hit.score > 0)
  if (args.kind === 'skills' || args.kind === 'all') {
    for (const skill of registry.skills?.catalog ?? []) {
      if (args.source && skill.source.id !== args.source || args.group && args.group !== skill.source.id) continue
      const exact = args.names?.includes(skill.name) || args.names?.includes(skill.entry_uri)
      if (args.names?.length && !exact) continue
      const relevance = exact ? 10000 : args.query ? genericSearchScore(args.query, `${skill.name} ${skill.description}`) : 1
      if (relevance) hits.push({ id: `skill:${skill.entry_uri}`, score: relevance, skill })
    }
  }
  hits.sort((a, b) => Number(Boolean(a.tool && blocked(a.tool))) - Number(Boolean(b.tool && blocked(b.tool))) || b.score - a.score || a.id.localeCompare(b.id))
  if (offset > hits.length) throw new Error('AGENT_DISCOVERY_CURSOR_STALE')
  const page = hits.slice(offset, offset + limit)
  const next = offset + page.length
  return { page, ambiguous, total: hits.length,
    next_cursor: next < hits.length ? Buffer.from(JSON.stringify({ signature, offset: next, context })).toString('base64url') : undefined }
}

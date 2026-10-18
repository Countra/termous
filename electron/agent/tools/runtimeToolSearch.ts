import { runtimeCapabilities, runtimeCapability, runtimeCapabilityStep, runtimeOperations, runtimeToolOperations } from './runtimeCapabilityCatalog.ts'

interface SearchEntry { original: string; group: string; keywords: string; tool: { name: string; description: string } }
export interface DiscoveryInput { query?: string; operation?: string; group?: string; names?: string[] }

const vocabulary = Object.entries(runtimeOperations).flatMap(([operation, keywords]) => keywords.split(' ').map((word) => ({ operation, word })))

function queryOperations(query: string) {
  // 兼容旧的自由文本查询：召回所有非重叠动作，不以第一个词替模型决定目标。
  const matches = vocabulary.flatMap(({ operation, word }) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const pattern = new RegExp(/[\u4e00-\u9fff]/u.test(word) ? escaped : `\\b${escaped}\\b`, 'gu')
    return [...query.matchAll(pattern)].map((match) => ({ operation, start: match.index, end: match.index + word.length }))
  })
  return [...new Set(matches.filter((match) => !matches.some((other) => other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start))
    .filter((match) => !/(?:已(?:经)?|曾(?:经)?|尚未|未曾)$/u.test(query.slice(0, match.start)))
    .map((match) => match.operation))]
}

function resourceTerms(keywords: string, query: string) {
  return keywords.toLowerCase().split(' ').filter((word) => word.length > 1 && (/[\u4e00-\u9fff]/u.test(word) ? query.includes(word) : query.split(/[^a-z0-9_]+/u).includes(word)))
}

export function createToolSearch(args: DiscoveryInput, preferredCapabilities: ReadonlySet<string> = new Set()) {
  const query = (args.query ?? '').trim().toLowerCase()
  // 显式动作是精确过滤条件；自然语言仅做有界召回，资源与动作由同一契约索引。
  const segments = args.operation ? [query] : query.split(/并且|以及|然后|并|再|和|与|或|\band\b/u)
  const intents = segments.flatMap((segment) => (args.operation ? [args.operation] : queryOperations(segment)).map((operation) => ({ operation, segment })))
  const candidates = (intents.length ? intents : [{ operation: undefined, segment: query }]).map(({ operation, segment }) => {
    let matches = runtimeCapabilities.map((capability) => ({ capability, terms: resourceTerms(capability.keywords, segment) }))
    if (!matches.some(({ terms }) => terms.length)) matches = runtimeCapabilities.map((capability) => ({ capability, terms: resourceTerms(capability.keywords, query) }))
    // 先独立确定资源，再求动作交集；不能因目标不支持某动作就退回较泛的其他资源。
    const resources = matches.filter(({ terms }) => !matches.some((other) => other.terms.length > terms.length && terms.every((term) => other.terms.some((specific) => specific.includes(term)))))
    const scores = new Map(resources.map(({ capability, terms }) => [capability.id, terms.length]))
    const best = Math.max(0, ...scores.values())
    const groupBest = Math.max(0, ...resources.filter(({ capability }) => capability.group === args.group).map(({ terms }) => terms.length))
    // group 是导航提示；明确资源目标更强时纠正错组，授权范围始终由真实目录限定。
    return { operation, scores, best, group: args.group && groupBest >= best ? args.group : undefined }
  })
  return (entry: SearchEntry) => {
    if (args.names?.length) return args.names.includes(entry.original) || args.names.includes(entry.tool.name) ? 10000 : 0
    const original = entry.original.toLowerCase()
    if (query === original || query === entry.tool.name.toLowerCase()) return 10000
    const capability = runtimeCapability(entry.original)
    const operations = runtimeToolOperations(entry.original)
    const role = runtimeCapabilityStep(original)?.role
    const score = query.split(/[\s,，。/]+/u).filter(Boolean).reduce((sum, token) => sum + (original.split('.').includes(token) ? 20 : entry.tool.description.toLowerCase().includes(token) ? 3 : 0), 0)
    return Math.max(0, ...candidates.map(({ operation, scores, best, group }) => {
      if (group && group !== entry.group || operation && !operations.includes(operation)) return 0
      const resource = capability ? scores.get(capability.id) ?? 0 : 0
      if (best > 0 && (!capability || !scores.has(capability.id))) return 0
      if (query && best === 0 && !group && (!capability || !preferredCapabilities.has(capability.id))) return 0
      const browse = !query && role && ['list', 'inspect', 'observe'].includes(role) ? 20 : 0
      const entryIndex = capability?.entry.findIndex((name) => (name.startsWith('termous.') || name === 'wait_workflow_run' ? name : capability.prefix + name) === entry.original) ?? -1
      const entryPriority = !query && entryIndex >= 0 ? 100 - entryIndex : 0
      const continuity = capability && preferredCapabilities.has(capability.id) ? 30 : 0
      const phase = /状态|进度|终态|\bstatus\b/u.test(query) && role === 'poll' ? 20 : 0
      return (group ? 100 : 0) + resource * 30 + (operation ? 200 : 0) + score + browse + entryPriority + continuity + phase
    }))
  }
}

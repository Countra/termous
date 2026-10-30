import { capabilityToolName, runtimeCapabilities, runtimeCapability, runtimeCapabilityStep, runtimeOperations, runtimeToolOperations } from './runtimeCapabilityCatalog.ts'
import { localToolNames } from '../contracts/toolNames.ts'

interface SearchEntry { original: string; group: string; keywords: string; trusted?: boolean; searchText?: string; tool: { name: string; description: string } }
export interface DiscoveryInput { query?: string; operation?: string; group?: string; names?: string[]; source?: string; kind?: 'tools' | 'skills' | 'all'; limit?: number; cursor?: string }

export function genericSearchScore(query: string, text: string) {
  const words = query.toLowerCase().split(/[\s.,，。/;:_-]+/u).filter(Boolean)
  const value = text.toLowerCase()
  return words.reduce((score, word) => score + (value.includes(word) ? 10 : 0), 0)
}

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

export function toolUsageAlias(name: string, query: string) {
  const capability = runtimeCapability(name)
  const aliases = Object.entries(capability?.discovery.aliases ?? {}).find(([tool]) => capabilityToolName(capability!, tool) === name)?.[1]
  const normalized = query.trim().toLowerCase()
  return aliases?.some(phrase => phrase.toLowerCase().split(/\s+/u).every(term => resourceTerms(term, normalized).length > 0)) ?? false
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
    return { operation, segment, scores, best, group: args.group && groupBest >= best ? args.group : undefined }
  })
  return (entry: SearchEntry) => {
    const capability = runtimeCapability(entry.original)
    // 精确名称不能隐式撤销显式动作条件；没有动作合同的外部工具仍使用描述检索。
    if (entry.trusted !== false && capability && args.operation && !runtimeToolOperations(entry.original).includes(args.operation)) return 0
    if (args.names?.length) return args.names.includes(entry.original) || args.names.includes(entry.tool.name) ? 10000 : 0
    const original = entry.original.toLowerCase()
    if (query === original || query === entry.tool.name.toLowerCase()) return 10000
    if (entry.trusted === false || !capability) {
      if (args.group && args.group !== entry.group) return 0
      const terms = [query, args.operation ?? ''].filter(Boolean).join(' ')
      return terms ? genericSearchScore(terms, entry.searchText ?? `${entry.original} ${entry.tool.description}`) : 1
    }
    const operations = runtimeToolOperations(entry.original)
    const role = runtimeCapabilityStep(original)?.role
    const lexicalScore = genericSearchScore(query, entry.searchText ?? `${entry.original} ${entry.tool.description}`)
    const score = query.split(/[\s,，。/]+/u).filter(Boolean).reduce((sum, token) => sum + (original.split('.').includes(token) ? 20 : entry.tool.description.toLowerCase().includes(token) ? 3 : 0), 0)
    return Math.max(0, ...candidates.map(({ operation, segment, scores, best, group }) => {
      const usage = toolUsageAlias(entry.original, segment)
      // 用途别名只补充自然语言召回，不能放宽显式动作或来源过滤。
      if (group && group !== entry.group && !usage || args.operation && !operations.includes(args.operation)) return 0
      const resource = capability ? scores.get(capability.id) ?? 0 : 0
      if (best > 0 && !scores.has(capability.id) && !usage) return 0
      // 推断动作不是硬过滤，但不同动作仍需用途或实际描述命中，不能只因同属一个能力就召回。
      if (operation && !operations.includes(operation) && !usage && !lexicalScore) return 0
      // 未命中业务词汇时仍检索真实声明；连续性只补足已识别的动作，不为任意无关查询兜底。
      const actionOnly = vocabulary.some(value => value.operation === operation && value.word === segment.trim())
      const phase = /状态|进度|终态|\bstatus\b/u.test(query) && role === 'poll' ? 20 : 0
      if (query && best === 0 && !group && !lexicalScore && !usage && !phase && !(actionOnly && operations.includes(operation!))) return 0
      const browse = !query && role && ['list', 'inspect', 'observe'].includes(role) ? 20 : 0
      const entryIndex = capability.discovery.entry.findIndex((name) => (name.startsWith('termous.') || localToolNames.has(name) ? name : capability.prefix + name) === entry.original)
      const entryPriority = !query && entryIndex >= 0 ? 100 - entryIndex : 0
      // 历史只用于同等相关性下的排序，不单独召回工具，也不压过当前用途。
      const continuity = query && preferredCapabilities.has(capability.id) ? 0.1 : 0
      // 浏览时所有通过过滤的工具都进入分页，入口优先级只影响排序。
      return (query ? 0 : 1) + (group === entry.group ? 100 : 0) + resource * 30 + (operation && operations.includes(operation) ? 200 : 0) + (usage ? 60 : 0) + score + (best === 0 ? lexicalScore : 0) + browse + entryPriority + continuity + phase
    }))
  }
}

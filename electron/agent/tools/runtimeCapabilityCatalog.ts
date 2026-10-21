import catalogData from '../contracts/capabilities.generated.json' with { type: 'json' }
import type { CapabilityCatalog, CapabilityStep, ToolCapability } from '../contracts/toolCapabilities.ts'
import { isRecord } from '../contracts/validation.ts'
import { recoveryGuidance, runtimeFailureKind } from './runtimeToolRecovery.ts'

// 源契约位于 termous-skills/contracts；构建检查生成副本，运行时不读取文档正则或外部路径。
const catalog = catalogData as CapabilityCatalog
export const runtimeCapabilities = catalog.capabilities
export const runtimeOperations = catalog.operations
const index = new Map<string, { capability: ToolCapability; step: CapabilityStep }>()
for (const capability of runtimeCapabilities) for (const step of capability.steps) for (const tool of step.tools) {
  index.set(capabilityToolName(capability, tool), { capability, step })
}

export function capabilityToolName(capability: ToolCapability, name: string) {
  return name.startsWith('termous.') || name === 'wait_workflow_run' ? name : capability.prefix + name
}

export function runtimeCapability(name: string) { return index.get(name)?.capability }
export function runtimeCapabilityStep(name: string) { return index.get(name)?.step }
export function runtimeToolOperations(name: string) {
  const capability = runtimeCapability(name)
  if (!capability) return []
  return capability.operations[name.startsWith(capability.prefix) ? name.slice(capability.prefix.length) : name] ?? []
}
export function capabilityTools(capability: ToolCapability, names: string[]) { return names.map((name) => capabilityToolName(capability, name)) }

export function skillEntryTools(uri: string): string[] {
  if (!/^skill:\/\/[a-z0-9-]+\/.+/u.test(uri)) return []
  if (catalog.skillEntries[uri]) return catalog.skillEntries[uri]
  const exact = runtimeCapabilities.filter((capability) => capability.skill === uri)
  const owner = uri.slice(0, uri.indexOf('/', 'skill://'.length) + 1)
  const capabilities = exact.length ? exact : runtimeCapabilities.filter((capability) => capability.skill.startsWith(owner))
  return [...new Set(capabilities.flatMap((capability) => capabilityTools(capability, exact.length || uri.endsWith('/SKILL.md') ? capability.entry : capability.recovery)))]
}

export function capabilityValue(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, data)
}

export function recoveryNavigation(name: string, errorCode?: string) {
  const capability = runtimeCapability(name)
  const step = runtimeCapabilityStep(name)
  const kind = runtimeFailureKind(errorCode)
  const normal = !errorCode && capability && step
  let names = capability ? capabilityTools(capability, normal ? step.next ?? capability.recovery
    : kind === 'missing' ? capability.missing ?? [] : step?.recovery ?? capability.recovery) : []
  if (!normal && ['blocked', 'unknown', 'invalid'].includes(kind)) names = []
  if (!normal && kind === 'missing') names = names.filter((candidate) => candidate !== name)
  const purpose = capability?.purpose ?? ''
  const guidance = normal ? step.guidance ?? purpose : `${recoveryGuidance[kind]} ${purpose}${errorCode?.toLowerCase().includes('status_unavailable')
    ? ' 原命令已登记，但当前状态未能读取。查询原任务，或以原请求 ID 和相同参数重试；不能更换请求 ID 重新执行。' : ''}`
  return { names, guidance, ...(capability ? { skill: capability.skill } : {}) }
}

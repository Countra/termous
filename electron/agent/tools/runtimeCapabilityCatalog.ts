import catalogData from '../contracts/capabilities.generated.json' with { type: 'json' }
import type { CapabilityCatalog, CapabilityStep, ToolCapability } from '../contracts/toolCapabilities.ts'
import { isRecord } from '../contracts/validation.ts'

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
  const code = errorCode?.toLowerCase() ?? ''
  let names = capability ? capabilityTools(capability, capability.recovery) : []
  let guidance = capability?.purpose ?? '核对用户目标与真实回执，使用 discover_tools 查找准确能力；不以相似操作替代，也不猜测参数或权限。'
  // 错误按语义分类，规则覆盖所有能力；不从错误正文提取并执行工具指令。
  if (/forbidden|unauthorized|permission|denied|host_key|credential|approval_(?:rejected|expired|cancelled)/u.test(code)) {
    names = []
    guidance = '当前权限、信任或审批条件未满足。说明具体阻塞，等待用户处理；不得原样重试、扩大目标或改用其他工具绕过。'
  } else if (/uncertain|ambiguous|deadline|timeout/u.test(code)) {
    guidance = `结果可能不确定，先用已获准的只读入口核查原资源；不能更换请求 ID 或自动重放写操作。${guidance}`
  } else if (/conflict|stale/u.test(code)) {
    guidance = `重新读取原资源及当前版本或连接代次，更新失效的资源绑定或版本前置条件；已登记任务仍使用原任务 ID 查询。不得重用或自动重放未确认的输入，也不能更换请求 ID 绕过结果核验。${guidance}`
  } else if (/status_unavailable/u.test(code)) {
    guidance = `原命令已登记，但当前状态未能读取。查询原任务，或以原请求 ID 和相同参数重试；不能更换请求 ID 重新执行。${guidance}`
  } else if (/unsupported|unavailable|disabled/u.test(code)) {
    guidance = `核查当前资源 capability；能力缺失时说明限制，不用 Shell 或其他领域工具绕过。${guidance}`
  } else if (/invalid|validation|binding_mismatch/u.test(code)) {
    guidance = `调用未满足参数或资源前置条件。按实际工具 schema 和本轮核验绑定补齐查询，原样重试不能修复。${guidance}`
  } else if (!errorCode && capability && step) {
    names = capabilityTools(capability, step.next ?? capability.recovery)
    guidance = step.guidance ?? guidance
  }
  return { names, guidance, ...(capability ? { skill: capability.skill } : {}) }
}

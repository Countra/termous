import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'
import { isRecord } from '../contracts/validation.ts'
import { desktopCleanupGuidance, runtimeDesktopSafetyOutcome } from '../execution/runtimeInputSafety.ts'
import { capabilityTools, capabilityValue, recoveryNavigation, runtimeCapability, runtimeCapabilityStep, runtimeToolOperations } from './runtimeCapabilityCatalog.ts'
import { isFailedToolState, roleGuidance, runtimeToolFailureCode, runtimeToolOutcome } from './runtimeToolOutcome.ts'
import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'
import type { CapabilityTarget } from '../contracts/toolCapabilities.ts'
import { progressData } from './runtimeToolEvidence.ts'
import { runtimeFailureKind } from './runtimeToolRecovery.ts'
import { desktopAttachment, desktopGrantCurrent } from './runtimeDesktopObservation.ts'

export interface ToolNavigation {
  names: string[]
  guidance: string
  skill?: string
  recovery?: boolean
  empty?: boolean
}

function runtimePrerequisiteTools(data: Record<string, unknown>) {
  // 调用方已核验本地准备阶段；所需入口仍必须属于已登记的只读阶段。
  if (typeof data.required_tool !== 'string') return []
  const role = runtimeCapabilityStep(data.required_tool)?.role
  return role && ['inspect', 'list', 'poll'].includes(role) ? [data.required_tool] : []
}

// 导航解释声明式生命周期，只加载候选声明；执行和授权仍由模型选择及 Core 校验。
export function runtimeToolNavigation(name: string, result: AgentToolResult<unknown>,
  bindings: RuntimeResourceBinding[] = [], isError = false,
  preparationCode?: 'AGENT_TOOL_ARGUMENTS_INVALID' | 'AGENT_TOOL_UNAVAILABLE'): ToolNavigation | undefined {
  const response = isMCPToolDetails(result.details) ? result.details.result : undefined
  let data = response ? isRecord(response.structuredContent) ? response.structuredContent : {} : isError ? progressData(result) : {}
  const attachment = name.startsWith('termous.desktops.') ? desktopAttachment(data) : undefined
  // 导航只提示最近确认的有效授权；不修改原始回执或增加执行门禁。
  if (attachment && !desktopGrantCurrent(attachment, Date.now())) {
    const observed = { ...attachment, grant: undefined }
    data = isRecord(data.control) ? { ...data, control: { ...data.control, attachment: observed } } : { ...data, attachment: observed }
  }
  const failed = runtimeToolOutcome(name, data, isError || response?.isError === true) === 'failed'
  const safety = runtimeDesktopSafetyOutcome(name, result, failed)
  if (safety.cleanupUncertain && !safety.inputUncertain) return {
    names: [], guidance: desktopCleanupGuidance, recovery: true,
  }
  const capability = runtimeCapability(name)
  const step = runtimeCapabilityStep(name)
  const local = preparationCode === 'AGENT_TOOL_ARGUMENTS_INVALID' && !response && failed && data.code === 'AGENT_RESOURCE_BINDING_MISMATCH' && data.dispatched === false
  const code = local ? typeof data.cause_code === 'string' ? data.cause_code : 'AGENT_RESOURCE_BINDING_MISMATCH' : preparationCode ?? runtimeToolFailureCode(name, data, failed)
  const kind = code ? runtimeFailureKind(code) : undefined
  const fallback = (): ToolNavigation => {
    const recovery = recoveryNavigation(name, code ?? 'tool_failed')
    return { ...recovery, guidance: `${name}（${runtimeToolOperations(name).join(', ')}）失败。${recovery.guidance}`, recovery: true }
  }
  if (!capability || !step) return failed ? fallback() : undefined
  if (!response && !failed) return undefined
  if (kind === 'blocked' || kind === 'uncertain') return fallback()
  const target: CapabilityTarget = bindings.some((binding) => binding.kind === capability.bindings?.session) ? 'session'
    : bindings.some((binding) => binding.kind === capability.bindings?.profile) ? 'profile' : 'unbound'
  const outcome = runtimeToolOutcome(name, data, failed)
  if (outcome === 'waiting') return { names: capabilityTools(capability, capability.recovery), guidance: '当前任务正在等待审批、外部条件或已暂停；保持原任务身份，按实际状态等待，不重新提交或自动恢复。', skill: capability.skill }
  for (const rule of capability.cases ?? []) {
    if (!capabilityTools(capability, rule.tools).includes(name)) continue
    const value = rule.path ? capabilityValue(data, rule.path) : undefined
    // 状态型失败仍可采用契约中明确匹配该失败态的规则，不能落入 ready 等成功导航。
    const failureState = rule.path && capability.evidence?.states?.includes(rule.path) && rule.values?.includes(String(value)) && isFailedToolState(value)
    if (rule.errors ? !kind || !rule.errors.includes(kind) : failed && !failureState) continue
    if (rule.codes && (!code || !rule.codes.includes(code))) continue
    if (rule.targets && !rule.targets.includes(target)) continue
    if (rule.values && !rule.values.includes(String(value))) continue
    if (rule.exists !== undefined && rule.exists !== (value !== undefined && value !== null)) continue
    if (rule.empty !== undefined && rule.empty !== (Array.isArray(value) ? value.length === 0 : rule.omittedIsEmpty === true && value === undefined && isRecord(response?.structuredContent))) continue
    return { names: capabilityTools(capability, rule.next), guidance: rule.guidance, skill: capability.skill,
      recovery: Boolean(code || rule.empty), empty: rule.empty === true }
  }
  if (local && kind !== 'missing') {
    const prerequisite = runtimePrerequisiteTools(data)
    const recovery = fallback()
    return { ...recovery, names: prerequisite, guidance: `${recovery.guidance} ${prerequisite.length ? '本轮尚缺有效查询回执，请按本地校验返回的 required_arguments 核验目标。' : ''}` }
  }
  if (outcome === 'failed') return fallback()
  if (step.role === 'poll' && outcome !== 'settled') return { names: [], guidance: roleGuidance.poll, skill: capability.skill }
  const names = capabilityTools(capability, step.next ?? [])
  if (step.completion && step.next === undefined && data[step.completion.flag] === true) names.push(...capabilityTools(capability, [step.completion.next]))
  return { names, guidance: step.guidance ?? `${capability.purpose} ${roleGuidance[step.role]}`, skill: capability.skill }
}

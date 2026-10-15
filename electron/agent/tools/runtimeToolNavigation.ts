import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'
import { isRecord } from '../contracts/validation.ts'
import { desktopCleanupGuidance, runtimeDesktopSafetyOutcome } from '../execution/runtimeInputSafety.ts'
import { capabilityTools, capabilityValue, recoveryNavigation, runtimeCapability, runtimeCapabilityStep } from './runtimeCapabilityCatalog.ts'
import { roleGuidance, runtimeToolFailureCode, runtimeToolOutcome } from './runtimeToolOutcome.ts'

export function runtimePrerequisiteTools(result: AgentToolResult<unknown>, data: Record<string, unknown>) {
  // 只接收本地门禁的未派发回执，且仅加载已登记的只读阶段；远端内容不能指定下一步工具。
  if (isMCPToolDetails(result.details) || data.code !== 'AGENT_RESOURCE_BINDING_MISMATCH' || data.dispatched !== false || typeof data.required_tool !== 'string') return []
  const role = runtimeCapabilityStep(data.required_tool)?.role
  return role && ['inspect', 'list', 'poll'].includes(role) ? [data.required_tool] : []
}

// 导航解释声明式生命周期，只加载候选声明；执行和授权仍由模型选择及 Core 校验。
export function runtimeToolNavigation(name: string, result: AgentToolResult<unknown>) {
  if (!isMCPToolDetails(result.details)) return undefined
  const response = result.details.result
  const safety = runtimeDesktopSafetyOutcome(name, result, response.isError === true)
  if (safety.cleanupUncertain && !safety.inputUncertain) return {
    names: [], guidance: desktopCleanupGuidance,
  }
  const capability = runtimeCapability(name)
  const step = runtimeCapabilityStep(name)
  if (!capability || !step) return undefined
  const data = isRecord(response.structuredContent) ? response.structuredContent : {}
  const outcome = runtimeToolOutcome(name, data, response.isError === true)
  if (response.isError || isRecord(data.error)) return recoveryNavigation(name, runtimeToolFailureCode(name, data, true))
  for (const rule of capability.cases ?? []) {
    if (!capabilityTools(capability, rule.tools).includes(name)) continue
    const value = capabilityValue(data, rule.path)
    if (rule.values ? !rule.values.includes(String(value)) : rule.exists !== (value !== undefined && value !== null)) continue
    return { names: capabilityTools(capability, rule.next), guidance: rule.guidance, skill: capability.skill }
  }
  if (outcome === 'failed') return recoveryNavigation(name, runtimeToolFailureCode(name, data))
  if (outcome === 'waiting') return { names: capabilityTools(capability, capability.recovery), guidance: '当前任务正在等待审批、外部条件或已暂停；保持原任务身份，按实际状态等待，不重新提交或自动恢复。', skill: capability.skill }
  if (step.role === 'poll' && outcome !== 'settled') return { names: [], guidance: roleGuidance.poll, skill: capability.skill }
  const names = capabilityTools(capability, step.next ?? [])
  if (step.completion && data[step.completion.flag] === true) names.push(...capabilityTools(capability, [step.completion.next]))
  return { names, guidance: step.guidance ?? `${capability.purpose} ${roleGuidance[step.role]}`, skill: capability.skill }
}

import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { readDesktopBatch } from '#common/desktop-batch'
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
import { executionRecovery } from './recovery/execution.ts'
import { desktopObservationNavigation } from './recovery/desktop.ts'
import { revisionConflictNavigation } from './recovery/revisions.ts'
import type { ToolNavigation } from './recovery/contracts.ts'
export type { ToolNavigation } from './recovery/contracts.ts'

function runtimePrerequisiteTools(data: Record<string, unknown>) {
  // 调用方已核验本地准备阶段；所需入口仍必须属于已登记的只读阶段。
  if (typeof data.required_tool !== 'string') return []
  const role = runtimeCapabilityStep(data.required_tool)?.role
  return role && ['inspect', 'list', 'poll'].includes(role) ? [data.required_tool] : []
}

// 导航解释声明式生命周期，只加载候选声明；执行和授权仍由模型选择及 Core 校验。
export function runtimeToolNavigation(name: string, result: AgentToolResult<unknown>,
  bindings: RuntimeResourceBinding[] = [], isError = false,
  preparationCode?: 'AGENT_TOOL_ARGUMENTS_INVALID' | 'AGENT_TOOL_UNAVAILABLE', args?: unknown): ToolNavigation | undefined {
  const response = isMCPToolDetails(result.details) ? result.details.result : undefined
  let data = response ? isRecord(response.structuredContent) ? response.structuredContent : {} : isError ? progressData(result) : {}
  const attachment = name.startsWith('termous.desktops.') ? desktopAttachment(data) : undefined
  // 导航只提示最近确认的有效授权；不修改原始回执或增加执行门禁。
  if (attachment && !desktopGrantCurrent(attachment, Date.now())) {
    const observed = { ...attachment, grant: undefined }
    data = isRecord(data.control) ? { ...data, control: { ...data.control, attachment: observed } } : { ...data, attachment: observed }
  }
  const outcome = runtimeToolOutcome(name, data, isError || response?.isError === true)
  const failed = outcome === 'failed'
  const safety = runtimeDesktopSafetyOutcome(name, result, failed)
  if (safety.cleanupUncertain && !safety.inputUncertain) return {
    names: [], guidance: desktopCleanupGuidance, recovery: true,
  }
  const structured = response ? executionRecovery(data) : undefined
  const capability = runtimeCapability(name)
  const batch = capability?.id === 'desktop_batch' ? readDesktopBatch(data) : undefined
  // 成功的 none 仅表示无需恢复；未知派发、失败与清理异常仍按原恢复合同处理。
  const settledSuccess = outcome === 'settled' && structured?.kind === 'none' && structured.dispatch === 'dispatched'
    && !safety.inputUncertain && !safety.cleanupUncertain
  const batchObservation = batch && !batch.report_error && !isRecord(data.error) && !safety.inputUncertain && !safety.cleanupUncertain
    && (batch.state === 'running' && !failed && structured?.kind === 'wait'
      || ['stopped', 'cancelled'].includes(batch.state) && structured?.kind === 'reread' && structured.dispatch !== 'unknown')
  if (structured?.dispatch === 'unknown' && !['query_operation', 'user_action', 'approval', 'none', 'wait'].includes(structured.kind)) {
    return { names: [], recovery: true, guidance: `${structured.guidance} Dispatch is uncertain. Query the original operation or ask the user; do not replay the action or create a replacement.` }
  }
  if (structured?.dispatch === 'not_started' && structured.kind === 'reread'
    && structured.tool === 'termous.desktops.attach' && !structured.arguments) {
    // 原目标不明时，attach 的精确名称还不足以形成调用，须同时提供获准的目标发现入口。
    const discovery = desktopObservationNavigation(name, data, bindings)
    if (discovery) return discovery
  }
  if (structured && !settledSuccess && !batchObservation && (structured.tool || !['reread', 'correct_parameters'].includes(structured.kind))) {
    const tool = structured.tool && runtimeCapabilityStep(structured.tool) ? structured.tool : undefined
    const observationOnly = ['termous.desktops.get', 'termous.desktops.capture'].includes(name)
      && structured.dispatch === 'not_started' && structured.kind === 'reread'
      && ['termous.desktops.capture', 'termous.desktops.attach'].includes(tool ?? '')
      && isRecord(data.error) && ['desktop_generation_stale', 'AGENT_OBSERVATION_REQUIRED', 'AGENT_RESOURCE_BINDING_MISMATCH'].includes(String(data.error.code))
    return { names: tool ? [tool] : [], recovery: true, observationOnly, guidance: structured.guidance
      + (structured.dispatch === 'unknown' && structured.kind === 'none' ? ' Dispatch is uncertain; preserve the original operation identity and do not replay input.' : '')
      + (tool ? ` Next tool: ${tool}.` : ''),
      ...(tool && structured.arguments ? { prerequisite: { tool, arguments: structured.arguments } } : {}),
    }
  }
  const desktopRecovery = response ? desktopObservationNavigation(name, data, bindings) : undefined
  if (desktopRecovery) return desktopRecovery
  const revisionRecovery = response && failed && (!structured || structured.dispatch === 'not_started')
    ? revisionConflictNavigation(name, isRecord(data.error) ? data.error.code : undefined, args) : undefined
  if (revisionRecovery) return { ...revisionRecovery, guidance: [isRecord(data.error) && typeof data.error.message === 'string' ? data.error.message : '', revisionRecovery.guidance].filter(Boolean).join(' ') }
  const step = runtimeCapabilityStep(name)
  const local = preparationCode === 'AGENT_TOOL_ARGUMENTS_INVALID' && !response && failed && data.code === 'AGENT_RESOURCE_BINDING_MISMATCH' && data.dispatched === false
  const code = local ? typeof data.cause_code === 'string' ? data.cause_code : 'AGENT_RESOURCE_BINDING_MISMATCH' : preparationCode ?? runtimeToolFailureCode(name, data, failed)
  const kind = code ? runtimeFailureKind(code) : undefined
  const fallback = (): ToolNavigation => {
    const recovery = recoveryNavigation(name, code ?? 'tool_failed')
    return { ...recovery, guidance: `${name}（${runtimeToolOperations(name).join(', ')}）失败。${structured?.guidance ?? recovery.guidance}`, recovery: true }
  }
  if (!capability || !step) return failed ? fallback() : undefined
  if (!response && !failed) return undefined
  if (kind === 'blocked' || kind === 'uncertain') return fallback()
  const target: CapabilityTarget = bindings.some((binding) => binding.kind === capability.bindings?.session) ? 'session'
    : bindings.some((binding) => binding.kind === capability.bindings?.profile) ? 'profile' : 'unbound'
  if (outcome === 'waiting') return { names: capabilityTools(capability, step.recovery ?? capability.recovery), guidance: '当前任务正在等待审批、外部条件或已暂停；保持原任务身份，按实际状态等待，不重新提交或自动恢复。', skill: capability.skill }
  for (const rule of capability.cases ?? []) {
    if (!capabilityTools(capability, rule.tools).includes(name)) continue
    const value = rule.path ? capabilityValue(data, rule.path) : undefined
    // 状态型失败仍可采用契约中明确匹配该失败态的规则，不能落入 ready 等成功导航。
    const failureState = rule.path && capability.evidence?.states?.includes(rule.path) && rule.values?.includes(String(value))
      && (isFailedToolState(value) || batchObservation && ['stopped', 'cancelled'].includes(String(value)))
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
    // 参数准备失败不经过 afterToolCall；把精确查询放在摘要前部，避免只剩工具名或泛化提醒。
    const query = prerequisite.length && isRecord(data.required_arguments)
      ? { tool: prerequisite[0]!, arguments: data.required_arguments } : undefined
    return { ...recovery, names: prerequisite, prerequisite: query, guidance: query
      ? `本次本地校验未通过，尚未派发。建议先实际调用 ${query.tool}，参数 ${JSON.stringify(query.arguments)}，根据新回执补齐前置条件；重复原调用不会完成查询。 ${recovery.guidance}`
      : recovery.guidance }
  }
  if (outcome === 'failed') return fallback()
  if (step.role === 'poll' && outcome !== 'settled') return { names: [], guidance: roleGuidance.poll, skill: capability.skill }
  const names = capabilityTools(capability, step.next ?? [])
  if (step.completion && step.next === undefined && data[step.completion.flag] === true) names.push(...capabilityTools(capability, [step.completion.next]))
  return { names, guidance: step.guidance ?? `${capability.purpose} ${roleGuidance[step.role]}`, skill: capability.skill }
}

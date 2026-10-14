import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails } from './mcpClientAdapter.ts'
import { isRecord } from './protocol.ts'

export interface RuntimeStopReason { code: string; message: string }

const desktopInput = /^termous\.desktops\.(?:pointer\.(?:move|click|scroll|drag)|keyboard\.(?:key|shortcut|text)|clipboard\.set_text|resize)$/u
const workflowResult = /^(?:termous\.desktop_workflows\.runs\.(?:start|get|control)|wait_workflow_run)$/u
const cleanupTools = new Set(['termous.desktops.control.release', 'termous.desktops.detach', 'termous.desktops.control.acquire', 'termous.desktops.close'])
export const desktopCleanupGuidance = '控制清理尚未确认。本轮停止新的桌面接管、输入及脚本运行；可以只读查询状态、截图、查看报告或取消所属运行，然后说明已完成的步骤和清理问题。不要重复释放、重放步骤或声称已安全释放。'

export function runtimeToolOutcome(result: AgentToolResult<unknown>, isError: boolean) {
  const details = isMCPToolDetails(result.details) ? result.details.result : undefined
  let raw: unknown = details?.structuredContent
  if (!raw) for (const part of result.content) {
    if (part.type !== 'text') continue
    try { raw = JSON.parse(part.text.slice(part.text.indexOf('{'))); break } catch { /* 仅结构化结果可用于判断，不解释普通正文。 */ }
  }
  const data = isRecord(raw) ? raw : {}
  const error = isRecord(data.error) ? data.error : data
  const diagnostic = isRecord(error.diagnostic) ? error.diagnostic : undefined
  const code = typeof error.code === 'string' ? error.code : ''
  return { data, code, error: isError || details?.isError === true, reason: typeof diagnostic?.reason === 'string' ? diagnostic.reason : code || 'tool_failed' }
}

export function runtimeDesktopSafetyOutcome(name: string, result: AgentToolResult<unknown>, isError: boolean) {
  const outcome = runtimeToolOutcome(result, isError)
  const operation = isRecord(outcome.data.operation) ? outcome.data.operation : undefined
  const report = isRecord(outcome.data.report) ? outcome.data.report : undefined
  const run = report && isRecord(report.run) ? report.run : isRecord(outcome.data.run) ? outcome.data.run : undefined
  const isWorkflow = workflowResult.test(name)
  const hasCleanupError = isWorkflow && typeof run?.cleanup_error === 'string' && run.cleanup_error !== ''
  // 兼容旧 Core：释放和取得租约都可能把清理失败映射成 input_uncertain，但没有派发新输入。
  const cleanupUncertain = ((name.startsWith('termous.desktops.') || isWorkflow) && outcome.error &&
    (outcome.code === 'desktop_cleanup_uncertain' || cleanupTools.has(name) && outcome.code === 'desktop_input_uncertain')) || hasCleanupError || isWorkflow && run?.error_code === 'desktop_cleanup_uncertain'
  const inputUncertain = (desktopInput.test(name) || name === 'termous.desktops.operations.get') &&
    (outcome.error && outcome.code === 'desktop_input_uncertain' || operation?.state === 'uncertain')
  const uncertainStep = Array.isArray(report?.steps) && report.steps.some((step) => isRecord(step) && step.state === 'uncertain')
  const cleanupOnly = hasCleanupError && !run?.error_code && !uncertainStep
  const workflowUncertain = isWorkflow && (run?.error_code === 'desktop_input_uncertain' || uncertainStep ||
    run?.state === 'uncertain' && !cleanupOnly)
  return { inputUncertain: Boolean(inputUncertain || workflowUncertain), cleanupUncertain: Boolean(cleanupUncertain) }
}

// 输入不确定属于执行保护，与可选预算开关独立；清理未确认只阻止新副作用，允许只读核查与回复。
export class RuntimeInputSafety {
  private stopped?: RuntimeStopReason
  private cleanupPending = false
  failure() { return this.stopped }

  observe(name: string, result: AgentToolResult<unknown>, isError: boolean) {
    const outcome = runtimeDesktopSafetyOutcome(name, result, isError)
    this.cleanupPending ||= outcome.cleanupUncertain
    if (outcome.inputUncertain) {
      this.stopped ??= { code: 'AGENT_RUNTIME_INPUT_UNCERTAIN', message: '已派发操作的结果不确定，停止后续自动操作，不重放输入。请检查远端状态；所属运行和控制将按生命周期清理。' }
    }
  }

  blockedTool(name: string, args: unknown): string | undefined {
    if (!this.cleanupPending) return undefined
    const desktopMutation = name.startsWith('termous.desktops.') && !/^termous\.desktops\.(?:list|get|capture|operations\.get|profiles\.(?:list|get))$/u.test(name)
    const workflowMutation = name === 'termous.desktop_workflows.runs.start' || name === 'termous.desktop_workflows.runs.control' && (!isRecord(args) || args.action !== 'cancel')
    return desktopMutation || workflowMutation ? desktopCleanupGuidance : undefined
  }
}

import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import catalogData from './capabilities.generated.json' with { type: 'json' }
import type { CapabilityCatalog } from './toolCapabilities.ts'
import { isMCPToolDetails } from './mcpTools.ts'
import { isRecord } from './validation.ts'

const defaultApprovalPaths = ['approval', 'report.approval']
const approvalPaths = new Map((catalogData as CapabilityCatalog).capabilities.flatMap((capability) =>
  capability.steps.flatMap((step) => step.tools.map((tool) => [
    tool.startsWith('termous.') || tool === 'wait_workflow_run' ? tool : capability.prefix + tool,
    capability.evidence?.approvals ?? defaultApprovalPaths,
  ] as const))))

// 合同层只解释声明的字段路径，供执行保护与工具导航共同使用，不参与候选加载或调用决策。
export function runtimeToolApprovals(name: string, data: Record<string, unknown>) {
  return (approvalPaths.get(name) ?? defaultApprovalPaths).map((path) =>
    path.split('.').reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, data)).filter(isRecord)
}

export function runtimeApprovalFailure(name: string, data: Record<string, unknown>) {
  for (const approval of runtimeToolApprovals(name, data)) {
    if (['rejected', 'expired', 'cancelled'].includes(String(approval.state))) return `approval_${String(approval.state)}`
    if (approval.state === 'dispatch_conflict') return typeof approval.error_code === 'string' && approval.error_code
      ? approval.error_code.slice(0, 128) : 'approval_dispatch_conflict'
  }
  return undefined
}

export function runtimeToolResultData(result: AgentToolResult<unknown>): Record<string, unknown> {
  if (isMCPToolDetails(result.details) && isRecord(result.details.result.structuredContent)) return result.details.result.structuredContent
  // 历史只持久化内容块，仅读取 JSON 结构，不将普通正文作为执行指令。
  for (const part of result.content) {
    if (part.type !== 'text') continue
    const start = part.text.indexOf('{')
    if (start < 0) continue
    try {
      const value: unknown = JSON.parse(part.text.slice(start))
      if (isRecord(value)) return typeof value.screenshot_id === 'string' ? { capture: value } : value
    } catch { /* 非结构化输出不恢复资源身份。 */ }
  }
  return {}
}

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { toolDescription, withToolDescription } from '../../contracts/toolDescriptions.ts'
import type { ToolCapability } from '../../contracts/toolCapabilities.ts'
import { runtimeCapabilityStep, runtimeToolOperations } from '../runtimeCapabilityCatalog.ts'

export function describeCapabilityTool(tool: AgentTool, original: string, capability?: ToolCapability): AgentTool {
  if (!capability) return tool
  const { base, mode } = toolDescription(tool)
  const step = runtimeCapabilityStep(original)
  const parts = [base]
  // 受管参数说明已由适配器生成；不能再次加入外部 MCP 的手动身份和授权字段要求。
  if (mode === 'managed') {
    if ((step?.role === 'input' || step?.evidence === 'image') && step.guidance) parts.push(`Next action: ${step.guidance}`)
    parts.push(`Reference: ${capability.skill}`)
  } else if (mode === 'raw') {
    parts.push(`职责：${capability.purpose}`, `说明：${capability.skill}`, `动作：${runtimeToolOperations(original).join(', ')}`)
    if (step?.preparation) parts.push(`调用前：${step.preparation}`)
    if (step?.guidance) parts.push(`后续：${step.guidance}`)
  }
  // 选择依据按能力在请求指引和发现结果中提供，不在每个工具声明里重复整段说明。
  return withToolDescription({ ...tool, description: parts.join('\n') }, base, mode)
}

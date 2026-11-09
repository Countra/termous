import type { AgentTool } from '@earendil-works/pi-agent-core'

interface ToolDescription { base: string; mode: 'raw' | 'core' | 'managed' }
const descriptionKey = Symbol('runtime-tool-description')
type DescribedTool = AgentTool & { [descriptionKey]?: ToolDescription }

// 本地元数据随工具包装保留，防止目录刷新重复拼接，也不根据外部正文判断适配模式。
export function withToolDescription(tool: AgentTool, base: string, mode: ToolDescription['mode'] = 'raw'): AgentTool {
  return Object.assign(tool, { [descriptionKey]: Object.freeze({ base, mode }) })
}

export function toolDescription(tool: AgentTool): ToolDescription {
  return (tool as DescribedTool)[descriptionKey] ?? { base: tool.description, mode: 'raw' }
}

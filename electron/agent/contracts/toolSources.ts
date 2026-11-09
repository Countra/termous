import { createHash } from 'node:crypto'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentMCPConnection } from './mcpTools.ts'

export interface ToolSource { readonly id: string; readonly kind: 'termous' | 'local' | 'mcp' | 'skill' }
export interface ToolIdentity { readonly source: ToolSource; readonly originalName: string; readonly directoryVersion?: string }
export const termousToolSource: ToolSource = Object.freeze({ id: 'termous', kind: 'termous' })
export const localToolSource: ToolSource = Object.freeze({ id: 'local', kind: 'local' })
export const unclassifiedToolSource: ToolSource = Object.freeze({ id: 'unclassified', kind: 'mcp' })
const identityKey = Symbol('runtime-tool-identity')
type IdentifiedTool = AgentTool & { [identityKey]?: ToolIdentity }

export function externalToolSource(id: string, kind: 'mcp' | 'skill' = 'mcp'): ToolSource {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id) || ['termous', 'local', 'unclassified'].includes(id)) throw new Error('AGENT_TOOL_SOURCE_INVALID')
  return Object.freeze({ id, kind })
}

export function identifyTool(tool: AgentTool, source: ToolSource, originalName = tool.name, directoryVersion?: string): AgentTool {
  // 身份由本地适配器赋予；Symbol 不可能来自 MCP JSON，工具包装时可随展开保留。
  // 目录版本仅用于发现快照失效，不改变来源名称、历史归属或审批权限。
  return Object.assign(tool, { [identityKey]: Object.freeze({ source, originalName, ...(directoryVersion === undefined ? {} : { directoryVersion }) }) })
}

export function toolIdentity(tool: AgentTool): ToolIdentity | undefined { return (tool as IdentifiedTool)[identityKey] }
export function builtinTool(tool: AgentTool) { return toolIdentity(tool)?.source === termousToolSource }
export function trustedTool(tool: AgentTool) {
  const source = toolIdentity(tool)?.source
  return source === termousToolSource || source === localToolSource
}

export function externalToolName(source: ToolSource, originalName: string) {
  const digest = createHash('sha256').update(JSON.stringify([source.id, originalName])).digest('hex').slice(0, 32)
  const hint = originalName.replace(/[^a-zA-Z0-9_]/gu, '_').slice(0, 24)
  return `x_${hint}_${digest}`
}

export function scopedToolName(tool: AgentTool, fallback = tool.name) {
  const identity = toolIdentity(tool)
  return identity ? trustedTool(tool) ? identity.originalName : `${identity.source.id}::${identity.originalName}` : fallback
}

export function builtinName(mcp: AgentMCPConnection, name: string): string | null {
  const tool = mcp.tools.find((entry) => entry.name === name)
  return tool && builtinTool(tool) ? toolIdentity(tool)!.originalName : null
}

export function isolateToolNames(mcp: AgentMCPConnection): AgentMCPConnection {
  const names = new Map(mcp.tools.map((tool) => [tool.name, scopedToolName(tool, `unclassified::${tool.name}`)]))
  return { ...mcp, originalName: (name) => names.get(name) ?? null,
    ...(mcp.refreshTools ? {refreshTools:async (signal?:AbortSignal)=>{
      const change=await mcp.refreshTools!(signal)
      if (change) {
        for (const name of change.removed) names.delete(name)
        for (const tool of change.tools) names.set(tool.name,scopedToolName(tool,`unclassified::${tool.name}`))
      }
      return change
    }} : {}),
  }
}

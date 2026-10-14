import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { CallToolResult } from '@modelcontextprotocol/client'

const visualDesktopTools = new Set([
  'termous.desktops.capture',
  'termous.desktop_workflows.captures.create',
  'termous.desktop_workflows.captures.view',
  'termous.desktop_workflows.templates.preview',
  'termous.desktop_workflows.templates.get',
  'termous.desktop_workflows.templates.match',
  'termous.desktop_workflows.templates.confirm',
  'termous.desktop_workflows.assets.get',
])

export function requiresDesktopImages(name: string | null): boolean {
  return name !== null && visualDesktopTools.has(name)
}

export interface MCPToolDetails {
  kind: 'mcp'
  originalToolName: string
  result: CallToolResult
  readOnly?: boolean
}

export interface AgentMCPConnection {
  tools: AgentTool[]
  originalName(encodedName: string): string | null
  close(): Promise<void>
}

export function isMCPToolDetails(value: unknown): value is MCPToolDetails {
  return typeof value === 'object'
    && value !== null
    && (value as { kind?: unknown }).kind === 'mcp'
    && typeof (value as { originalToolName?: unknown }).originalToolName === 'string'
    && typeof (value as { result?: unknown }).result === 'object'
    && (value as { result?: unknown }).result !== null
}

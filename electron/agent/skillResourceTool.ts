import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import {
  readSkillResourceToolName,
  type AgentSkillBundleSnapshot,
} from './skillBundle.ts'

export interface SkillResourceToolDetails {
  kind: 'skill_resource'
  uri: string
  sha256: string
  size: number
}

export function createSkillResourceTool(snapshot: AgentSkillBundleSnapshot, isPresent?: (content: string) => boolean, onRead?: (content: string) => unknown): AgentTool {
  const resources = new Map(snapshot.resources.map((resource) => [resource.uri, resource]))
  return {
    name: readSkillResourceToolName,
    label: '读取 Skill 资源',
    description: '按 skill:// 地址读取当前 Run 快照内的文档；读取不执行业务操作。读完按说明使用实际工具，未加载的操作用 discover_tools 搜索，不要重复读文档代替执行。',
    parameters: Type.Object({
      refresh: Type.Optional(Type.Boolean({ description: '显式重读全文；默认避免重复返回仍在上下文中的正文' })),
      uri: Type.String({
        description: 'Skill Catalog 中提供的完整 skill:// 资源地址',
        minLength: 1,
        maxLength: 512,
      }),
    }, { additionalProperties: false }),
    executionMode: 'sequential',
    execute: async (_toolCallID, parameters) => {
      const uri = (parameters as { uri?: unknown }).uri
      if (typeof uri !== 'string') {
        throw new Error('AGENT_SKILL_RESOURCE_URI_INVALID')
      }
      // 旧会话可能再次引用更名前的资源，只在同一 Run 快照中查找其固定新地址。
      const resource = resources.get(uri) ?? (uri.startsWith('skill://termous-sftp/')
        ? resources.get(`skill://termous-files/${uri.slice('skill://termous-sftp/'.length)}`)
        : undefined)
      if (!resource) {
        throw new Error('AGENT_SKILL_RESOURCE_NOT_FOUND')
      }
      const available = onRead?.(resource.content)
      return {
        content: [
          { type: 'text', text: (parameters as { refresh?: boolean }).refresh !== true && isPresent?.(resource.content) ? `该资源全文仍在当前上下文中：${resource.uri}。请执行文档中的下一步业务操作；缺少准确工具时调用 discover_tools。refresh 只重读相同文档，不会执行或恢复任务。` : resource.content },
          ...(available ? [{ type: 'text' as const, text: JSON.stringify({ tool_navigation: { available_next_turn: available, guidance: '这些已授权工具将在下一轮可用；请按实际目标执行，读取 Skill 本身不会完成操作。' } }) }] : []),
        ],
        details: {
          kind: 'skill_resource',
          uri: resource.uri,
          sha256: resource.sha256,
          size: resource.size,
        } satisfies SkillResourceToolDetails,
      } satisfies AgentToolResult<SkillResourceToolDetails>
    },
  }
}

export function isSkillResourceToolDetails(value: unknown): value is SkillResourceToolDetails {
  return typeof value === 'object'
    && value !== null
    && (value as { kind?: unknown }).kind === 'skill_resource'
    && typeof (value as { uri?: unknown }).uri === 'string'
    && typeof (value as { sha256?: unknown }).sha256 === 'string'
    && typeof (value as { size?: unknown }).size === 'number'
}

export function skillCatalogPrompt(snapshot: AgentSkillBundleSnapshot) {
  const catalog = snapshot.catalog
    .map((skill) => `- ${skill.name}: ${skill.description.slice(0, 100)}（${skill.entry_uri}）`)
    .join('\n')
  return [
    '可用 Skill Catalog：',
    catalog,
    `需要完整流程时，调用 ${readSkillResourceToolName} 按需读取对应 skill:// 资源。`,
    '不得猜测未读取的 Skill 内容，也不得向用户暴露本地文件路径。',
  ].join('\n')
}

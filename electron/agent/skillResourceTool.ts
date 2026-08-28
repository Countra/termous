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

export function createSkillResourceTool(snapshot: AgentSkillBundleSnapshot): AgentTool {
  const resources = new Map(snapshot.resources.map((resource) => [resource.uri, resource]))
  return {
    name: readSkillResourceToolName,
    label: '读取 Skill 资源',
    description: '按 skill:// 地址读取当前 Run 快照内的 Skill 文档。',
    parameters: Type.Object({
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
      const resource = resources.get(uri)
      if (!resource) {
        throw new Error('AGENT_SKILL_RESOURCE_NOT_FOUND')
      }
      return {
        content: [{ type: 'text', text: resource.content }],
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
    .map((skill) => `- ${skill.name}: ${skill.description}（${skill.entry_uri}）`)
    .join('\n')
  return [
    '可用 Skill Catalog：',
    catalog,
    `需要完整流程时，调用 ${readSkillResourceToolName} 按需读取对应 skill:// 资源。`,
    '不得猜测未读取的 Skill 内容，也不得向用户暴露本地文件路径。',
  ].join('\n')
}

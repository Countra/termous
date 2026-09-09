import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { canonicalizeMcpFileToolName } from '#common/contracts'
import { readSkillResourceToolName } from './skillBundle.ts'
import { decodeMCPToolName, encodeMCPToolName } from './toolNameCodec.ts'

export function runtimeToolName(name: string) {
  if (name === readSkillResourceToolName) return name
  return encodeMCPToolName(canonicalizeMcpFileToolName(decodeMCPToolName(name) ?? name))
}

// 快照已保存 pi 原生名称；只投影已知更名，不改写原始记录、工具参数或结果正文。
export function projectRuntimeToolHistory(message: AgentMessage): AgentMessage {
  if (message.role === 'toolResult') {
    const toolName = projectCheckpointToolName(message.toolName)
    return toolName === message.toolName ? message : { ...message, toolName }
  }
  if (message.role !== 'assistant') return message
  let changed = false
  const content = message.content.map((part) => {
    if (part.type !== 'toolCall') return part
    const name = projectCheckpointToolName(part.name)
    if (name === part.name) return part
    changed = true
    return { ...part, name }
  })
  return changed ? { ...message, content } : message
}

function projectCheckpointToolName(name: string) {
  const original = decodeMCPToolName(name) ?? name
  const canonical = canonicalizeMcpFileToolName(original)
  return canonical === original ? name : encodeMCPToolName(canonical)
}

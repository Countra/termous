import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { RuntimeCompactionPreparation } from './runtimeCompactionTypes.ts'
import { RuntimeCompactionError, type createRuntimeCompactionRequest } from './runtimeCompactionSummary.ts'

const summaryFormat = [
  '只生成用于继续任务的摘要，不继续执行原任务。',
  '按以下结构整理：## Goal、## Constraints、## Progress、## Decisions、## Next Steps、## Critical Context。',
  '若提供旧摘要，应保留仍有效的信息，将新增进展合并并清除已被明确替代的信息。',
].join('\n')

const turnFormat = [
  '这是单次长任务的早期内容，后续消息会完整保留。只总结早期内容，不继续执行任务。',
  '按以下结构整理：## Original Request、## Early Progress、## Context for Suffix。',
].join('\n')

export async function generateRuntimeCompaction(
  preparation: RuntimeCompactionPreparation,
  request: ReturnType<typeof createRuntimeCompactionRequest>['complete'],
  model: Model<Api>,
  thinkingLevel?: ThinkingLevel,
  signal?: AbortSignal,
): Promise<string> {
  const summarize = async (messages: AgentMessage[], turn: boolean, previousSummary?: string) => {
    const maxTokens = Math.min(Math.floor(preparation.settings.reserveTokens * (turn ? 0.5 : 0.8)), model.maxTokens)
    if (maxTokens < 1) throw new RuntimeCompactionError('AGENT_RUNTIME_CONTEXT_COMPRESSION_UNAVAILABLE')
    const text = [
      '<conversation>', serializeRuntimeConversation(messages), '</conversation>',
      ...(previousSummary ? ['<previous-summary>', previousSummary, '</previous-summary>'] : []),
      turn ? turnFormat : summaryFormat,
    ].join('\n\n')
    const result = await request(model, {
      messages: [{ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() }],
    }, {
      maxTokens, signal, cacheRetention: 'none',
      ...(model.reasoning && thinkingLevel && thinkingLevel !== 'off' ? { reasoning: thinkingLevel } : {}),
    })
    return result.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
  }
  if (preparation.turnPrefixMessages.length === 0) {
    return summarize(preparation.messagesToSummarize, false, preparation.previousSummary)
  }
  // 旧摘要必须独立参与更新，不能因本轮只有待保留的长任务而丢失已有约束。
  const history = preparation.messagesToSummarize.length > 0 || preparation.previousSummary
    ? await summarize(preparation.messagesToSummarize, false, preparation.previousSummary)
    : ''
  const turn = await summarize(preparation.turnPrefixMessages, true)
  return history ? `${history}\n\n---\n\n${turn}` : turn
}

export function serializeRuntimeConversation(messages: AgentMessage[]): string {
  const output: string[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    const text = typeof message.content === 'string' ? message.content
      : message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
    if (message.role === 'toolResult') {
      const body = text.length <= 2000 ? text : `${text.slice(0, 2000)}\n[... ${text.length - 2000} more characters truncated]`
      output.push(`[Tool result ${message.toolName} (${message.toolCallId}), ${message.isError ? 'error' : 'success'}]: ${body}`)
    } else if (text) output.push(`[${message.role}]: ${text}`)
    if (Array.isArray(message.content) && message.content.some((block) => block.type === 'image')) {
      output.push('[图片正文省略；原始图片仍在消息记录中]')
    }
    if (message.role === 'assistant') {
      // 与新版 pi 一致，摘要不重复发送思考正文；工具调用和可见回复仍参与摘要。
      for (const block of message.content) {
        if (block.type === 'toolCall') output.push(`[Tool call ${block.name} (${block.id})]: ${JSON.stringify(block.arguments)}`)
      }
    }
  }
  return output.join('\n\n')
}

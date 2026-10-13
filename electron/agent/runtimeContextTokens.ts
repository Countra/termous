import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate'

export { estimateMessageTokens as estimateRuntimeMessageTokens }

// 消息估算与 Provider 保持一致；用量有效性由调用方按模型身份和 checkpoint 边界确定。
// 恢复后的摘要时间是本地重建时间，不能按时间戳否定已验证的历史用量。
export function estimateRuntimeContextTokens(messages: AgentMessage[]) {
  let trailingTokens = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role === 'assistant' && message.stopReason !== 'error' && message.stopReason !== 'aborted') {
      const usage = message.usage
      const usageTokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite
      if (Number.isSafeInteger(usageTokens) && usageTokens > 0) {
        return { tokens: usageTokens + trailingTokens, usageTokens, trailingTokens, lastUsageIndex: index }
      }
    }
    trailingTokens += estimateMessageTokens(message)
  }
  return { tokens: trailingTokens, usageTokens: 0, trailingTokens, lastUsageIndex: null }
}

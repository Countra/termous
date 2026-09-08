import type { TerminalAICompletionRequest, TerminalAICompletionResult } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'

export function terminalAiCompletionAvailable() {
  return Boolean(getTermousBridge()?.terminalAICompletion)
}

export async function generateTerminalAiCompletion(
  request: TerminalAICompletionRequest,
): Promise<TerminalAICompletionResult> {
  const bridge = getTermousBridge()?.terminalAICompletion
  if (!bridge) return { ...request, status: 'failed', code: 'AI_COMPLETION_DESKTOP_REQUIRED', message: '' }
  return bridge.generate(request)
}

export async function cancelTerminalAiCompletion(sessionId: string, requestId: string) {
  const bridge = getTermousBridge()?.terminalAICompletion
  if (bridge) await bridge.cancel({ requestId, sessionId })
}

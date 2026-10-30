import type { AgentIntegrationSource } from '#entities/agent-integrations'
import type { TermousBridge } from '#common/contracts'
import type { IntegrationDiagnostic } from '#common/contracts'

export class IntegrationOperationError extends Error {
  constructor(readonly diagnostic: IntegrationDiagnostic) { super(diagnostic.message) }
}

export async function invokeIntegration(native: NonNullable<TermousBridge['agentIntegrations']>, source: AgentIntegrationSource,
  operation: 'test' | 'reconnect' | 'login', signal: AbortSignal, candidate?: string) {
  const requestID = crypto.randomUUID()
  let cancellation: Promise<void> | undefined
  let stop: (() => void) | undefined
  try {
    signal.throwIfAborted()
    const interrupted = new Promise<never>((_, reject) => {
      stop = () => {
        cancellation = native.cancel(requestID)
        void cancellation.catch(() => undefined)
        reject(signal.reason)
      }
      signal.addEventListener('abort', stop, { once: true })
    })
    const result = await Promise.race([native[operation]({ source: source.id, revision: source.revision, request_id: requestID, candidate_id: candidate }), interrupted])
    if ('failure' in result) throw new IntegrationOperationError(result.failure)
    return result
  } finally {
    if (stop) signal.removeEventListener('abort', stop)
    // 取消控制请求的失败必须返回调用方，不能把发送失败显示为已经停止。
    if (cancellation) await cancellation
  }
}

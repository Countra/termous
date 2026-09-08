import type { TerminalAICompletionRequest } from '#common/contracts'
import type { CoreRuntimeConfig } from '../coreProcess.ts'
import { AgentCoreRuntimeError, validateCoreBaseURL, type AgentSupervisorLease } from '../agent/coreRuntimeClient.ts'
import { isRecord } from '../agent/protocol.ts'
import { isTerminalCompletionBootstrap } from './protocol.ts'

interface TerminalCompletionCoreOptions {
  getConfig(): Promise<CoreRuntimeConfig>
  getLease(): AgentSupervisorLease
  fetch?: typeof globalThis.fetch
}

export class TerminalCompletionCoreClient {
  private readonly options: TerminalCompletionCoreOptions

  constructor(options: TerminalCompletionCoreOptions) { this.options = options }

  async bootstrap(request: TerminalAICompletionRequest, signal: AbortSignal) {
    const config = await this.options.getConfig()
    if (signal.aborted) throw new Error('TERMINAL_AI_CANCELLED')
    const lease = this.options.getLease()
    const snapshot = request.inputSnapshot
    const response = await (this.options.fetch ?? globalThis.fetch)(new URL(
      `/api/v1/sessions/${encodeURIComponent(request.sessionId)}/completions/ai/bootstrap`, validateCoreBaseURL(config.apiBaseUrl),
    ), {
      method: 'POST', signal, redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(config.apiToken ? { 'X-Termous-Token': config.apiToken } : {}) },
      body: JSON.stringify({
        supervisor_instance_id: lease.supervisor_instance_id, request_id: request.requestId, prompt: request.prompt,
        input_snapshot: {
          source_generation: snapshot.sourceGeneration, shell_id: snapshot.shellId,
          prompt_generation: snapshot.promptGeneration, input_epoch: snapshot.inputEpoch,
          line: snapshot.line, cursor_utf16: snapshot.cursorUtf16, revision: snapshot.revision,
        },
      }),
    })
    if (!response.ok) {
      let value: unknown
      try { value = await readBootstrapJSON(response) } catch { /* 错误页可能不是 JSON，只返回稳定分类。 */ }
      const nested = isRecord(value) && isRecord(value.error) ? value.error : value
      const code = isRecord(nested) && typeof nested.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(nested.code)
        ? nested.code : 'TERMINAL_AI_BOOTSTRAP_FAILED'
      throw new AgentCoreRuntimeError(code, response.status)
    }
    const value: unknown = await readBootstrapJSON(response)
    if (!isTerminalCompletionBootstrap(value, request.requestId)) throw new Error('TERMINAL_AI_BOOTSTRAP_INVALID')
    return value
  }
}

// 模型配置与环境快照很小；异常 Core 响应不得无限累积包含凭据的正文。
async function readBootstrapJSON(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('TERMINAL_AI_BOOTSTRAP_INVALID')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > 128 * 1024) throw new Error('TERMINAL_AI_BOOTSTRAP_INVALID')
      chunks.push(chunk.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    try { await reader.cancel() } finally { reader.releaseLock() }
  }
}

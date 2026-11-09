import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'
import { isRecord } from '../contracts/validation.ts'

export function screenAnalysis(result: AgentToolResult<unknown>) {
  const raw = isMCPToolDetails(result.details) ? result.details.result : undefined
  const body = raw?.structuredContent
  return !raw?.isError && isRecord(body) && isRecord(body.data) && isRecord(body.data.analysis) ? body.data.analysis : undefined
}

// 等待只消耗本地时间；取消这次读取不会取消已经取得截图的后台任务。
export function createAnalysisWaitTool(tools: AgentTool[], originalName: (name: string) => string | null): AgentTool[] {
  const get = tools.find((tool) => originalName(tool.name) === 'termous.screen_analyses.get')
  if (!get) return []
  return [{
    name: 'wait_screen_analysis', label: '等待画面分析', executionMode: 'sequential',
    description: '等待已有 analysis_id，最多 60 秒；中间状态仅更新界面。返回终态或当前状态，不下载完整结果。超时不表示分析失败，也不要重新提交。',
    parameters: Type.Object({ analysis_id: Type.String({ minLength: 1 }), timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })) }, { additionalProperties: false }),
    execute: async (id, input, signal, update) => {
      const args = input as { analysis_id: string; timeout_seconds?: number }
      const deadline = Date.now() + (args.timeout_seconds ?? 60) * 1000
      let latest: AgentToolResult<unknown> | undefined
      for (;;) {
        signal?.throwIfAborted()
        const waitMS = Math.min(10_000, Math.max(0, deadline - Date.now() - 100))
        const bounded = AbortSignal.any([AbortSignal.timeout(Math.max(1, deadline - Date.now())), ...(signal ? [signal] : [])])
        let result: AgentToolResult<unknown>
        try {
          result = await get.execute(id, { analysis_id: args.analysis_id, response_detail: 'summary', wait_ms: waitMS }, bounded)
        } catch {
          signal?.throwIfAborted()
          if (Date.now() >= deadline && latest) return latest
          const body = { analysis_id: args.analysis_id, error: { code: 'AGENT_ANALYSIS_STATUS_UNAVAILABLE', message: '等待结束但未能确认最新状态；任务可能仍在运行，请读取同一 analysis_id，不要重复创建。' } }
          const content = [{ type: 'text' as const, text: JSON.stringify(body) }]
          return { content, details: { kind: 'mcp', originalToolName: 'termous.screen_analyses.get', readOnly: true, result: { isError: true, content, structuredContent: body } } }
        }
        const analysis = screenAnalysis(result)
        latest = result
        if (!analysis || typeof analysis.state !== 'string' || !['preparing', 'queued', 'running', 'cancelling'].includes(analysis.state) || Date.now() >= deadline) return result
        update?.({ content: [{ type: 'text', text: `画面分析状态：${analysis.state}` }], details: { kind: 'analysis_wait', analysis_id: args.analysis_id, state: analysis.state } })
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(done, Math.min(250, Math.max(0, deadline - Date.now())))
          function done() { signal?.removeEventListener('abort', abort); resolve() }
          function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason) }
          signal?.addEventListener('abort', abort, { once: true })
          if (signal?.aborted) abort()
        })
      }
    },
  }]
}

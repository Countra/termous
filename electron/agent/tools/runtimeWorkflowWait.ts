import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'
import { isRecord } from '../contracts/validation.ts'

// Core 负责审批到期和准备期限；本地等待不使用模型轮次或窗口可见性作为取消依据。
export function workflowRun(result: AgentToolResult<unknown>) {
  const raw = isMCPToolDetails(result.details) ? result.details.result : undefined
  const body = raw?.structuredContent
  const report = isRecord(body) && isRecord(body.report) ? body.report : body
  return !raw?.isError && isRecord(report) && isRecord(report.run) ? report.run : undefined
}

export function bindWorkflowPreparation(tools: AgentTool[], originalName: (name: string) => string | null): AgentTool[] {
  const get = tools.find((tool) => originalName(tool.name) === 'termous.desktop_workflows.runs.get')
  if (!get) return tools
  return tools.map((tool) => originalName(tool.name) !== 'termous.desktop_workflows.runs.start' ? tool : {
    ...tool,
    description: `${tool.description} 内置助手会等待准备及人工审批结束后返回；等待期间不要重复启动。`,
    execute: async (id, input, signal, update) => {
      const started = await tool.execute(id, input, signal, update)
      const run = workflowRun(started)
      if (!run || typeof run.id !== 'string' || run.state !== 'preparing') return started
      const latest = await waitForWorkflow(get, id, run.id, 'preparation', signal, update)
      const current = workflowRun(latest)
      if (!current || !isMCPToolDetails(started.details)) return {
        ...latest, content: [...latest.content, { type: 'text', text: `运行 ${run.id} 已登记，但未能确认准备结果。不要重复启动；查询同一 run_id。` }],
      }
      const original = started.details.result.structuredContent
      const latestBody = isMCPToolDetails(latest.details) ? latest.details.result.structuredContent : undefined
      const body = { ...(isRecord(original) ? original : {}), ...(isRecord(latestBody) ? latestBody : {}), run: current }
      return { content: [{ type: 'text', text: JSON.stringify(body) }], details: {
        ...started.details, result: { ...started.details.result, structuredContent: body, content: [{ type: 'text', text: JSON.stringify(body) }] },
      } }
    },
  })
}

export function createWorkflowWaitTool(tools: AgentTool[], originalName: (name: string) => string | null): AgentTool[] {
  const get = tools.find((tool) => originalName(tool.name) === 'termous.desktop_workflows.runs.get')
  if (!get) return []
  return [{
    name: 'wait_workflow_run', label: '等待桌面脚本', executionMode: 'sequential',
    description: '等待桌面脚本，普通运行最多等待 60 秒。人工审批和连接确认期间持续等待 Core 决定，不消耗模型请求；用户可随时停止。终态或暂停时返回；普通等待超时不代表失败。',
    parameters: Type.Object({ run_id: Type.String({ minLength: 1 }), timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })) }, { additionalProperties: false }),
    execute: async (id, input, signal, update) => {
      const args = input as { run_id: string; timeout_seconds?: number }
      return waitForWorkflow(get, id, args.run_id, args.timeout_seconds ?? 60, signal, update)
    },
  }]
}

async function waitForWorkflow(get: AgentTool, id: string, runID: string, mode: number | 'preparation', signal?: AbortSignal, update?: Parameters<AgentTool['execute']>[3]) {
  const deadline = Date.now() + (typeof mode === 'number' ? mode * 1000 : 0)
  let revision = 0
  let preparing = mode === 'preparation'
  for (;;) {
    signal?.throwIfAborted()
    // 单次读取仍有界；准备和审批期限由 Core 的运行状态裁定。
    const waitMS = preparing ? 10_000 : Math.min(10_000, Math.max(1, deadline - Date.now()))
    const bounded = AbortSignal.any([AbortSignal.timeout(waitMS + 5_000), ...(signal ? [signal] : [])])
    let result: AgentToolResult<unknown>
    try {
      result = await get.execute(id, { run_id: runID, after_revision: revision, wait_ms: waitMS }, bounded)
    } catch {
      signal?.throwIfAborted()
      // 启动已经登记，查询故障不能伪装成启动失败，也不能回传可能含凭据的网络异常。
      const body = { run_id: runID, error: { code: 'AGENT_WORKFLOW_STATUS_UNAVAILABLE', message: '未能确认已登记运行的状态；不要重复启动，请查询同一 run_id。' } }
      const content = [{ type: 'text' as const, text: JSON.stringify(body) }]
      return { content, details: { kind: 'mcp', originalToolName: 'termous.desktop_workflows.runs.get', readOnly: true, result: { isError: true, content, structuredContent: body } } }
    }
    const run = workflowRun(result)
    if (!run || typeof run.state !== 'string' || typeof run.revision !== 'number') return result
    preparing = run.state === 'preparing' || ['waiting_approval', 'waiting_user_action'].includes(String(run.phase))
    if (!['preparing', 'running', 'queued'].includes(run.state) || !preparing && (mode === 'preparation' || Date.now() >= deadline)) return result
    revision = run.revision
    update?.({ content: [{ type: 'text', text: `脚本运行状态：${run.state} / ${String(run.phase ?? '')}` }], details: { kind: 'workflow_wait', run_id: runID, state: run.state, phase: run.phase } })
    // 同一修订的静止画面或待审批状态不是无进展错误，也不能形成忙循环。
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, 500)
      function done() { signal?.removeEventListener('abort', abort); resolve() }
      function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason) }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }
}

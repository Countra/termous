import { useEffect, useMemo, useState } from 'react'
import type { AgentWorkspaceGateway } from '#features/agent-runtime'
import { isAgentRunActive, type AgentRun } from '#entities/agent'
import type { AgentWorkspaceMessage } from '#widgets/agent-workspace'
import { readDesktopBatch, type DesktopTaskView } from '#common/desktop-batch'

// 展示观察不控制 Worker 调度；界面关闭或切换不会取消实际输入。
export function useAgentDesktopTasks(gateway: AgentWorkspaceGateway, run: AgentRun | undefined, messages: AgentWorkspaceMessage[], enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ runID: string; generation: number; tasks: DesktopTaskView[] }>({ runID: '', generation: 0, tasks: [] })
  const [unavailable, setUnavailable] = useState(false)
  const runID = run?.id
  const generation = run?.generation
  const messageID = run?.assistant_message_id
  const running = Boolean(run && isAgentRunActive(run.status))
  useEffect(() => {
    if (!enabled || !runID || !generation || !gateway.desktopTasks) return
    const abort = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    let cursor = ''
    const observe = async () => {
      try {
        const value = await gateway.desktopTasks!(runID, generation, cursor, cursor ? 10000 : 0, abort.signal)
        if (abort.signal.aborted) return
        cursor = value.cursor
        setUnavailable(false)
        setSnapshot(previous => {
          const versions = new Map(previous.runID === runID && previous.generation === generation ? previous.tasks.map(task => [task.tool_call_id, task]) : [])
          for (const task of value.tasks) if (!versions.get(task.tool_call_id)?.receipt || Number(versions.get(task.tool_call_id)?.receipt?.revision) <= Number(task.receipt?.revision ?? 0)) versions.set(task.tool_call_id, task)
          return { runID, generation, tasks: [...versions.values()].slice(-64) }
        })
        // Run 收口后仍补读一次最终账本，不能把结束前的快照永久留在界面上。
        if (running || value.tasks.some(task => task.receipt?.result.run.state === 'running')) retry = setTimeout(() => { void observe() }, 100)
      } catch {
        if (abort.signal.aborted) return
        setUnavailable(true)
        retry = setTimeout(() => { void observe() }, 2000)
      }
    }
    void observe()
    return () => { abort.abort(); clearTimeout(retry) }
  }, [enabled, gateway, runID, generation, running])
  return useMemo(() => {
    if (!runID || !generation || snapshot.runID !== runID || snapshot.generation !== generation) return messages
    const tasks = new Map(snapshot.tasks.map(task => [task.tool_call_id, task]))
    return messages.map(message => message.id !== messageID ? message : ({ ...message, parts: message.parts.map(part => {
      if (part.kind !== 'tool' || part.name !== 'termous.desktops.execute' || !part.tool_call_id) return part
      const task = tasks.get(part.tool_call_id)
      const receipt = task?.receipt && readDesktopBatch(task.receipt.result)
      if (!receipt || !task) return part
      if (part.desktop_batch && part.desktop_batch.id !== receipt.id) return part
      // 已落盘的终态优先，迟到的运行快照不得使记录倒退。
      if (part.desktop_batch && part.desktop_batch.state !== 'running') return part
      return { ...part, desktop_batch: receipt, status: receipt.state === 'running' ? 'running' as const
        : receipt.state === 'completed' && !receipt.cleanup_error && !receipt.report_error ? 'completed' as const : 'failed' as const,
        phase: undefined,
        cancelDesktop: receipt.state === 'running' && !unavailable && gateway.cancelDesktopTask
          ? () => gateway.cancelDesktopTask!(runID, generation, task.client_request_id) : undefined }
    }) }))
  }, [gateway, generation, messageID, messages, runID, snapshot, unavailable])
}

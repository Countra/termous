import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

export type WaitWakeReason = 'elapsed' | 'steer' | 'task_update'

// 只管理当前工具的定时器；任务状态、授权和 Run 生命周期仍由原模块负责。
export class RuntimeWait {
  private finish?: (reason: WaitWakeReason) => void
  private cancel?: () => void
  private closed = false

  wake(reason: Exclude<WaitWakeReason, 'elapsed'>) { this.finish?.(reason) }
  close() { this.closed = true; this.cancel?.() }

  tool(pending: () => Exclude<WaitWakeReason, 'elapsed'> | undefined, progress: (id: string) => void): AgentTool {
    return {
      name: 'wait', label: '等待', executionMode: 'sequential',
      description: 'Pause this assistant loop for 1–60 seconds without starting a shell or polling the model. Prefer the original task-specific wait when a task ID exists. A new user instruction or an existing desktop completion may wake this pause early. Elapsed time does not prove readiness or success; observe the state afterwards before choosing dependent actions.',
      parameters: Type.Object({
        duration_seconds: Type.Integer({ minimum: 1, maximum: 60 }),
        reason: Type.Optional(Type.String({ maxLength: 256 })),
      }, { additionalProperties: false }),
      execute: async (id, input, signal) => {
        const { duration_seconds: seconds } = input as { duration_seconds: number }
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new Error('AGENT_WAIT_ARGUMENTS_INVALID')
        signal?.throwIfAborted()
        if (this.closed) throw new Error('AGENT_WAIT_CLOSED')
        if (this.finish) throw new Error('AGENT_WAIT_ALREADY_ACTIVE')
        const started = performance.now()
        progress(id)
        const reason = await new Promise<WaitWakeReason>((resolve, reject) => {
          let settled = false
          const cleanup = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            this.finish = undefined
            this.cancel = undefined
          }
          const finish = (reason: WaitWakeReason) => {
            if (settled) return
            settled = true
            cleanup()
            resolve(reason)
          }
          const abort = () => {
            if (settled) return
            settled = true
            cleanup()
            reject(signal?.reason ?? new Error('AGENT_WAIT_CANCELLED'))
          }
          const timer = setTimeout(() => finish('elapsed'), seconds * 1000)
          this.finish = finish
          this.cancel = abort
          signal?.addEventListener('abort', abort, { once: true })
          // 注册完成后再读取待处理消息，覆盖通知先于工具开始的情况。
          if (signal?.aborted || this.closed) abort()
          else {
            try { const reason = pending(); if (reason) finish(reason) }
            catch (error) { settled = true; cleanup(); reject(error) }
          }
        })
        const result = { kind: 'runtime_wait', requested_seconds: seconds, elapsed_ms: Math.max(0, Math.round(performance.now() - started)), wake_reason: reason }
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
      },
    }
  }
}

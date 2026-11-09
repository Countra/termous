import { setTimeout as delay } from 'node:timers/promises'
import type { AgentMessage, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { DesktopTaskReceipt, DesktopTaskView, ReadDesktopTasks } from '../../contracts/desktopTasks.ts'
import { isRecord } from '../../contracts/validation.ts'
import { observationTarget, type ObservationTarget } from '../../contracts/desktopObservation.ts'
import { isMCPToolDetails } from '../../contracts/mcpTools.ts'
import { readDesktopBatch } from '#common/desktop-batch'
import { desktopTaskMessageSource } from '../../contracts/desktopTaskResult.ts'
import { runtimeToolResultData } from '../../contracts/runtimeToolResult.ts'

const inputTool = /^(?:termous\.desktops\.(?:execute|pointer\.|keyboard\.|clipboard\.set_text|resize)|termous\.desktop_workflows\.runs\.(?:start|control))/u
function key(target: ObservationTarget | undefined) {
  return target?.kind === 'host_desktop' ? `host:${target.instance_id}` : target ? `remote:${target.session_id}` : undefined
}
interface Fence { receipt: DesktopTaskReceipt; delivered: boolean }
class ReceiptFailure extends Error {}

function containsReceipt(message: AgentMessage, receipt: DesktopTaskReceipt) {
  const source = desktopTaskMessageSource(message)
  if (source?.execution_id === receipt.execution_id && source.revision === receipt.revision) return true
  if (message.role !== 'toolResult') return false
  const data = runtimeToolResultData({ content: message.content, details: message.details })
  return isRecord(data.run) && data.run.id === receipt.execution_id && data.run.revision === receipt.revision
}

// 每个 Run 只有一个长轮询；即时核查与普通 MCP 队列隔离，执行事实始终来自 Core。
export class DesktopTaskCoordinator {
  private readonly abort = new AbortController()
  private tasks: DesktopTaskView[] = []
  private readonly fences = new Map<string, Fence>()
  private readonly consumed = new Set<string>()
  private readonly unresolvedSince = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  private cursor = ''
  private readSequence = 0
  private appliedSequence = 0
  private loop?: Promise<void>
  private refreshPromise?: Promise<void>
  private failure?: Error
  private observed = false
  private failedSince = 0
  private readonly read: ReadDesktopTasks
  private readonly onReceipt: (value: DesktopTaskReceipt) => void
  private readonly onFailure: (error: Error) => void
  constructor(read: ReadDesktopTasks, onReceipt: (value: DesktopTaskReceipt) => void, onFailure: (error: Error) => void) {
    this.read = read; this.onReceipt = onReceipt; this.onFailure = onFailure
  }

  private apply(tasks: DesktopTaskView[], cursor: string) {
    this.cursor = cursor
    this.tasks = tasks.filter(task => !task.execution_id || !this.consumed.has(task.execution_id))
    const unresolved = new Set(this.tasks.filter(task => !task.receipt).map(task => task.client_request_id))
    for (const id of this.unresolvedSince.keys()) if (!unresolved.has(id)) this.unresolvedSince.delete(id)
    for (const id of unresolved) {
      const since = this.unresolvedSince.get(id) ?? Date.now()
      this.unresolvedSince.set(id, since)
      // HTTP 查询成功不代表原请求已对账；不能因持续缺少执行记录而无限挂起。
      if (Date.now() - since >= 30_000) throw new ReceiptFailure('AGENT_DESKTOP_TASK_UNRECONCILED')
    }
    for (const task of tasks) {
      const receipt = task.receipt
      if (!receipt) continue
      if (receipt.result.run.report_error) throw new ReceiptFailure('AGENT_DESKTOP_TASK_RECEIPT_UNAVAILABLE')
      const previous = this.fences.get(receipt.execution_id)
      if (!previous && this.consumed.has(receipt.execution_id)) continue
      if (previous && previous.receipt.revision >= receipt.revision) continue
      const terminal = receipt.result.run.state !== 'running'
      this.fences.set(receipt.execution_id, { receipt, delivered: previous?.delivered ?? false })
      if (terminal) this.onReceipt(receipt)
    }
    this.failedSince = 0
    this.wake()
  }

  refresh(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    if (!this.refreshPromise) this.refreshPromise = this.readSnapshot().finally(() => { this.refreshPromise = undefined })
    return this.refreshPromise
  }

  private async query(cursor: string, waitMS: number) {
    const sequence = ++this.readSequence
    const snapshot = await this.read(cursor, waitMS, this.abort.signal)
    this.abort.signal.throwIfAborted()
    // 长轮询和即时核查可能乱序完成；旧响应不能撤销较新快照中的等待义务。
    if (sequence < this.appliedSequence) return
    this.appliedSequence = sequence
    this.apply(snapshot.tasks, snapshot.cursor)
  }

  private async readSnapshot() {
    const started = Date.now()
    for (;;) {
      try { return await this.query('', 0) }
      catch (error) {
        if (this.abort.signal.aborted || error instanceof ReceiptFailure || Date.now() - started >= 30_000) throw error
        await delay(500, undefined, { signal: this.abort.signal })
      }
    }
  }

  observe(name: string, value: AgentToolResult<unknown>) {
    if (!['termous.desktops.execute', 'termous.desktops.executions.get', 'termous.desktops.executions.cancel', 'wait_desktop_execution'].includes(name)) return
    this.observed = true
    const result = isMCPToolDetails(value.details) ? value.details.result.structuredContent : undefined
    if (isRecord(result) && isRecord(result.run) && readDesktopBatch(result)) {
      const id = String(result.run.id)
      const previous = this.fences.get(id)
      if (name === 'termous.desktops.execute' || previous) {
        const terminal = result.run.state !== 'running'
        // 普通工具结果会由原事件桥落盘；下一次请求才允许把它算作已看见。
        if (!previous || previous.receipt.revision <= Number(result.run.revision)) this.fences.set(id, {
          receipt: { ...previous?.receipt, tool_call_id: previous?.receipt.tool_call_id ?? '', execution_id: id, revision: Number(result.run.revision), result: result as DesktopTaskReceipt['result'] }, delivered: terminal,
        })
        if (terminal) this.consumed.add(id)
      }
    }
    this.start()
  }

  private start() {
    if (this.loop || this.abort.signal.aborted) return
    this.loop = this.watch().catch(error => {
      if (!this.abort.signal.aborted) { this.failure = error instanceof Error ? error : new Error(String(error)); this.onFailure(this.failure); this.wake() }
    }).finally(() => { this.loop = undefined })
  }

  private async watch() {
    let initial = true
    while (!this.abort.signal.aborted) {
      try {
        await this.query(initial ? '' : this.cursor, initial ? 0 : 10_000)
        initial = false
        if (!this.tasks.some(task => !task.receipt || task.receipt.result.run.state === 'running')
          && ![...this.fences.values()].some(fence => fence.receipt.result.run.state === 'running')) return
      } catch (error) {
        if (this.abort.signal.aborted) return
        if (error instanceof ReceiptFailure) throw error
        this.failedSince ||= Date.now()
        if (Date.now() - this.failedSince >= 30_000) throw error
        await delay(500, undefined, { signal: this.abort.signal })
      }
    }
  }

  async reconcile() { if (this.observed) await this.refresh() }
  pending() {
    return this.tasks.some(task => !task.execution_id || !this.consumed.has(task.execution_id))
      || [...this.fences.values()].some(fence => !fence.delivered)
  }
  ready() {
    return [...this.fences.values()].filter(fence => fence.receipt.result.run.state !== 'running' && !fence.delivered).map(fence => fence.receipt)
  }
  recorded(receipt: DesktopTaskReceipt) {
    const fence = this.fences.get(receipt.execution_id)
    if (fence) fence.delivered = true
    this.consumed.add(receipt.execution_id)
    this.wake()
  }
  retainMessage(message: AgentMessage) {
    return [...this.fences.values()].some(fence => fence.delivered && containsReceipt(message, fence.receipt))
  }
  beforeRequest(messages?: AgentMessage[]) {
    const versions: Array<{ execution_id: string; revision: number }> = []
    for (const [id, fence] of this.fences) if (fence.delivered) {
      if (messages && !messages.some(message => containsReceipt(message, fence.receipt))) continue
      versions.push({ execution_id: id, revision: fence.receipt.revision })
      // 已进入请求的终态不再承担输入屏障；不保留整轮无限增长的结果副本。
      this.fences.delete(id)
    }
    while (this.consumed.size > 256) this.consumed.delete(this.consumed.values().next().value!)
    return versions
  }
  blocked(name: string, args: Record<string, unknown>, selected?: ObservationTarget) {
    if (!inputTool.test(name) || name.endsWith('.control') && args.action === 'cancel') return undefined
    const target = observationTarget(args.target) ?? observationTarget(args) ?? selected
    for (const fence of this.fences.values()) {
      const run = fence.receipt.result.run
      const original = observationTarget(run.target)
      if (args.attachment_id !== run.attachment_id && key(target) && key(original) && key(target) !== key(original)) continue
      return run.state === 'running'
        ? 'This desktop execution is still running. Do independent work or use wait_desktop_execution; do not send another input to this desktop.'
        : 'A desktop execution completed after this decision was generated. Read its result and screenshot in the next model request before deciding another desktop action.'
    }
    if (this.tasks.some(task => !task.receipt)) return 'A desktop execution is awaiting reconciliation. Wait for its original receipt before sending desktop input.'
    return undefined
  }
  async wait(executionID: string, signal?: AbortSignal): Promise<DesktopTaskReceipt> {
    this.observed = true
    await this.refresh()
    this.start()
    for (;;) {
      signal?.throwIfAborted()
      this.abort.signal.throwIfAborted()
      if (this.failure) throw this.failure
      const receipt = this.fences.get(executionID)?.receipt ?? this.tasks.find(task => task.execution_id === executionID)?.receipt
      if (!receipt) throw new Error('AGENT_DESKTOP_TASK_NOT_FOUND')
      if (receipt.result.run.state !== 'running') return receipt
      await this.waitForChange(signal)
    }
  }
  waitForChange(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const done = () => { cleanup(); resolve() }
      const stopped = () => { cleanup(); reject(signal?.reason ?? this.abort.signal.reason) }
      const cleanup = () => { this.listeners.delete(done); signal?.removeEventListener('abort', stopped); this.abort.signal.removeEventListener('abort', stopped) }
      this.listeners.add(done)
      signal?.addEventListener('abort', stopped, { once: true })
      this.abort.signal.addEventListener('abort', stopped, { once: true })
      if (signal?.aborted || this.abort.signal.aborted) stopped()
      else if (this.failure) { cleanup(); reject(this.failure) }
    })
  }
  wake() { for (const listener of [...this.listeners]) listener() }
  close() { this.abort.abort(); this.wake(); this.tasks = []; this.fences.clear(); this.consumed.clear(); this.unresolvedSince.clear() }
}

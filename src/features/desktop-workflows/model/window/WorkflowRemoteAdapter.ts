import { isWorkflowDetachedCommand, isWorkflowDetachedMedia, workflowDetachedActions, workflowDetachedInputs,
  type WorkflowDetachedCommand, type WorkflowDetachedMedia } from '#common/contracts'
import { TermousApiError } from '#shared/api'
import type { DetachedClient } from '#shared/detached-window'
import type { Asset, ImageTarget, Located, Preview, Snapshot } from '#entities/desktop-workflow'
import type { WorkflowActions, WorkflowFailure, WorkflowMediaGateway, WorkflowSurfaceModel } from '../workspace/types'

interface Echo { sequence: number; command: WorkflowDetachedCommand }
export class WorkflowRemoteAdapter {
  private sequence = 0
  private echoes = new Map<string, Echo>()
  private inputs: { id: string; command: WorkflowDetachedCommand }[] = []
  private sendingInputs?: Promise<void>
  private inputFailed = false
  private listeners = new Set<() => void>()
  private revision = 0
  private model?: WorkflowSurfaceModel
  private pendingMedia = new Set<Promise<unknown>>()
  interactive = false
  constructor(readonly client: DetachedClient, private readonly report: () => void) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly getSnapshot = () => this.revision
  private changed() { this.revision++; for (const listener of this.listeners) listener() }
  private failed(code: string) {
    const operation = Promise.reject(new Error(code))
    void operation.catch(this.report)
    return operation
  }
  private async request(operation: 'binary' | 'command', payload: unknown, id?: string) {
    const response = await this.client.peer.request(operation, payload, 120000, id) as { ok: boolean; value?: unknown; error?: WorkflowFailure }
    if (!response.ok) throw new TermousApiError(response.error?.message ?? 'Request failed', response.error?.code ?? 'detached_operation_failed', response.error?.status ?? 0)
    return response.value
  }
  private flushInputs(retry = true): Promise<void> {
    if (this.sendingInputs) return this.sendingInputs
    if (this.inputFailed && !retry) return Promise.reject(new Error('detached_receipt_unconfirmed'))
    this.inputFailed = false
    // 局部补丁必须按序送达；失败后保留整条输入及其请求标识，后续输入不能越过它。
    const task = Promise.resolve().then(async () => {
      while (this.inputs.length) {
        const input = this.inputs[0]
        await this.request('command', input.command, input.id)
        this.inputs.shift()
      }
    })
    this.sendingInputs = task
    void task.then(() => { this.sendingInputs = undefined }, () => { this.sendingInputs = undefined; this.inputFailed = true })
    return task
  }
  connect(model: Omit<WorkflowSurfaceModel, 'actions'>, acknowledged: number): WorkflowSurfaceModel {
    this.sequence = Math.max(this.sequence, acknowledged)
    for (const [key, echo] of this.echoes) if (echo.sequence <= acknowledged) this.echoes.delete(key)
    let next = structuredClone(model)
    for (const echo of [...this.echoes.values()].sort((a, b) => a.sequence - b.sequence)) next = optimistic(next, echo.command)
    const actions = Object.fromEntries(workflowDetachedActions.map(name => [name, (...args: unknown[]) => {
      if (!this.interactive) return this.failed('detached_editor_inactive')
      const owner = this.model?.state.draft?.editingID
      const input = (workflowDetachedInputs as readonly string[]).includes(name)
      const command: WorkflowDetachedCommand = { name, args, owner, ...(input ? { inputSequence: ++this.sequence } : {}) }
      if (!isWorkflowDetachedCommand(command)) return this.failed('workflow_command_invalid')
      let operation: Promise<unknown>
      if (input) {
        const key = `${owner}:${name}`
        const previous = this.echoes.get(key)?.command
        const echo = previous && ['change', 'changeRun', 'presentation'].includes(name)
          ? { ...command, args: [{ ...previous.args[0] as object, ...args[0] as object }] } : command
        this.echoes.set(key, { sequence: command.inputSequence!, command: echo }); this.changed()
        this.inputs.push({ id: crypto.randomUUID(), command })
        operation = this.flushInputs(false)
      } else operation = this.flushInputs(false).then(() => this.request('command', command))
      void operation.catch(this.report)
      return operation
    }])) as unknown as WorkflowActions
    this.model = { ...next, actions }
    return this.model
  }
  readonly media: WorkflowMediaGateway = {
    openPreview: (session, generation) => this.mediaRequest({ kind: 'open', session, generation }) as Promise<Preview>,
    closePreview: async id => { await this.mediaRequest({ kind: 'close', id }) },
    upload: async blob => this.mediaRequest({ kind: 'upload', type: blob.type, bytes: await blob.arrayBuffer() }) as Promise<Asset>,
    asset: async (id, signal) => {
      signal?.throwIfAborted()
      const result = await this.mediaRequest({ kind: 'asset', id }) as Binary
      signal?.throwIfAborted(); return blob(result)
    },
    capture: async (id, signal) => {
      signal?.throwIfAborted()
      const result = await this.mediaRequest({ kind: 'capture', id }) as Binary & Pick<Snapshot, 'metadata'>
      signal?.throwIfAborted(); return { metadata: result.metadata, blob: blob(result) }
    },
    match: async (id, target: ImageTarget, signal) => {
      signal?.throwIfAborted()
      const result = await this.mediaRequest({ kind: 'match', id, target: target as unknown as Record<string, unknown> }) as Binary & Pick<Located, 'capture' | 'result'>
      signal?.throwIfAborted(); return { capture: result.capture, result: result.result, image: blob(result) }
    },
  }
  private mediaRequest(payload: WorkflowDetachedMedia) {
    if (!isWorkflowDetachedMedia(payload)) return Promise.reject(new Error('workflow_media_invalid'))
    const task = this.request('binary', payload)
    this.trackMediaTask(task)
    return task
  }
  readonly trackMediaTask = (task: Promise<unknown>) => {
    this.pendingMedia.add(task)
    void task.then(() => this.pendingMedia.delete(task), () => this.pendingMedia.delete(task))
  }
  async flush() {
    while (this.pendingMedia.size) await Promise.all([...this.pendingMedia])
    await this.flushInputs()
  }
}
interface Binary { bytes: ArrayBuffer; type: string }
const blob = (value: Binary) => new Blob([value.bytes], { type: value.type })

function optimistic(model: Omit<WorkflowSurfaceModel, 'actions'>, command: WorkflowDetachedCommand) {
  const [arg] = command.args
  const state = model.state
  switch (command.name) {
    case 'change': if (state.draft && state.draft.editingID === command.owner) { state.draft = { ...state.draft, ...arg as object }; state.dirty = true }; break
    case 'selectStep': state.selected = arg as string | undefined; break
    case 'view': state.view = arg as 'scripts' | 'runs'; break
    case 'target': state.chosenTarget = arg as WorkflowSurfaceModel['target']; model.target = state.chosenTarget
      if (model.execution.launch && !model.execution.launch.request) model.execution.launch.target = model.target
      break
    case 'presentation': state.presentation = { ...state.presentation, ...arg as object }; break
    case 'changeRun': if (model.execution.launch && !model.execution.launch.request) model.execution.launch = { ...model.execution.launch, ...arg as object }; break
  }
  return model
}

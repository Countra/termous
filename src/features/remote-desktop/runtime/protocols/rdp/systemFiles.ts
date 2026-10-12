import type { SystemFileClipboardContext } from '#common/contracts'
import { getDesktopWindowBridge, getTermousBridge } from '#shared/bridge'
import { systemClipboardStore } from '../../../model/systemClipboardStore.ts'
import type { DesktopFilesGateway } from '../../../api/DesktopFilesClient.ts'

export function createRdpSystemFiles(options: {
  id: string; api?: DesktopFilesGateway; context: () => SystemFileClipboardContext | undefined
  focused: () => boolean; inputEpoch: () => number; paste: () => void
}) {
  const bridge = getTermousBridge()?.desktopFiles ?? getDesktopWindowBridge()?.desktopFiles
  let enabled = false, disposed = false, busy = false
  let revision = 0, applied = -1
  let configuring: Promise<void> | undefined
  let registered: SystemFileClipboardContext | undefined
  let lastContext: SystemFileClipboardContext | undefined
  let togglePending = false
  let prepared: { sequence: number; context: string; content: number } | undefined
  const update = (patch: Parameters<typeof systemClipboardStore.update>[1]) => { if (!disposed) systemClipboardStore.update(options.id, patch) }
  function configure(): Promise<void> {
    revision++
    if (configuring) return configuring
    configuring = (async () => {
      while (applied !== revision) {
        const current = revision, context = options.context(), requested = enabled && !disposed
        const action = togglePending ? 'set' as const : undefined
        togglePending = false
        applied = current
        if (!bridge) break
        try {
          if (!context || disposed) {
            if (!disposed && action === 'set' && !requested && lastContext) { const result = await bridge.configure(lastContext, false, false, 'set'); if (!result.ok) update({ error_code: result.code }) }
            if (registered) {
              const old = registered; registered = undefined
              const result = await bridge.configure(old, false, false, 'detach'); if (!result.ok) update({ error_code: result.code })
            }
            continue
          }
          registered = { ...context }
          lastContext = registered
          const result = await bridge.configure(context, requested, options.focused(), action)
          if (current !== revision || disposed) continue
          if (!result.ok) { enabled = false; update({ enabled: false, error_code: result.code, ...(result.code === 'desktop_files_unsupported' ? { supported: false } : {}) }) }
          else {
            enabled = result.value.supported && result.value.enabled
            const error = !requested ? systemClipboardStore.get(options.id).error_code : result.value.error_code
            update({ ...result.value, publication_id: result.value.publication_id, content_generation: result.value.content_generation, task_id: result.value.task_id, enabled, error_code: error })
          }
        } catch { enabled = false; update({ enabled: false, error_code: 'desktop_system_clipboard_failed' }) }
      }
    })().finally(() => { configuring = undefined })
    return configuring
  }
  const unbind = systemClipboardStore.bind(options.id, async value => {
    enabled = value; togglePending = true; update({ enabled, error_code: '' }); await configure()
  })
  update({ supported: !!bridge && !!options.api, enabled: false })
  const timer = setInterval(() => void configure(), 1000)
  async function prepare(drop: boolean) {
    const context = options.context(), api = options.api
    if (!context || !bridge || !api || disposed || busy || !drop && !enabled) return
    busy = true; update({ busy: true, error_code: '', notice: undefined })
    const epoch = options.inputEpoch()
    let grant: string | undefined
    let taskId: string | undefined
    try {
      const result = await (drop ? bridge.consumeDrop(context) : bridge.importClipboard(context))
      if (!result.ok) throw new Error(result.code)
      if (result.value.kind !== 'files') {
        if (!drop && enabled && !disposed && options.focused() && options.inputEpoch() === epoch) options.paste()
        return
      }
      grant = result.value.grant?.id
      if (!grant) throw new Error('desktop_files_invalid_selection')
      const key = JSON.stringify(context), sequence = result.value.sequence
      if (!drop && sequence !== undefined && prepared?.sequence === sequence && prepared.context === key) {
        const state = await api.clipboard(context.sessionId, { generation: context.generation, subscription_id: context.subscriptionId, control_generation: context.controlGeneration, content_generation: 0 })
        if (state.published && state.content_generation === prepared.content) {
          if (enabled && !disposed && options.focused() && options.inputEpoch() === epoch) options.paste()
          return
        }
      }
      const query = { generation: context.generation, subscription_id: context.subscriptionId, control_generation: context.controlGeneration, content_generation: 0, operation_id: crypto.randomUUID() }
      const task = await api.transferClipboard(context.sessionId, query, 'publish', grant, [], 'rename')
      taskId = task.id
      const deadline = Date.now() + 2 * 60 * 60 * 1000
      let status = task
      while (['running', 'queued'].includes(status.status) && !disposed && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250))
        const next = (await api.tasks()).find(value => value.id === task.id)
        if (!next) throw new Error('desktop_file_clipboard_failed')
        status = next
      }
      if (disposed) { await api.cancelTask(task.id); taskId = undefined; return }
      if (status.status !== 'completed') throw new Error('desktop_file_clipboard_failed')
      taskId = undefined
      if (!drop && sequence !== undefined) {
        const state = await api.clipboard(context.sessionId, query)
        if (state.published) prepared = { sequence, context: key, content: state.content_generation }
      }
      const latest = options.context()
      if (!drop && enabled && options.focused() && epoch === options.inputEpoch() && latest?.controlGeneration === context.controlGeneration && latest.subscriptionId === context.subscriptionId) options.paste()
      else update({ notice: 'prepared' })
    } catch (error) { update({ error_code: error instanceof Error ? error.message : 'desktop_system_clipboard_failed', notice: 'failed' }) }
    finally {
      if (taskId) { try { await api.cancelTask(taskId) } catch { update({ error_code: 'desktop_system_clipboard_failed' }) } }
      if (grant) { try { const result = await bridge.releaseSelection(grant); if (!result.ok) update({ error_code: result.code }) } catch { update({ error_code: 'desktop_system_clipboard_failed' }) } }
      busy = false; update({ busy: false })
    }
  }
  return {
    interceptPaste: () => enabled && !!bridge && !!options.api,
    prepare,
    changed: () => { void configure() },
    drag: (dragging: boolean) => update({ dragging }),
    dispose() {
      disposed = true; clearInterval(timer); unbind(); void configure()
    },
  }
}

import type { SystemFileClipboardContext } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'
import { getSystemClipboardOperation, systemClipboardCapabilities } from '#entities/system-clipboard'
import { systemClipboardStore } from '../../../model/systemClipboardStore.ts'
import type { DesktopFilesGateway } from '../../../api/DesktopFilesClient.ts'

export function createRdpSystemFiles(options: {
  id: string; api?: DesktopFilesGateway; context: () => SystemFileClipboardContext | undefined
  focused: () => boolean; inputEpoch: () => number; paste: () => void
}) {
  const bridge = getTermousBridge()?.desktopFiles
  let enabled = false, disposed = false, busy = false
  let revision = 0, applied = -1
  let configuring: Promise<void> | undefined
  let registered: SystemFileClipboardContext | undefined
  let operationError: string | undefined
  let prepared: { sequence: number; context: string; content: number } | undefined
  const capabilityReady = () => getSystemClipboardOperation('import_files').available || getSystemClipboardOperation('publish_files').available
  const canImport = () => enabled && getSystemClipboardOperation('import_files').available
  const update = (patch: Parameters<typeof systemClipboardStore.update>[1]) => { if (!disposed) systemClipboardStore.update(options.id, patch) }
  function configure(invalidate = true): Promise<void> {
    // 心跳只补充状态；只有控制、焦点等主动变更才淘汰正在返回的快照。
    if (!invalidate && configuring) return configuring
    if (!options.context() || disposed || !capabilityReady()) {
      enabled = false
      prepared = undefined
      update({ enabled: false, import_enabled: false, publish_enabled: false, error_code: operationError })
    }
    revision++
    if (configuring) return configuring
    configuring = (async () => {
      while (applied !== revision) {
        const current = revision, context = options.context()
        applied = current
        if (!bridge) break
        try {
          if (!context || disposed || !capabilityReady()) {
            enabled = false
            update({ enabled: false, import_enabled: false, publish_enabled: false })
            if (registered) {
              const old = registered; registered = undefined
              const result = await bridge.configure(old, false, 'detach'); if (!result.ok) update({ error_code: operationError ?? result.code })
            }
            continue
          }
          registered = { ...context }
          const result = await bridge.configure(context, options.focused())
          if (current !== revision || disposed) continue
          if (!result.ok) {
            enabled = false
            // 自动启用等待桌面和文件通道就绪；显式文件操作的错误仍由 prepare 展示。
            if (result.code === 'desktop_not_ready') update({ enabled: false, import_enabled: false, publish_enabled: false, error_code: operationError })
            else update({ enabled: false, import_enabled: false, publish_enabled: false, error_code: operationError ?? result.code })
          }
          else {
            enabled = result.value.import_enabled === true && getSystemClipboardOperation('import_files').available
            const publishEnabled = result.value.publish_enabled === true && getSystemClipboardOperation('publish_files').available
            const error = operationError ?? result.value.error_code
            update({ ...result.value, publication_id: result.value.publication_id, content_generation: result.value.content_generation, task_id: result.value.task_id, enabled: enabled || publishEnabled, import_enabled: enabled, publish_enabled: publishEnabled, error_code: error })
          }
        } catch {
          if (current !== revision || disposed) continue
          enabled = false
          update({ enabled: false, import_enabled: false, publish_enabled: false, error_code: operationError ?? 'desktop_system_clipboard_failed' })
        }
      }
    })().finally(() => { configuring = undefined })
    return configuring
  }
  const unbind = systemClipboardStore.bind(options.id)
  update({ enabled: false, import_enabled: false, publish_enabled: false })
  let timer: ReturnType<typeof setInterval> | undefined
  const synchronizeCapabilities = () => {
    clearInterval(timer)
    if (capabilityReady() && bridge && options.api) timer = setInterval(() => void configure(false), 1000)
    if (!getSystemClipboardOperation('import_files').available) enabled = false
    void configure()
  }
  const unsubscribeCapabilities = systemClipboardCapabilities.subscribe(synchronizeCapabilities)
  synchronizeCapabilities()
  function operationFailed(code: string) { operationError = code; update({ error_code: code, notice: 'failed' }) }
  async function prepare(drop: boolean) {
    const context = options.context(), api = options.api
    if (!context || !bridge || !api || disposed || busy || !drop && !canImport()) return
    busy = true; operationError = undefined; update({ busy: true, error_code: '', notice: undefined })
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
    } catch (error) { operationFailed(error instanceof Error ? error.message : 'desktop_system_clipboard_failed') }
    finally {
      if (taskId) { try { await api.cancelTask(taskId) } catch { operationFailed('desktop_system_clipboard_failed') } }
      if (grant) { try { const result = await bridge.releaseSelection(grant); if (!result.ok) operationFailed(result.code) } catch { operationFailed('desktop_system_clipboard_failed') } }
      busy = false; update({ busy: false })
    }
  }
  return {
    interceptPaste: () => canImport() && !!bridge && !!options.api,
    prepare,
    changed: () => configure(),
    drag: (dragging: boolean) => update({ dragging }),
    dispose() {
      disposed = true; clearInterval(timer); unsubscribeCapabilities(); unbind(); void configure()
    },
  }
}

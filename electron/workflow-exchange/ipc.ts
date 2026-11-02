import { dialog, type BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { AppConfig, AppLanguage, DetachedConnection, WorkflowFileProgress, WorkflowFileResponse } from '#common/contracts'
import { isWorkflowFileRequest, workflowExchangeChannels as channels } from '#common/contracts'
import { ExchangeCore } from './core.ts'
import { importFile } from './import.ts'
import { exportFile } from './export.ts'
import { ExchangeFailure } from './files.ts'

interface Options {
  ipc: IpcMain
  config: () => Promise<AppConfig>
  trusted: (event: IpcMainInvokeEvent) => boolean
  owner: (origin?: DetachedConnection) => BrowserWindow | undefined
  language: () => AppLanguage
}
export function registerWorkflowExchange(options: Options) {
  const operations = new Map<string, { sender: number; abort: AbortController }>()
  options.ipc.handle(channels.run, async (event, value: unknown): Promise<WorkflowFileResponse> => {
    if (!options.trusted(event) || !isWorkflowFileRequest(value)) return { error: { code: 'workflow_exchange_sender_denied', message: '工作流文件请求无效' } }
    const owner = options.owner(value.origin)
    if (!owner || owner.isDestroyed() || operations.has(value.operation_id) || operations.size >= 4) return { error: { code: 'desktop_workflow_exchange_busy', message: '工作流文件操作暂不可用' } }
    const abort = new AbortController(); operations.set(value.operation_id, { sender: event.sender.id, abort })
    const closed = () => abort.abort()
    owner.once('closed', closed); event.sender.once('destroyed', closed)
    let lastPhase = '', lastProgressAt = 0
    const emit = (progress: Omit<WorkflowFileProgress, 'operation_id'>) => {
      const now = Date.now()
      // 正文流的小块不逐个广播，避免带动双窗口重复发布整个编辑快照。
      if (progress.phase === lastPhase && now - lastProgressAt < 100) return
      lastPhase = progress.phase; lastProgressAt = now
      if (!event.sender.isDestroyed()) event.sender.send(channels.progress, { ...progress, operation_id: value.operation_id })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const zh = options.language() === 'zh-CN'; emit({ phase: 'selecting' })
      let selected: string | undefined
      if (value.kind === 'import') {
        const choice = await dialog.showOpenDialog(owner, { title: zh ? '导入工作流' : 'Import workflow', properties: ['openFile'], filters: [{ name: 'Workflow', extensions: ['zip', 'json'] }] })
        selected = choice.canceled ? undefined : choice.filePaths[0]
      } else {
        const directory = value.layout === 'directory'
        const choice = await dialog.showSaveDialog(owner, { title: zh ? (directory ? '导出到新的配置目录' : '导出工作流') : (directory ? 'Export to a new workflow directory' : 'Export workflow'),
          defaultPath: directory ? 'workflow.termous-workflow' : value.layout === 'zip' ? 'workflow.termous-workflow.zip' : 'workflow.json',
          filters: directory ? undefined : [{ name: 'Workflow', extensions: [value.layout === 'zip' ? 'zip' : 'json'] }], properties: ['showOverwriteConfirmation'],
        })
        selected = choice.canceled ? undefined : choice.filePath
      }
      if (!selected || abort.signal.aborted) return { canceled: true }
      timer = setTimeout(() => abort.abort(new ExchangeFailure('desktop_workflow_exchange_timeout')), 5 * 60_000)
      const core = new ExchangeCore(await options.config())
      if (value.kind === 'import') {
        const id = await importFile(core, selected, abort.signal, (bytes, total) => emit({ phase: bytes === total ? 'validating' : 'transferring', transferred_bytes: bytes, total_bytes: total }))
        if (abort.signal.aborted) { await core.release('imports', id); return { canceled: true } }
        emit({ phase: 'complete' }); return { import_id: id }
      }
      const name = await exportFile(core, value.script_id!, value.version!, value.layout!, selected, abort.signal,
        (bytes, total, publishing) => emit({ phase: publishing ? 'publishing' : 'transferring', transferred_bytes: bytes, total_bytes: total }))
      emit({ phase: 'complete' }); return { file_name: name }
    } catch (error) {
      const reason = abort.signal.reason
      if (abort.signal.aborted && !(reason instanceof ExchangeFailure)) return { canceled: true }
      const failure = reason instanceof ExchangeFailure ? reason : error
      const code = failure instanceof ExchangeFailure ? failure.code : (failure as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'workflow_exchange_file_missing' : 'workflow_exchange_io_failed'
      return { error: { code, message: code, status: failure instanceof ExchangeFailure ? failure.status : 0, details: failure instanceof ExchangeFailure ? failure.details : undefined } }
    } finally { clearTimeout(timer); operations.delete(value.operation_id); owner.removeListener('closed', closed); event.sender.removeListener('destroyed', closed) }
  })
  options.ipc.handle(channels.cancel, (event, id: unknown) => {
    if (!options.trusted(event) || typeof id !== 'string') return
    const entry = operations.get(id); if (entry?.sender === event.sender.id) entry.abort.abort()
  })
  return () => { for (const entry of operations.values()) entry.abort.abort(); options.ipc.removeHandler(channels.run); options.ipc.removeHandler(channels.cancel) }
}

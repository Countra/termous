import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { FileClipboardImport, FileClipboardImportRequest, FileSystemClipboardRequest, FileSystemClipboardState } from '#common/contracts'
import { RemoteCore, RemoteCoreError, result, validId } from './remoteControl/core.ts'

// 业务错误使用 Core 的公开大写码，避免远控桥接的规范化影响文件模块文案匹配。
async function clipboardResult<T>(operation: () => Promise<T>) {
  const value = await result(operation)
  return value.ok ? value : { ...value, code: value.code.toUpperCase() }
}

export function registerFileSystemClipboardIPC(options: {
  ipc: IpcMain
  core: RemoteCore
  trusted: (event: IpcMainInvokeEvent) => boolean
  focused: (event: IpcMainInvokeEvent) => boolean
  warn: (code: string) => void
}) {
  const windows = new Map<number, string>()
  const owner = (event: IpcMainInvokeEvent) => {
    if (!options.trusted(event) || event.sender.isDestroyed()) throw new RemoteCoreError('FILE_CLIPBOARD_SENDER_INVALID')
    let id = windows.get(event.sender.id)
    if (!id) {
      id = randomUUID()
      windows.set(event.sender.id, id)
      const windowId = id
      const cleanup = () => {
        if (windows.get(event.sender.id) !== windowId) return
        windows.delete(event.sender.id)
        event.sender.removeListener('destroyed', cleanup)
        event.sender.removeListener('render-process-gone', cleanup)
        event.sender.removeListener('did-start-navigation', navigation)
        void options.core.request(`/file-system-clipboard?window_id=${windowId}`, undefined, 'DELETE')
          .catch(() => options.warn('files_clipboard_window_cleanup_failed'))
      }
      const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (!inPlace && mainFrame) cleanup() }
      event.sender.once('destroyed', cleanup)
      event.sender.once('render-process-gone', cleanup)
      event.sender.on('did-start-navigation', navigation)
    }
    return id
  }
  options.ipc.handle('file-system-clipboard:status', event => clipboardResult(() => options.core.request<FileSystemClipboardState>(`/file-system-clipboard?window_id=${owner(event)}`)))
  options.ipc.handle('file-system-clipboard:import', (event, input: FileClipboardImportRequest) => clipboardResult(async () => {
    const windowId = owner(event)
    if (!options.focused(event) || !input || !validId(input.file_session_id) || !Number.isSafeInteger(input.connection_generation) || input.connection_generation < 1 || input.sequence !== undefined && (!Number.isInteger(input.sequence) || input.sequence < 0 || input.sequence > 0xffffffff)) throw new RemoteCoreError('FILE_CLIPBOARD_INVALID')
    const selection = await options.core.request<FileClipboardImport>('/file-system-clipboard/import', { file_session_id: input.file_session_id, connection_generation: input.connection_generation, sequence: input.sequence, window_id: windowId })
    // 异步导入期间窗口可能关闭；尚未交付的授权由主进程立即回收。
    if (event.sender.isDestroyed() || !options.trusted(event) || windows.get(event.sender.id) !== windowId) {
      if (selection.grant) await options.core.request(`/local-file-grants/${selection.grant.id}`, undefined, 'DELETE')
      throw new RemoteCoreError('FILE_CLIPBOARD_SENDER_INVALID')
    }
    return selection
  }))
  options.ipc.handle('file-system-clipboard:copy', (event, input: FileSystemClipboardRequest) => clipboardResult(async () => {
    const windowId = owner(event)
    if (!options.focused(event) || !input || !validId(input.file_session_id) || !validId(input.operation_id) || !Number.isSafeInteger(input.connection_generation) || input.connection_generation < 1 || !Array.isArray(input.paths) || !input.paths.length || input.paths.length > 4096 || input.paths.some(path => typeof path !== 'string' || !path || path.length > 32768 || path.includes('\0'))) throw new RemoteCoreError('FILE_CLIPBOARD_INVALID')
    const state = await options.core.request<FileSystemClipboardState>('/file-system-clipboard', { file_session_id: input.file_session_id, connection_generation: input.connection_generation, operation_id: input.operation_id, paths: input.paths, window_id: windowId })
    if (event.sender.isDestroyed() || !options.trusted(event) || windows.get(event.sender.id) !== windowId) {
      await options.core.request(`/file-system-clipboard?window_id=${windowId}`, undefined, 'DELETE')
      throw new RemoteCoreError('FILE_CLIPBOARD_SENDER_INVALID')
    }
    return state
  }))
  options.ipc.handle('file-system-clipboard:revoke', (event, id: unknown) => clipboardResult(async () => {
    const windowId = owner(event)
    if (typeof id !== 'string' || !validId(id)) throw new RemoteCoreError('FILE_CLIPBOARD_INVALID')
    await options.core.request(`/file-system-clipboard/${id}?window_id=${windowId}`, undefined, 'DELETE')
  }))
}

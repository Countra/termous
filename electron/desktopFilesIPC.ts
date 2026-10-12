import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { SystemFileClipboardContext, SystemFileClipboardState, SystemFileSelection } from '#common/contracts'
import { RemoteCore, RemoteCoreError, result, validId } from './remoteControl/core.ts'

interface Registration { id: string; context: SystemFileClipboardContext; enabled: boolean; closed: boolean; pending: Promise<void> }

// 窗口标识和真实焦点由主进程赋予，文件路径只接受 preload 捕获的系统拖放。
export function registerDesktopFilesIPC(options: {
  ipc: IpcMain; core: RemoteCore; trusted: (event: IpcMainInvokeEvent, session: string) => boolean
  focused: (event: IpcMainInvokeEvent) => boolean; warn: (code: string) => void
}) {
  const windows = new Map<number, Map<string, Registration>>()
  const grants = new Map<string, number>()
  const background = new Map<number, boolean>()
  const syncBackground = (sender: WebContents) => {
    const active = [...(windows.get(sender.id)?.values() ?? [])].some(entry => entry.enabled && !entry.closed)
    if (sender.isDestroyed()) { background.delete(sender.id); return }
    if (active && !background.has(sender.id)) {
      // Explorer 在前台提取文件时，仍需让观看入口按时发送控制续租和剪贴板心跳。
      background.set(sender.id, sender.getBackgroundThrottling())
      sender.setBackgroundThrottling(false)
    } else if (!active && background.has(sender.id)) {
      sender.setBackgroundThrottling(background.get(sender.id)!)
      background.delete(sender.id)
    }
  }
  const validate = (event: IpcMainInvokeEvent, value: unknown) => {
    if (!value || typeof value !== 'object') throw new RemoteCoreError('desktop_sender_not_allowed')
    const context = value as SystemFileClipboardContext
    if (!validId(context.sessionId) || !validId(context.subscriptionId) || !Number.isSafeInteger(context.generation) || context.generation <= 0 || !Number.isSafeInteger(context.controlGeneration) || context.controlGeneration <= 0 || !options.trusted(event, context.sessionId)) throw new RemoteCoreError('desktop_sender_not_allowed')
    let entries = windows.get(event.sender.id)
    if (!entries) {
      entries = new Map()
      windows.set(event.sender.id, entries)
      const registered = entries
      const cleanup = () => {
        windows.delete(event.sender.id)
        event.sender.removeListener('destroyed', cleanup)
        event.sender.removeListener('did-start-navigation', navigation)
        event.sender.removeListener('render-process-gone', cleanup)
        syncBackground(event.sender)
        for (const entry of registered.values()) { entry.closed = true; void serial(entry, () => update(entry, entry.context, false, false, 'detach')).catch(() => options.warn('desktop_clipboard_disable_failed')) }
        for (const [id, owner] of grants) if (owner === event.sender.id) { grants.delete(id); void release(id).catch(() => options.warn('desktop_clipboard_grant_release_failed')) }
      }
      const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (!inPlace && mainFrame) cleanup() }
      event.sender.once('destroyed', cleanup)
      event.sender.once('render-process-gone', cleanup)
      event.sender.on('did-start-navigation', navigation)
    }
    let entry = entries.get(context.sessionId)
    if (!entry) {
      if (entries.size >= 16) throw new RemoteCoreError('desktop_busy')
      entry = { id: randomUUID(), context: { ...context }, enabled: false, closed: false, pending: Promise.resolve() }
      entries.set(context.sessionId, entry)
    }
    return entry
  }
  const body = (entry: Registration, context: SystemFileClipboardContext, enabled: boolean, focused: boolean) => ({ generation: context.generation, subscription_id: context.subscriptionId, control_generation: context.controlGeneration, window_id: entry.id, enabled, focused })
  const update = (entry: Registration, context: SystemFileClipboardContext, enabled: boolean, focused: boolean, action?: 'set' | 'detach') => options.core.request<SystemFileClipboardState>(`/remote-desktop-sessions/${context.sessionId}/system-file-clipboard`, { ...body(entry, context, enabled, focused), action })
  const release = (id: string) => options.core.request(`/local-file-grants/${id}`, undefined, 'DELETE')
  const serial = <T>(entry: Registration, operation: () => Promise<T>) => {
    const pending = entry.pending.then(operation)
    entry.pending = pending.then(() => undefined, () => undefined)
    return pending
  }
  const verify = (event: IpcMainInvokeEvent, entry: Registration, context: SystemFileClipboardContext) => {
    if (entry.closed || event.sender.isDestroyed() || !options.trusted(event, context.sessionId)) throw new RemoteCoreError('desktop_sender_not_allowed')
  }
  const keepGrant = async (event: IpcMainInvokeEvent, entry: Registration, context: SystemFileClipboardContext, id: string) => {
    try { verify(event, entry, context); grants.set(id, event.sender.id) }
    catch (error) { try { await release(id) } catch { options.warn('desktop_clipboard_grant_release_failed') }; throw error }
  }
  options.ipc.handle('desktop-files:configure', (event, context: unknown, enabled: unknown, focused: unknown, action?: unknown) => result(async () => {
    const entry = validate(event, context)
    if (typeof enabled !== 'boolean' || typeof focused !== 'boolean') throw new RemoteCoreError('desktop_invalid')
    if (action !== undefined && action !== 'set' && action !== 'detach') throw new RemoteCoreError('desktop_invalid')
    const snapshot = { ...(context as SystemFileClipboardContext) }
    return serial(entry, async () => {
      verify(event, entry, snapshot)
      entry.context = snapshot
      const state = await update(entry, snapshot, enabled, focused && options.focused(event), action)
      verify(event, entry, snapshot)
      entry.enabled = state.enabled
      syncBackground(event.sender)
      return state
    })
  }))
  options.ipc.handle('desktop-files:import', (event, context: unknown) => result(async () => {
    const entry = validate(event, context)
    const snapshot = { ...(context as SystemFileClipboardContext) }
    return serial(entry, async () => {
      verify(event, entry, snapshot)
      if (!entry.enabled || !options.focused(event) || JSON.stringify(entry.context) !== JSON.stringify(snapshot)) throw new RemoteCoreError('desktop_control_stale')
      const selection = await options.core.request<SystemFileSelection>(`/remote-desktop-sessions/${snapshot.sessionId}/system-file-clipboard/import`, body(entry, snapshot, true, true))
      if (selection.grant?.id) await keepGrant(event, entry, snapshot, selection.grant.id)
      else verify(event, entry, snapshot)
      return selection
    })
  }))
  options.ipc.handle('desktop-files:drop', (event, context: unknown, paths: unknown) => result(async () => {
    const entry = validate(event, context)
    const snapshot = { ...(context as SystemFileClipboardContext) }
    if (!options.focused(event) || !Array.isArray(paths) || !paths.length || paths.length > 4096 || paths.some(path => typeof path !== 'string' || path.length > 32767)) throw new RemoteCoreError('desktop_files_invalid_selection')
    const grant = await options.core.request<NonNullable<SystemFileSelection['grant']>>('/local-file-grants', { source: 'drop', paths })
    await keepGrant(event, entry, snapshot, grant.id)
    return { kind: 'files' as const, grant }
  }))
  options.ipc.handle('desktop-files:release', (event, id: unknown) => result(async () => {
    if (!validId(id) || grants.get(id) !== event.sender.id || event.sender.isDestroyed()) throw new RemoteCoreError('desktop_sender_not_allowed')
    await release(id)
    grants.delete(id)
  }))
}

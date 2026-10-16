import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { systemClipboardChannels as channels } from '#common/contracts'
import type { ClipboardCapabilitiesClient } from './client.ts'

export function registerClipboardCapabilitiesIPC(ipc: IpcMain, client: ClipboardCapabilitiesClient, trusted: (event: IpcMainInvokeEvent) => boolean) {
  const windows = new Map<WebContents, () => void>()
  ipc.handle(channels.get, event => {
    if (!trusted(event) || event.sender.isDestroyed()) throw new Error('SYSTEM_CLIPBOARD_SENDER_INVALID')
    if (!windows.has(event.sender)) {
      const sender = event.sender
      const cleanup = () => {
        windows.delete(sender)
        sender.removeListener('destroyed', cleanup)
        sender.removeListener('render-process-gone', cleanup)
        sender.removeListener('did-start-navigation', navigation)
      }
      const navigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (!inPlace && mainFrame) cleanup() }
      windows.set(sender, cleanup)
      sender.once('destroyed', cleanup)
      sender.once('render-process-gone', cleanup)
      sender.on('did-start-navigation', navigation)
    }
    return client.state.get()
  })
  const stop = client.state.subscribe(state => {
    for (const [window, cleanup] of windows) {
      if (window.isDestroyed()) { cleanup(); continue }
      try { window.send(channels.changed, state) }
      catch {
        // 渲染帧可能在检查后退出；清理失效订阅，不能中断其他窗口的同步。
        cleanup()
      }
    }
  })
  return () => { stop(); for (const cleanup of windows.values()) cleanup(); ipc.removeHandler(channels.get); client.stop() }
}

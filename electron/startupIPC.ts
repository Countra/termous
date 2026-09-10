import { clipboard, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { StartupPresentationAcknowledgement, StartupWindowState } from './startupPresentation'

interface StartupIPCOptions {
  isTrustedSplash: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean
  isTrustedMain: (event: IpcMainInvokeEvent) => boolean
  getState: () => StartupWindowState
  presented: (acknowledgement: StartupPresentationAcknowledgement) => void
  diagnostics: () => string
  openLogs: () => Promise<void>
  exit: () => Promise<unknown>
}

export function registerStartupIPC(options: StartupIPCOptions) {
  const requireSplash = (event: IpcMainInvokeEvent) => {
    if (!options.isTrustedSplash(event)) throw new Error('startup_ipc_sender_not_allowed')
  }
  ipcMain.handle('startup:status', (event) => {
    requireSplash(event)
    return options.getState()
  })
  ipcMain.on('startup:presented', (event, value: unknown) => {
    if (!options.isTrustedSplash(event) || !value || typeof value !== 'object') return
    const ack = value as Partial<StartupPresentationAcknowledgement>
    if (typeof ack.attemptId !== 'string' || ack.attemptId.length > 128
      || !Number.isSafeInteger(ack.presentationId) || Number(ack.presentationId) < 0) return
    options.presented(ack as StartupPresentationAcknowledgement)
  })
  ipcMain.handle('startup:copy-diagnostics', (event) => {
    requireSplash(event)
    clipboard.writeText(options.diagnostics())
  })
  ipcMain.handle('startup:open-logs', async (event) => {
    requireSplash(event)
    await options.openLogs()
  })
  ipcMain.handle('startup:exit', async (event) => {
    requireSplash(event)
    await options.exit()
  })
  ipcMain.handle('diagnostics:copy-startup', (event) => {
    if (!options.isTrustedMain(event)) return false
    try {
      clipboard.writeText(options.diagnostics())
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('diagnostics:open-logs', async (event) => {
    if (!options.isTrustedMain(event)) return { ok: false, error: 'diagnostics_sender_not_allowed' }
    try {
      await options.openLogs()
      return { ok: true }
    } catch {
      return { ok: false, error: 'diagnostics_open_logs_failed' }
    }
  })
}

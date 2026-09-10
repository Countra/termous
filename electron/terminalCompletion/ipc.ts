import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { TerminalCompletionRuntime } from './runtime.ts'
import { isTerminalCompletionCancel, isTerminalCompletionRequest } from './protocol.ts'

export const terminalCompletionIPCChannels = { generate: 'terminal-ai:generate', cancel: 'terminal-ai:cancel' } as const

export function registerTerminalCompletionIPC(options: {
  ipcMain: IpcMain
  runtime: Pick<TerminalCompletionRuntime, 'generate' | 'cancel' | 'cancelOwner'>
  isTrustedSender(event: IpcMainInvokeEvent): boolean
}) {
  options.ipcMain.handle(terminalCompletionIPCChannels.generate, async (event, value: unknown) => {
    if (!options.isTrustedSender(event) || !isTerminalCompletionRequest(value)) throw new Error('TERMINAL_AI_IPC_NOT_ALLOWED')
    const cancel = () => options.runtime.cancelOwner(event.sender.id)
    event.sender.once('destroyed', cancel)
    event.sender.once('did-start-navigation', cancel)
    try { return await options.runtime.generate(value, event.sender.id) } finally {
      event.sender.removeListener('destroyed', cancel)
      event.sender.removeListener('did-start-navigation', cancel)
    }
  })
  options.ipcMain.handle(terminalCompletionIPCChannels.cancel, (event, value: unknown) => {
    if (!options.isTrustedSender(event) || !isTerminalCompletionCancel(value)) throw new Error('TERMINAL_AI_IPC_NOT_ALLOWED')
    options.runtime.cancel(value, event.sender.id)
  })
  return () => {
    options.ipcMain.removeHandler(terminalCompletionIPCChannels.generate)
    options.ipcMain.removeHandler(terminalCompletionIPCChannels.cancel)
  }
}

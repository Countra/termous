import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { notificationIPCChannels as channels } from '#common/contracts'
import type { NotificationRuntime } from './runtime.ts'
import type { NotificationPreferencesStore } from './preferences.ts'

export function registerNotificationIPC(options: {
  ipcMain: IpcMain
  runtime: NotificationRuntime
  preferences: NotificationPreferencesStore
  supported(): boolean
  trusted(event: IpcMainInvokeEvent): boolean
}) {
  const handlers: Record<string, (value: unknown) => unknown> = {
    [channels.status]: () => ({ supported: options.supported(), preferences: options.preferences.get() }),
    [channels.preferences]: async (value) => ({ supported: options.supported(), preferences: await options.preferences.set(value) }),
    [channels.pending]: () => options.runtime.pending(),
    [channels.acknowledge]: (id) => options.runtime.acknowledge(id),
  }
  for (const [channel, handle] of Object.entries(handlers)) {
    options.ipcMain.handle(channel, (event, value: unknown) => {
      if (!options.trusted(event)) throw new Error('NOTIFICATION_IPC_NOT_ALLOWED')
      return handle(value)
    })
  }
  return () => { for (const channel of Object.keys(handlers)) options.ipcMain.removeHandler(channel) }
}

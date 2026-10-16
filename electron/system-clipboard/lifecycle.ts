import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AppConfig, CoreStartupSnapshot } from '#common/contracts'
import { ClipboardCapabilitiesClient } from './client.ts'
import { registerClipboardCapabilitiesIPC } from './ipc.ts'

interface CoreConnection {
  initialize(): Promise<AppConfig>
  getStartupStatus(): CoreStartupSnapshot
  onStatusChanged(listener: (snapshot: CoreStartupSnapshot) => void): () => void
}

export function registerSystemClipboardCapabilities(ipc: IpcMain, core: CoreConnection, trusted: (event: IpcMainInvokeEvent) => boolean) {
  const client = new ClipboardCapabilitiesClient(() => core.initialize())
  const disposeIPC = registerClipboardCapabilitiesIPC(ipc, client, trusted)
  let connection: string | undefined
  const observe = (snapshot: CoreStartupSnapshot) => {
    const next = snapshot.phase === 'ready' || snapshot.phase === 'external'
      ? `${snapshot.attemptId}:${snapshot.instanceId ?? ''}` : undefined
    if (next === connection) return
    connection = next
    client.stop()
    if (next) client.start()
  }
  const unsubscribe = core.onStatusChanged(observe)
  observe(core.getStartupStatus())
  return () => { unsubscribe(); disposeIPC() }
}

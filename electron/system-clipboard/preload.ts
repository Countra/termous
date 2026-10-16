import { ipcRenderer } from 'electron'
import { systemClipboardChannels as channels, type SystemClipboardCapabilitiesBridge, type SystemClipboardConnectionState } from '#common/contracts'

export function createSystemClipboardCapabilitiesBridge(): SystemClipboardCapabilitiesBridge {
  return {
    get: () => ipcRenderer.invoke(channels.get),
    subscribe: listener => {
      const handler = (_event: Electron.IpcRendererEvent, state: SystemClipboardConnectionState) => listener(state)
      ipcRenderer.on(channels.changed, handler)
      return () => ipcRenderer.removeListener(channels.changed, handler)
    },
  }
}

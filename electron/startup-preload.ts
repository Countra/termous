import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { StartupWindowBridge, StartupWindowState } from './startupPresentation'

const bridge = {
  status: () => ipcRenderer.invoke('startup:status'),
  onChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, state: StartupWindowState) => callback(state)
    ipcRenderer.on('startup:changed', listener)
    return () => ipcRenderer.removeListener('startup:changed', listener)
  },
  presented: (acknowledgement) => ipcRenderer.send('startup:presented', acknowledgement),
  copyDiagnostics: () => ipcRenderer.invoke('startup:copy-diagnostics'),
  openLogs: () => ipcRenderer.invoke('startup:open-logs'),
  exit: () => ipcRenderer.invoke('startup:exit'),
} satisfies StartupWindowBridge

contextBridge.exposeInMainWorld('termousStartupBridge', bridge)

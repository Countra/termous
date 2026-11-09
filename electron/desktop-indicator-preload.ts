import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopIndicatorBridge, DesktopIndicatorState } from '#common/contracts'

const bridge: DesktopIndicatorBridge = {
  state: () => ipcRenderer.invoke('desktop-indicator:state'),
  subscribe(listener) {
    const receive = (_: Electron.IpcRendererEvent, value: DesktopIndicatorState) => listener(value)
    ipcRenderer.on('desktop-indicator:state', receive)
    return () => { ipcRenderer.removeListener('desktop-indicator:state', receive) }
  },
  reclaim: request => ipcRenderer.invoke('desktop-indicator:reclaim', request),
}
contextBridge.exposeInMainWorld('termousDesktopIndicator', bridge)

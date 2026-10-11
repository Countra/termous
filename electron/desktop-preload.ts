import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopWindowBridge } from '#common/contracts'

const bridge: DesktopWindowBridge = {
  pickPaths: (options) => ipcRenderer.invoke('desktop:pick-paths', options),
  bootstrap: () => ipcRenderer.invoke('desktop:bootstrap'),
  close: () => ipcRenderer.invoke('desktop:close'),
}
contextBridge.exposeInMainWorld('termousDesktop', bridge)

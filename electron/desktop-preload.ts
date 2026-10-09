import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopWindowBridge } from '#common/contracts'

const bridge: DesktopWindowBridge = {
  bootstrap: () => ipcRenderer.invoke('desktop:bootstrap'),
  close: () => ipcRenderer.invoke('desktop:close'),
}
contextBridge.exposeInMainWorld('termousDesktop', bridge)

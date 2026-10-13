import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAutomationBridge } from '#common/contracts'

const bridge: DesktopAutomationBridge = {
  bootstrap: () => ipcRenderer.invoke('desktop-automation:bootstrap'),
  credentials: () => ipcRenderer.invoke('desktop-automation:credentials'),
  executor: () => ipcRenderer.invoke('desktop-automation:executor'),
  state: state => ipcRenderer.invoke('desktop-automation:state', state),
}
contextBridge.exposeInMainWorld('termousDesktopAutomation', bridge)

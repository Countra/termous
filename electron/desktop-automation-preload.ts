import { contextBridge, ipcRenderer } from 'electron'
import { isDesktopPointerEvent, type DesktopAutomationBridge } from '#common/contracts'

const bridge: DesktopAutomationBridge = {
  pointer: () => ipcRenderer.invoke('desktop-automation:pointer'),
  onPointer(listener) {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => { if (isDesktopPointerEvent(value)) listener(value) }
    ipcRenderer.on('desktop-automation:pointer', receive)
    return () => { ipcRenderer.removeListener('desktop-automation:pointer', receive) }
  },
  bootstrap: () => ipcRenderer.invoke('desktop-automation:bootstrap'),
  credentials: () => ipcRenderer.invoke('desktop-automation:credentials'),
  executor: () => ipcRenderer.invoke('desktop-automation:executor'),
  state: state => ipcRenderer.invoke('desktop-automation:state', state),
}
contextBridge.exposeInMainWorld('termousDesktopAutomation', bridge)

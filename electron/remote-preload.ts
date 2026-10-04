import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RemoteBootstrap, RemoteWindowBridge } from '#common/contracts'

const bridge: RemoteWindowBridge = {
  bootstrap: () => ipcRenderer.invoke('remote:bootstrap'),
  connection: () => ipcRenderer.invoke('remote:connection'),
  request: request => ipcRenderer.invoke('remote:request', request),
  selectTransfer: input => ipcRenderer.invoke('remote:select-transfer', input),
  localTransfers: () => ipcRenderer.invoke('remote:local-transfers'),
  localTransferAction: (id, action) => ipcRenderer.invoke('remote:local-transfer-action', id, action),
  send: data => ipcRenderer.invoke('remote:send', data),
  consume: sequence => ipcRenderer.send('remote:consume', sequence),
  disconnect: () => ipcRenderer.invoke('remote:disconnect'),
  close: () => ipcRenderer.invoke('remote:close'),
  subscribe: (callback, closed) => {
    let active = true
    const frame = (_event: IpcRendererEvent, sequence: number, data: Uint8Array) => { if (active) callback(sequence, data) }
    const stopped = () => { if (active) closed() }
    ipcRenderer.on('remote:frame', frame)
    ipcRenderer.on('remote:stream-closed', stopped)
    void ipcRenderer.invoke('remote:subscribe').then(result => { if (!result.ok) stopped() }).catch(stopped)
    return () => { active = false; ipcRenderer.removeListener('remote:frame', frame); ipcRenderer.removeListener('remote:stream-closed', stopped) }
  },
  onAppearance: callback => {
    const listener = (_event: IpcRendererEvent, value: RemoteBootstrap) => callback(value)
    ipcRenderer.on('remote:appearance', listener)
    return () => ipcRenderer.removeListener('remote:appearance', listener)
  },
}

contextBridge.exposeInMainWorld('termousRemote', bridge)

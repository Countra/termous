import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RemoteBootstrap, RemoteWindowBridge } from '#common/contracts'

const bridge: RemoteWindowBridge = {
  bootstrap: () => ipcRenderer.invoke('remote:bootstrap'),
  connection: () => ipcRenderer.invoke('remote:connection'),
  reconnect: () => ipcRenderer.invoke('remote:reconnect'),
  request: (request, id) => ipcRenderer.invoke('remote:request', request, id),
  selectTransfer: (input, id) => ipcRenderer.invoke('remote:select-transfer', input, id),
  localTransfers: id => ipcRenderer.invoke('remote:local-transfers', id),
  localTransferAction: (id, action, connection) => ipcRenderer.invoke('remote:local-transfer-action', id, action, connection),
  send: (data, id) => ipcRenderer.invoke('remote:send', data, id),
  consume: (sequence, id) => ipcRenderer.send('remote:consume', sequence, id),
  disconnect: () => ipcRenderer.invoke('remote:disconnect'),
  close: () => ipcRenderer.invoke('remote:close'),
  subscribe: (callback, closed, connectionId) => {
    let active = true
    const frame = (_event: IpcRendererEvent, id: string, sequence: number, data: Uint8Array) => { if (active && id === connectionId) callback(sequence, data) }
    const stopped = (_event?: IpcRendererEvent, id = connectionId) => { if (active && id === connectionId) closed() }
    ipcRenderer.on('remote:frame', frame)
    ipcRenderer.on('remote:stream-closed', stopped)
    void ipcRenderer.invoke('remote:subscribe', connectionId).then(result => { if (!result.ok) stopped() }).catch(() => stopped())
    return () => { active = false; ipcRenderer.removeListener('remote:frame', frame); ipcRenderer.removeListener('remote:stream-closed', stopped) }
  },
  onAppearance: callback => {
    const listener = (_event: IpcRendererEvent, value: RemoteBootstrap) => callback(value)
    ipcRenderer.on('remote:appearance', listener)
    return () => ipcRenderer.removeListener('remote:appearance', listener)
  },
}

contextBridge.exposeInMainWorld('termousRemote', bridge)

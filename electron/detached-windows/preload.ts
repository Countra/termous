import { ipcRenderer } from 'electron'
import { detachedChannels as channels, type DetachedOwnerBridge, type DetachedWindowBridge, type DetachedPacket } from '#common/contracts'

function subscribe(listener: (packet: DetachedPacket) => void) {
  const handler = (_event: Electron.IpcRendererEvent, packet: DetachedPacket) => listener(packet)
  ipcRenderer.on(channels.packet, handler)
  return () => ipcRenderer.removeListener(channels.packet, handler)
}

export function createDetachedOwnerBridge(): DetachedOwnerBridge {
  return {
    open: (identity, rect) => ipcRenderer.invoke(channels.open, identity, rect),
    focus: identity => ipcRenderer.invoke(channels.focus, identity),
    close: connection => ipcRenderer.invoke(channels.close, connection),
    reveal: () => ipcRenderer.invoke(channels.reveal),
    send: packet => ipcRenderer.send(channels.packet, packet), subscribe,
  }
}

export function createDetachedWindowBridge(): DetachedWindowBridge {
  return { bootstrap: () => ipcRenderer.invoke(channels.bootstrap), send: packet => ipcRenderer.send(channels.packet, packet), subscribe }
}

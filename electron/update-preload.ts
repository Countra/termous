import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  TermousUpdateWindowBridge,
  UpdateInstallSummaryState,
  UpdateSnapshot,
  UpdateWindowBootstrap,
} from '#common/contracts'

export type { TermousUpdateWindowBridge } from '#common/contracts'

const bridge = {
  getBootstrap: () => ipcRenderer.invoke('app-update:window-bootstrap'),
  getState: () => ipcRenderer.invoke('app-update:get-state'),
  getApplicationInfo: () => ipcRenderer.invoke('app-update:get-application-info'),
  check: () => ipcRenderer.invoke('app-update:check'),
  download: () => ipcRenderer.invoke('app-update:download'),
  cancelDownload: () => ipcRenderer.invoke('app-update:cancel-download'),
  prepareInstall: () => ipcRenderer.invoke('app-update:prepare-install'),
  install: (confirmationToken) => ipcRenderer.invoke('app-update:install', confirmationToken),
  minimize: () => ipcRenderer.invoke('app-update:window-minimize'),
  close: () => ipcRenderer.invoke('app-update:window-close'),
  onInstallSummaryChanged: (callback) => {
    const listener = (
      _event: IpcRendererEvent,
      state: UpdateInstallSummaryState,
    ) => callback(state)
    ipcRenderer.on('app-update:install-summary-changed', listener)
    return () => ipcRenderer.removeListener('app-update:install-summary-changed', listener)
  },
  onBootstrapChanged: (callback) => {
    const listener = (
      _event: IpcRendererEvent,
      bootstrap: UpdateWindowBootstrap<UpdateSnapshot>,
    ) => callback(bootstrap)
    ipcRenderer.on('app-update:window-bootstrap-changed', listener)
    return () => ipcRenderer.removeListener('app-update:window-bootstrap-changed', listener)
  },
  subscribe: (callback) => {
    let active = true
    let stateSequence = -1
    const merge = (snapshot: UpdateSnapshot) => {
      if (!active || snapshot.state_seq < stateSequence) {
        return
      }
      stateSequence = snapshot.state_seq
      callback(snapshot)
    }
    const listener = (_event: IpcRendererEvent, snapshot: UpdateSnapshot) => {
      merge(snapshot)
    }
    ipcRenderer.on('app-update:state-changed', listener)
    void ipcRenderer.invoke('app-update:subscribe')
      .then((snapshot: UpdateSnapshot) => merge(snapshot))
      .catch(() => {
        console.error('[termous:update] 无法订阅更新状态')
      })
    return () => {
      active = false
      ipcRenderer.removeListener('app-update:state-changed', listener)
      void ipcRenderer.invoke('app-update:unsubscribe').catch(() => {
        console.error('[termous:update] 无法注销更新状态订阅')
      })
    }
  },
} satisfies TermousUpdateWindowBridge

contextBridge.exposeInMainWorld('termousUpdate', bridge)

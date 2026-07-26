import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { UpdateInstallConfirmation } from './updateRuntime'
import type { UpdateInstallSummaryState } from './updateInstallConfirmation'
import type { UpdateWindowBootstrap } from './updateWindow'
import type {
  UpdateApplicationInfo,
  UpdateSnapshot,
} from './updateTypes'

export interface TermousUpdateWindowBridge {
  cancelDownload(): Promise<UpdateSnapshot>
  check(): Promise<UpdateSnapshot>
  close(): Promise<boolean>
  download(): Promise<UpdateSnapshot>
  getApplicationInfo(): Promise<UpdateApplicationInfo>
  getBootstrap(): Promise<UpdateWindowBootstrap<UpdateSnapshot>>
  getState(): Promise<UpdateSnapshot>
  install(confirmationToken: string): Promise<UpdateSnapshot>
  minimize(): Promise<boolean>
  onInstallSummaryChanged(callback: (state: UpdateInstallSummaryState) => void): () => void
  onBootstrapChanged(callback: (bootstrap: UpdateWindowBootstrap<UpdateSnapshot>) => void): () => void
  prepareInstall(): Promise<UpdateInstallConfirmation>
  subscribe(callback: (snapshot: UpdateSnapshot) => void): () => void
}

const bridge: TermousUpdateWindowBridge = {
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
}

contextBridge.exposeInMainWorld('termousUpdate', bridge)

declare global {
  interface Window {
    termousUpdate?: TermousUpdateWindowBridge
  }
}

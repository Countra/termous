import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('termous', {
  getConfig: () =>
    Promise.resolve({
      apiBaseUrl: process.env.TERMOUS_API_BASE_URL ?? 'http://127.0.0.1:8122',
      apiToken: process.env.TERMOUS_API_TOKEN ?? (process.env.NODE_ENV === 'development' ? 'dev-token' : ''),
    }),
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
    onMaximizeState: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
      ipcRenderer.on('window:maximize-state', listener)
      return () => ipcRenderer.removeListener('window:maximize-state', listener)
    },
  },
})

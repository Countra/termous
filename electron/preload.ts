import { clipboard, contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('termous', {
  getConfig: () =>
    Promise.resolve({
      apiBaseUrl: process.env.TERMOUS_API_BASE_URL ?? 'http://127.0.0.1:8122',
      apiToken: process.env.TERMOUS_API_TOKEN ?? (process.env.NODE_ENV === 'development' ? 'dev-token' : ''),
    }),
  platform: process.platform,
  clipboard: {
    readText: () => Promise.resolve(clipboard.readText()),
    writeText: (text: string) => {
      clipboard.writeText(text)
      return Promise.resolve(true)
    },
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
    requestClose: () => ipcRenderer.invoke('window:request-close'),
    confirmClose: () => ipcRenderer.invoke('window:confirm-close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
    onMaximizeState: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
      ipcRenderer.on('window:maximize-state', listener)
      return () => ipcRenderer.removeListener('window:maximize-state', listener)
    },
    onCloseRequest: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('window:close-requested', listener)
      return () => ipcRenderer.removeListener('window:close-requested', listener)
    },
  },
})

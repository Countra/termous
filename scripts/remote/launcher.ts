import { contextBridge, ipcRenderer } from 'electron'
// 仅验收进程加载，不进入产品构建。
contextBridge.exposeInMainWorld('acceptance', { call: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) })

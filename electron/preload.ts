import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import { fileURLToPath } from 'node:url'

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.map((item) => item.trim()).filter(Boolean)))
}

function parseWindowsFileNameBuffer(buffer: Buffer) {
  if (buffer.length === 0) {
    return []
  }
  return uniquePaths(buffer.toString('utf16le').split('\u0000'))
}

function parseFileUriText(text: string) {
  const paths: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim()
    if (!value || value.startsWith('#') || !value.startsWith('file://')) {
      continue
    }
    try {
      paths.push(fileURLToPath(value))
    } catch {
      // 剪贴板来源不可控，无法解析的 file URI 直接忽略。
    }
  }
  return uniquePaths(paths)
}

function readClipboardFilePaths() {
  const formats = clipboard.availableFormats()
  const paths: string[] = []
  if (formats.includes('FileNameW')) {
    paths.push(...parseWindowsFileNameBuffer(clipboard.readBuffer('FileNameW')))
  }
  paths.push(...parseFileUriText(clipboard.readText()))
  return uniquePaths(paths)
}

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
  files: {
    pickPaths: (options?: { mode?: 'files' | 'directories' | 'files-and-directories'; multiple?: boolean }) =>
      ipcRenderer.invoke('files:pick-paths', options) as Promise<string[]>,
    pickFiles: () => ipcRenderer.invoke('files:pick-paths', { mode: 'files', multiple: true }) as Promise<string[]>,
    pickDirectory: () =>
      ipcRenderer.invoke('files:pick-paths', { mode: 'directories', multiple: false }) as Promise<string[]>,
    pathsFromFileList: (files: ArrayLike<File>) => {
      const paths = Array.from(files)
        .map((file) => webUtils.getPathForFile(file))
        .filter(Boolean)
      return Promise.resolve(uniquePaths(paths))
    },
    readClipboardFilePaths: () => Promise.resolve(readClipboardFilePaths()),
  },
})

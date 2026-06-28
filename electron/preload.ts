import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import { fileURLToPath } from 'node:url'

const droppedFilePathTTL = 5000

let recentDroppedFiles = {
  paths: [] as string[],
  fileCount: 0,
  capturedAt: 0,
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.map((item) => item.trim()).filter(Boolean)))
}

function fileListToPaths(files: ArrayLike<File>) {
  return uniquePaths(
    Array.from(files)
      .map((file) => webUtils.getPathForFile(file))
      .filter(Boolean),
  )
}

function cacheDroppedFilePaths(event: DragEvent) {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
    return
  }
  event.preventDefault()
  const files = event.dataTransfer?.files ?? []
  const uriText = [
    event.dataTransfer?.getData('text/uri-list') ?? '',
    event.dataTransfer?.getData('text/plain') ?? '',
  ].join('\n')
  recentDroppedFiles = {
    paths: uniquePaths([...fileListToPaths(files), ...parseFileUriText(uriText)]),
    fileCount: files.length,
    capturedAt: Date.now(),
  }
}

function consumeRecentDroppedPaths(fileCount: number) {
  const snapshot = recentDroppedFiles
  if (Date.now() - snapshot.capturedAt > droppedFilePathTTL || snapshot.fileCount !== fileCount) {
    return []
  }
  recentDroppedFiles = { paths: [], fileCount: 0, capturedAt: 0 }
  return uniquePaths(snapshot.paths)
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

function preventFileDropNavigation(event: DragEvent) {
  if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
    event.preventDefault()
  }
}

window.addEventListener('dragover', preventFileDropNavigation, true)
window.addEventListener('drop', cacheDroppedFilePaths, true)

contextBridge.exposeInMainWorld('termous', {
  getConfig: () => ipcRenderer.invoke('core:get-config'),
  getBuildInfo: async () => {
    const config = await ipcRenderer.invoke('core:get-config')
    return { version: config?.version ?? process.env.VITE_TERMOUS_APP_VERSION ?? '0.0.0-dev' }
  },
  platform: process.platform,
  core: {
    status: () => ipcRenderer.invoke('core:status'),
    shutdown: () => ipcRenderer.invoke('core:shutdown') as Promise<boolean>,
    getFatal: () => ipcRenderer.invoke('core:get-fatal'),
    onFatal: (callback: (event: { title: string; message: string; code: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, fatal: { title: string; message: string; code: string }) => callback(fatal)
      ipcRenderer.on('core:fatal', listener)
      return () => ipcRenderer.removeListener('core:fatal', listener)
    },
  },
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
      const paths = fileListToPaths(files)
      return Promise.resolve(paths.length > 0 ? paths : consumeRecentDroppedPaths(files.length))
    },
    consumeDroppedFilePaths: (fileCount?: number) => {
      if (typeof fileCount === 'number') {
        return Promise.resolve(consumeRecentDroppedPaths(fileCount))
      }
      const snapshot = recentDroppedFiles
      recentDroppedFiles = { paths: [], fileCount: 0, capturedAt: 0 }
      return Promise.resolve(uniquePaths(snapshot.paths))
    },
    readClipboardFilePaths: () => Promise.resolve(readClipboardFilePaths()),
  },
})

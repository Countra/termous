import { ipcRenderer } from 'electron'
import { workflowExchangeChannels as channels, type WorkflowFileBridge, type WorkflowFileProgress } from '#common/contracts'

export function createWorkflowFileBridge(): WorkflowFileBridge {
  return {
    run: request => ipcRenderer.invoke(channels.run, request),
    cancel: id => ipcRenderer.invoke(channels.cancel, id),
    onProgress: listener => {
      const receive = (_event: Electron.IpcRendererEvent, value: WorkflowFileProgress) => listener(value)
      ipcRenderer.on(channels.progress, receive)
      return () => ipcRenderer.removeListener(channels.progress, receive)
    },
  }
}

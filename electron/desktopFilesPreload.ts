import { ipcRenderer, webUtils } from 'electron'
import type { DesktopFileBridge, SystemFileClipboardContext } from '#common/contracts'

// 只消费真实系统拖放得到的路径，renderer 不能通过桥接提交任意路径。
export function createDesktopFileBridge(): DesktopFileBridge {
  let dropped: { paths: string[]; at: number; session: string } | undefined
  window.addEventListener('dragover', event => {
    if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
  }, true)
  window.addEventListener('drop', event => {
    if (!event.isTrusted || !event.dataTransfer?.files.length) return
    const session = (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-termous-desktop-session]') : null)?.dataset.termousDesktopSession
    if (!session) { dropped = undefined; return }
    event.preventDefault()
    const paths = Array.from(event.dataTransfer.files).map(file => webUtils.getPathForFile(file)).filter(Boolean)
    dropped = { paths: [...new Set(paths)], at: Date.now(), session }
  }, true)
  return {
    configure: (context, focused, action) => ipcRenderer.invoke('desktop-files:configure', context, focused, action),
    importClipboard: context => ipcRenderer.invoke('desktop-files:import', context),
    consumeDrop: (context: SystemFileClipboardContext) => {
      const selection = dropped
      dropped = undefined
      return ipcRenderer.invoke('desktop-files:drop', context, selection && selection.session === context.sessionId && Date.now() - selection.at < 5000 ? selection.paths : [])
    },
    releaseSelection: id => ipcRenderer.invoke('desktop-files:release', id),
  }
}

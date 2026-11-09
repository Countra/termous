import { app, type BrowserWindow } from 'electron'

// 只在隔离验收窗口记录资源；不强制 GC，也不改变生产组件的释放逻辑。
export async function analysisResourceProbe(window: BrowserWindow) {
  const contents = window.webContents
  await contents.executeJavaScript(`(() => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL, active = new Set();
    let created = 0, released = 0;
    URL.createObjectURL = function (...args) { const url = create.apply(this, args); active.add(url); created++; return url };
    URL.revokeObjectURL = function (url) { if (active.delete(url)) released++; return revoke.call(this, url) };
    window.__analysisResourceProbe = {
      snapshot: () => ({ activeURLs: active.size, created, released, nodes: document.querySelectorAll('*').length }),
      dispose: () => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; delete window.__analysisResourceProbe }
    };
  })()`)
  contents.debugger.attach('1.3')
  return {
    sample: async (cycle: number) => {
      const [resources, heap, dom] = await Promise.all([
        contents.executeJavaScript('window.__analysisResourceProbe.snapshot()'),
        contents.debugger.sendCommand('Runtime.getHeapUsage'),
        contents.debugger.sendCommand('Memory.getDOMCounters'),
      ])
      const memory = app.getAppMetrics().find(item => item.pid === contents.getOSProcessId())?.memory
      return { cycle, ...resources, heap, dom, memory }
    },
    close: async () => {
      contents.debugger.detach()
      await contents.executeJavaScript('window.__analysisResourceProbe.dispose()')
    },
  }
}

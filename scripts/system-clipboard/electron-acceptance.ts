import assert from 'node:assert/strict'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { ClipboardCapabilitiesClient } from '../../electron/system-clipboard/client.ts'
import { registerClipboardCapabilitiesIPC } from '../../electron/system-clipboard/ipc.ts'
import type { SystemClipboardConnectionState } from '#common/contracts'

const output = process.argv[2]!
app.setPath('userData', path.resolve(output, '../electron'))
app.setPath('sessionData', path.resolve(output, '../electron'))

async function main() {
  await app.whenReady()
  const client = new ClipboardCapabilitiesClient(async () => { throw new Error('夹具不启动 Core') })
  const windows: BrowserWindow[] = []
  const dispose = registerClipboardCapabilitiesIPC(ipcMain, client, event => windows.some(window => !window.isDestroyed() && window.webContents === event.sender && event.senderFrame === event.sender.mainFrame))
  try {
    for (let i = 0; i < 2; i++) {
      const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(output, 'preload.cjs') } })
      windows.push(window)
      await window.loadURL('data:text/html;charset=utf-8,<title>Clipboard capability acceptance</title>')
      const initial = await window.webContents.executeJavaScript('(async () => { window.lastCapability = await window.clipboardCapabilities.get(); window.stopCapability = window.clipboardCapabilities.subscribe(value => { window.lastCapability = value }); return window.lastCapability })()') as SystemClipboardConnectionState
      assert.equal(initial.status, 'loading')
    }
    const read = (window: BrowserWindow) => window.webContents.executeJavaScript('window.lastCapability') as Promise<SystemClipboardConnectionState>
    const wait = async (predicate: () => Promise<boolean>) => {
      for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
      throw new Error('Electron 能力广播超时')
    }
    client.state.accept({ schema_version: 1, instance_id: 'native-ipc-fixture', revision: 1, capabilities: { import_files: { state: 'ready' }, publish_files: { state: 'ready' } } })
    await wait(async () => (await Promise.all(windows.map(read))).every(state => state.status === 'connected'))
    client.state.offline()
    await wait(async () => (await Promise.all(windows.map(read))).every(state => state.status === 'disconnected' && state.snapshot?.capabilities.publish_files.state === 'ready'))
    windows[0]!.destroy()
    client.state.accept({ schema_version: 1, instance_id: 'restarted', revision: 1, capabilities: { import_files: { state: 'ready' }, publish_files: { state: 'unsupported', reason: 'platform_unsupported' } } })
    await wait(async () => (await read(windows[1]!)).snapshot?.instance_id === 'restarted')
    await windows[1]!.webContents.executeJavaScript('window.stopCapability()')
    console.log('Electron 验收通过：真实 preload/IPC、双窗口广播、断线保留、实例恢复、窗口关闭清理。')
  } finally { dispose(); for (const window of windows) if (!window.isDestroyed()) window.destroy() }
}
void main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })

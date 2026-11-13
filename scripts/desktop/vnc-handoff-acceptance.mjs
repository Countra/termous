import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const output = process.argv[2]
if (!output || !path.isAbsolute(output)) throw new Error('必须提供隔离验收目录')
app.setPath('userData', path.join(output, 'electron-profile'))
await mkdir(output, { recursive: true })
// ESM 入口必须先完成求值，Electron 才会发出 ready；不能在顶层等待 whenReady。
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const timeout = setTimeout(() => { console.error('Electron 画面验收超时'); app.exit(1) }, 90_000)
  window.webContents.on('console-message', event => console.log(event.message))
  try {
    await window.loadURL('http://127.0.0.1:5191/scripts/desktop/remote-fixture.html?existing=1')
    const deadline = Date.now() + 90_000
    for (;;) {
      const result = await window.webContents.executeJavaScript("document.querySelector('#result')?.textContent ?? ''")
      if (result.startsWith('FAILED:')) throw new Error(result)
      if (result.includes('"passed": true')) {
        // 保存已断言的控制端画布；隐藏窗口的合成截图可能仍停留在上一次绘制。
        const frame = await window.webContents.executeJavaScript("document.querySelector('#desktop')?.dataset.lastFrame")
        const prefix = 'data:image/png;base64,'
        if (typeof frame !== 'string' || !frame.startsWith(prefix)) throw new Error('缺少控制端画面证据')
        await writeFile(path.join(output, 'result.json'), result)
        await writeFile(path.join(output, 'viewer.png'), Buffer.from(frame.slice(prefix.length), 'base64'))
        console.log(result)
        break
      }
      if (Date.now() >= deadline) throw new Error(`画面验收超时: ${result}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    clearTimeout(timeout)
    window.destroy()
    app.exit(0)
  } catch (error) {
    clearTimeout(timeout)
    console.error(error)
    window.destroy()
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })

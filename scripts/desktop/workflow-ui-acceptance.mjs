import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

async function main() {
const output = fileURLToPath(new URL('../../../TEMP/runtime/desktop-workflow/ui/', import.meta.url))
await mkdir(output, { recursive: true })
app.setPath('userData', path.join(output, 'electron'))
await app.whenReady()
app.on('window-all-closed', () => {})
console.log('界面夹具已就绪')
const errors = []
try {
  for (const [theme, width] of [['dark', 1500], ['light', 1500], ['dark', 860]]) {
    const window = new BrowserWindow({ width, height: 900, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    window.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('WebSocket') && !message.includes('ERR_UNSAFE_PORT')) errors.push(message) })
    const timeout = setTimeout(() => { console.error('界面加载超时'); app.exit(1) }, 30_000)
    await window.loadURL(`http://127.0.0.1:5196/scripts/desktop/workflow-ui.html?${theme}`)
    console.log(`已加载 ${theme}/${width}`)
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      let tries = 0; const tick = setInterval(() => {
        const item = [...document.querySelectorAll('button')].find(el => el.textContent.includes('登录界面回归'));
        if (item) { clearInterval(tick); item.click(); setTimeout(() => { [...document.querySelectorAll('button')].find(el => el.textContent.includes('点击登录'))?.click(); resolve(true) }, 200) }
        else if (++tries > 100) { clearInterval(tick); reject(new Error('脚本列表未渲染')) }
      }, 100)
    })`)
    await new Promise(resolve => setTimeout(resolve, 400))
    const overflow = await window.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth')
    if (overflow) errors.push(`${theme}/${width}: 页面水平溢出`)
    await writeFile(path.join(output, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
    clearTimeout(timeout)
    window.destroy()
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: errors.length === 0, errors }, null, 2))
} catch (error) { console.error(error); errors.push(String(error)) }
finally { app.exit(errors.length ? 1 : 0) }

}
void main().catch(error => { console.error(error); app.exit(1) })

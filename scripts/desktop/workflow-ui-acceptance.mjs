import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

async function main() {
const analysis = process.argv.includes('--analyses')
const output = fileURLToPath(new URL(analysis ? '../../build/analysis-center-ui/' : '../../../TEMP/runtime/desktop-workflow/ui/', import.meta.url))
await mkdir(output, { recursive: true })
app.setPath('userData', path.join(output, 'electron'))
await app.whenReady()
app.on('window-all-closed', () => {})
console.log('界面夹具已就绪')
const errors = []
try {
  for (const [theme, width] of [['dark', 1500], ['light', 1500], ['dark', 860]]) {
    const window = new BrowserWindow({ width, height: 900, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: analysis } })
    window.webContents.on('console-message', ({ level, message }) => { if (level === 'error' && !message.includes('WebSocket') && !message.includes('ERR_UNSAFE_PORT')) errors.push(message) })
    const timeout = setTimeout(() => { console.error('界面加载超时'); app.exit(1) }, 30_000)
    await window.loadURL(`http://127.0.0.1:5196/scripts/desktop/workflow-ui.html?${theme}${analysis ? '&analyses' : ''}`)
    if (analysis) {
      // 隔离窗口保持隐藏；仅在合成页面模拟可见页，驱动生产组件的按需读取。
      await window.webContents.executeJavaScript(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange'))`)
    }
    console.log(`已加载 ${theme}/${width}`)
    await window.webContents.executeJavaScript(analysis ? `new Promise((resolve, reject) => {
      let tries = 0; const tick = setInterval(() => {
        const item = [...document.querySelectorAll('button')].find(el => el.textContent.includes('本地工作站'));
        if (item) { clearInterval(tick); item.click(); resolve(true) }
        else if (++tries > 100) { clearInterval(tick); reject(new Error('分析列表未渲染')) }
      }, 100)
    })` : `new Promise((resolve, reject) => {
      let tries = 0; const tick = setInterval(() => {
        const item = [...document.querySelectorAll('button')].find(el => el.textContent.includes('登录界面回归'));
        if (item) { clearInterval(tick); item.click(); setTimeout(() => { [...document.querySelectorAll('button')].find(el => el.textContent.includes('点击登录'))?.click(); resolve(true) }, 200) }
        else if (++tries > 100) { clearInterval(tick); reject(new Error('脚本列表未渲染')) }
      }, 100)
    })`)
    await new Promise(resolve => setTimeout(resolve, 400))
    if (analysis) {
      await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        let tries = 0; const tick = setInterval(() => {
          const item = document.querySelector('button[role="option"]');
          const image = document.querySelector('img[alt="分析原图"]');
          if (item && image?.complete && image.naturalWidth > 0) { clearInterval(tick); item.click(); resolve(true) }
          else if (++tries > 100) { clearInterval(tick); reject(new Error('分析元素未渲染')) }
        }, 100)
      })`)
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    const overflow = await window.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth')
    if (overflow) errors.push(`${theme}/${width}: 页面水平溢出`)
    // 截图不切换可见性，避免验收过程触发页面轮询的暂停与补读。
    await writeFile(path.join(output, `${theme}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    clearTimeout(timeout)
    window.destroy()
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: errors.length === 0, errors }, null, 2))
} catch (error) { console.error(error); errors.push(String(error)) }
finally { app.exit(errors.length ? 1 : 0) }

}
void main().catch(error => { console.error(error); app.exit(1) })

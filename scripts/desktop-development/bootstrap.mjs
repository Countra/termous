import { app, dialog } from 'electron'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const metadata = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
if (metadata.termousDesktopChannel !== 'development') throw new Error('开发壳渠道无效，请重新运行 pnpm dev')

if (process.argv.includes('--termous-development-start') && typeof process.send === 'function') {
  const server = new URL(process.env.VITE_DEV_SERVER_URL)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(server.hostname) || server.protocol !== 'http:') throw new Error('开发页面必须使用本机 Vite 服务')
  // Vite 被终端中断时也退出所属开发壳，不能遗留仍持有单实例锁的窗口。
  process.once('disconnect', () => app.exit(0))
  // 入口只保存源码位置；启动环境和 API 令牌不写入开发壳。
  import(pathToFileURL(metadata.termousDevelopmentEntry).href).catch(error => {
    console.error('Termous Dev 启动失败：', error)
    app.exit(1)
  })
} else {
  const userData = path.join(app.getPath('appData'), metadata.productName)
  mkdirSync(userData, { recursive: true })
  app.setName(metadata.productName)
  app.setPath('userData', userData)
  app.setPath('sessionData', userData)
  if (!app.requestSingleInstanceLock()) app.exit(0)
  else void app.whenReady().then(async () => {
    await dialog.showMessageBox({ type: 'info', title: metadata.productName, message: '开发环境尚未启动', detail: '请在 web 目录运行 pnpm dev。', buttons: ['知道了'] })
    app.quit()
  })
}

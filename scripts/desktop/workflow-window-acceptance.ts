import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow } from 'electron'
import { DetachedWindows } from '../../electron/detached-windows/manager.ts'

async function main() {
  const output = path.resolve(process.argv[2])
  const production = process.argv.includes('--production')
  app.setPath('userData', path.join(output, 'workflow-user-data'))
  await app.whenReady()
  const errors: string[] = []
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  })
  const host = new BrowserWindow({ width: 1440, height: 1000, show: true, webPreferences: {
    preload: path.join(output, 'host-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
  } })
  const manager = new DetachedWindows({ host: () => host, trusted: event => event.sender === host.webContents && event.senderFrame === host.webContents.mainFrame,
    reveal: () => { if (host.isMinimized()) host.restore(); host.show() }, appearance: () => ({ theme: 'dark', language: 'zh-CN' }),
    renderer: path.resolve('dist/index.html'), devURL: production ? undefined : 'http://127.0.0.1:5183/',
    preload: production ? path.resolve('dist-electron/detached-preload.cjs') : path.join(output, 'detached-preload.cjs'),
  })
  const child = () => BrowserWindow.getAllWindows().find(window => window !== host)
  const js = (window: BrowserWindow, script: string) => window.webContents.executeJavaScript(script)
  const until = async (check: () => boolean | Promise<boolean>, message: string) => {
    const deadline = Date.now() + 25000
    while (!await check()) { assert(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  const click = async (window: BrowserWindow, label: string) => {
    const value = JSON.stringify(label)
    assert(await js(window, `(()=>{const node=[...document.querySelectorAll('button,[role="menuitem"]')].find(node=>node.getAttribute('aria-label')===${value}||node.textContent.trim()===${value});if(!node||node.disabled||node.getAttribute('aria-disabled')==='true')return false;node.click();return true})()`), `按钮不可用：${label}`)
  }
  const name = (window: BrowserWindow) => js(window, `document.querySelector('input[aria-label="流程名称"]')?.value??document.querySelector('button[aria-label="编辑流程名称"]')?.textContent.trim()`)
  const rename = async (window: BrowserWindow, value: string) => {
    if (!await js(window, `!!document.querySelector('input[aria-label="流程名称"]')`)) await click(window, '编辑流程名称')
    await js(window, `(()=>{const input=document.querySelector('input[aria-label="流程名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await until(async () => await name(window) === value, '输入未更新')
  }
  const open = async () => {
    await click(host, '在独立窗口打开')
    await until(() => !!child()?.isVisible(), '独立窗口未就绪')
    const window = child()!
    await until(() => js(window, `!!document.querySelector('button[aria-label="返回主窗口"]')&&!document.body.inert`), '独立视图未取得编辑权')
    return window
  }
  try {
    if (production) await host.loadFile(path.join(output, 'workflow-fixture/scripts/desktop/workflow-window-preview.html'))
    else await host.loadURL('http://127.0.0.1:5183/scripts/desktop/workflow-window-preview.html')
    await until(() => js(host, `!![...document.querySelectorAll('button')].find(node=>node.textContent.includes('发布前环境检查'))`), '自动化流程库未加载')
    await js(host, `[...document.querySelectorAll('button')].find(node=>node.textContent.includes('发布前环境检查')).click()`)
    await until(async () => !!await name(host), '脚本未加载')
    await rename(host, '窗口交接中的未保存草稿')
    const detached = await open()
    assert.equal(await name(detached), '窗口交接中的未保存草稿')
    await click(detached, '更多操作')
    await until(() => js(detached, `!!document.querySelector('[role="menuitem"]')`), '操作菜单未展开')
    await click(detached, '校验')
    await until(() => js(detached, `!!document.querySelector('.ant-message-notice-success')`), '独立窗口校验没有显示消息提示')
    assert(await js(detached, `![...document.querySelectorAll('main')].some(node=>node.textContent.includes('结构校验通过'))`), '校验提示不应占据编排区域')
    assert.equal(await js(detached, 'typeof window.termous'), 'undefined')
    assert.equal(host.webContents.getBackgroundThrottling(), false)
    await js(host, `window.termous.detachedWindows.open({module:'desktop-workflow',instance:'workspace'})`)
    assert.equal(BrowserWindow.getAllWindows().length, 2)
    await until(() => js(detached, `!!document.querySelector('img[alt="只读桌面截图"]')?.naturalWidth`), '受限二进制截图未显示')
    await until(() => js(detached, `document.getAnimations().every(animation=>animation.playState!=='running')`), '窗口入场动画没有结束')
    await writeFile(path.join(output, 'workflow-detached-dark.png'), (await detached.webContents.capturePage()).toPNG())
    await writeFile(path.join(output, 'workflow-host-placeholder.png'), (await host.webContents.capturePage()).toPNG())
    await click(host, '主题')
    await click(host, '语言')
    await until(() => js(detached, `document.documentElement.dataset.theme==='light'&&!!document.querySelector('button[aria-label="Edit flow name"]')`), '主题语言未同步')
    detached.setSize(720, 700)
    await until(() => js(detached, `!!document.querySelector('[data-narrow="true"]')&&!!document.querySelector('button[aria-label="Expand library"]')&&document.documentElement.scrollWidth<=innerWidth`), '窄窗布局没有完成重排')
    await writeFile(path.join(output, 'workflow-detached-narrow-light.png'), (await detached.webContents.capturePage()).toPNG())
    detached.setSize(1440, 900)
    await click(host, '主题')
    await click(host, '语言')
    await until(() => js(detached, `document.documentElement.dataset.theme==='dark'&&!!document.querySelector('button[aria-label="编辑流程名称"]')`), '恢复主题语言失败')
    host.minimize(); await rename(detached, '最小化后继续编辑')
    host.hide(); await rename(detached, '隐藏后继续编辑')
    await click(host, '切换页面')
    await click(detached, '返回主窗口')
    await until(() => js(host, `document.body.textContent.includes('离开未保存的页面？')`), '返回没有经过导航守卫')
    await click(host, '继续编辑')
    await rename(detached, '取消返回后继续编辑')
    assert(!detached.isDestroyed())
    detached.close()
    await until(() => detached.isDestroyed(), '原生关闭没有完成交接')
    assert(await js(host, `!![...document.querySelectorAll('p')].find(node=>node.textContent==='模拟主页面：有未保存的修改')`), '原生关闭错误地发起页面导航')
    await click(host, '切换页面')
    assert.equal(await name(host), '取消返回后继续编辑')
    assert.equal(host.webContents.getBackgroundThrottling(), true)
    const second = await open()
    await rename(second, '点击返回后保留')
    await click(second, '返回主窗口')
    await until(() => second.isDestroyed(), '返回按钮没有收回窗口')
    assert.equal(await name(host), '点击返回后保留')
    await click(host, '保存')
    await until(() => js(host, `![...document.querySelectorAll('button')].find(node=>node.textContent.trim()==='运行')?.disabled`), '保存后不能启动')
    const third = await open()
    await click(third, '运行')
    await until(() => js(third, `!!document.querySelector('[role=dialog]')`), '运行配置未打开')
    third.close()
    await until(() => third.isDestroyed(), '运行配置交接没有完成')
    await until(() => js(host, `!!document.querySelector('[role=dialog]')`), '关闭后运行配置丢失')
    const dialogRun = `(()=>{const button=[...document.querySelectorAll('[role=dialog] button')].find(node=>node.getBoundingClientRect().width>0&&node.textContent.replace(/\\s/g,'')==='运行');if(!button||button.disabled)throw new Error('运行确认按钮不可用');button.click()})()`
    await js(host, dialogRun)
    await until(() => js(host, `document.body.textContent.includes('已暂停')`), '运行结果未进入报告')
    const fourth = await open()
    await click(fourth, '单步')
    await until(() => js(fourth, `document.body.textContent.includes('已执行 1 步')`), '跨窗口单步没有确认')
    await click(fourth, '全部展开')
    await until(() => js(fourth, `document.body.textContent.includes('动作配置 · 固定版本')`), '固定版本动作详情未加载')
    await click(fourth, '返回主窗口')
    await until(() => fourth.isDestroyed(), '执行中返回失败')
    assert(await js(host, `document.body.textContent.includes('已执行 1 步')`))
    assert(await js(host, `!!document.querySelector('[aria-label="运行报告"] button[aria-expanded="true"]')`), '返回后执行详情的展开状态丢失')
    const crashed = await open()
    crashed.webContents.forcefullyCrashRenderer()
    await until(() => crashed.isDestroyed(), '崩溃窗口没有清理')
    assert(await js(host, `document.body.textContent.includes('已执行 1 步')`), '崩溃后宿主状态丢失')
    assert.equal(errors.filter(error => !error.includes('crashed')).length, 0, errors.join('\n'))
    console.log('通过：真实 Electron 单实例、受限截图、草稿交接、后台编辑、导航取消、原生关闭、运行配置、执行控制与崩溃恢复')
  } catch (error) {
    console.error(error); console.error(errors.join('\n'))
    console.error('窗口状态', BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), url: window.webContents.getURL() })))
    if (!host.isDestroyed()) await writeFile(path.join(output, 'workflow-failed-host.png'), (await host.webContents.capturePage()).toPNG())
    if (child()) await writeFile(path.join(output, 'workflow-failed-child.png'), (await child()!.webContents.capturePage()).toPNG())
    process.exitCode = 1
  } finally { manager.close(); host.destroy(); app.exit(Number(process.exitCode ?? 0)) }
}
void main().catch(error => { console.error(error); app.exit(1) })

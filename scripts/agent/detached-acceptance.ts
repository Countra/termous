import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow } from 'electron'
import { DetachedWindows } from '../../electron/detached-windows/manager.ts'
import { detachedModules } from '../../electron/detached-windows/registry.ts'

async function main() {
const output = path.resolve(process.argv[2])
const production = process.argv.includes('--production')
const webRoot = process.cwd()
app.setPath('userData', path.join(output, 'user-data'))
await app.whenReady()
const consoleErrors: string[] = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') { consoleErrors.push(event.message); console.error('renderer', event.message) } })
  contents.on('did-fail-load', (_event, code, description) => console.error('load', code, description))
})
const host = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: {
  preload: path.join(output, 'host-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
} })
const manager = new DetachedWindows({ host: () => host, trusted: event => event.sender === host.webContents && event.senderFrame === host.webContents.mainFrame,
  reveal: () => { if (host.isMinimized()) host.restore(); host.show() }, renderer: path.join(webRoot, 'dist/index.html'), devURL: production ? undefined : 'http://127.0.0.1:5183/',
  preload: production ? path.join(webRoot, 'dist-electron/detached-preload.cjs') : path.join(output, 'detached-preload.cjs'), appearance: () => ({ theme: 'dark', language: 'zh-CN' }),
  modules: [...detachedModules, { type: 'probe', instance: 'one', title: 'Probe', requiresHost: true, validateCommand: () => false, validateBinary: () => false }],
})
const child = () => BrowserWindow.getAllWindows().find(window => window !== host)
const until = async (check: () => boolean | Promise<boolean>, label: string) => {
  const deadline = Date.now() + 25000
  while (!await check()) { assert(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 50)) }
}
const js = (window: BrowserWindow, script: string) => window.webContents.executeJavaScript(script)
const click = async (window: BrowserWindow, label: string) => {
  const value = JSON.stringify(label)
  assert(await js(window, `(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===${value}||node.textContent.trim()===${value});if(!button||button.disabled)return false;button.click();return true})()`), `按钮不可用：${label}`)
}
const input = async (window: BrowserWindow, text: string) => {
  await js(window, `(()=>{const node=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,${JSON.stringify(text)});node.dispatchEvent(new Event('input',{bubbles:true}))})()`)
}
const open = async (reducedMotion = false) => {
  await click(host, '在独立窗口打开')
  await until(() => !!child(), '小窗未创建')
  const detached = child()!
  detached.webContents.debugger.attach('1.3')
  await detached.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] })
  await until(() => detached.isVisible(), '小窗未就绪')
  await until(() => js(detached, "!!document.querySelector('textarea') && !document.querySelector('textarea').closest('[inert]')"), '小窗未取得编辑权')
  return detached
}

try {
  for (const status of ['queued', 'running']) {
    if (production) await host.loadFile(path.join(output, 'fixture/scripts/agent/detached-preview.html'), { query: { run: status } })
    else await host.loadURL(`http://127.0.0.1:5183/scripts/agent/detached-preview.html?run=${status}`)
    await until(() => js(host, "!!document.querySelector('[data-agent-session-id=\"session-one\"] button:not([aria-label])')"), '停止验收会话未加载')
    await js(host, `document.querySelector('[data-agent-session-id="session-one"] button:not([aria-label])').click()`)
    await until(() => js(host, "!!document.querySelector('button[aria-label=\"停止任务\"]:not(:disabled)')"), '停止验收任务未就绪')
    const stopping = await open()
    await click(stopping, '停止任务')
    await until(() => js(stopping, "!document.querySelector('button[aria-label=\"停止任务\"]')"), '独立窗口停止命令未生效')
    assert(!await js(stopping, "document.body.textContent.includes('操作未确认') || document.body.textContent.includes('窗口交接未完成')"), '停止操作错误提示')
    stopping.close()
    await until(() => stopping.isDestroyed(), '停止后未完成交接')
    assert(!await js(host, "document.querySelector('button[aria-label=\"停止任务\"]') !== null"), '停止结果未同步回主窗口')
  }
  console.log('通过：真实独立窗口停止排队及执行中任务，返回主窗口保留停止结果')
  if (production) await host.loadFile(path.join(output, 'fixture/scripts/agent/detached-preview.html'))
  else await host.loadURL('http://127.0.0.1:5183/scripts/agent/detached-preview.html')
  host.show()
  host.focus()
  await until(() => js(host, "!!document.querySelector('textarea')"), '助手未加载')
  host.webContents.debugger.attach('1.3')
  await host.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await js(host, `(() => {
    window.detachedMotionTrace = [];
    for (const type of ['animationstart', 'animationend']) document.addEventListener(type, event => {
      if (!event.animationName.includes('window-')) return;
      window.detachedMotionTrace.push({ type, name: event.animationName,
        locked: !!document.querySelector('textarea')?.closest('[inert]') });
    });
  })()`)
  await js(host, `document.querySelector('[data-agent-session-id="session-one"] button:not([aria-label])').click()`)
  await until(() => js(host, "document.body.textContent.includes('可以先按下面的顺序确认环境')"), '历史会话未加载')
  await input(host, '主窗口草稿，交接保留。')
  const detached = await open()
  assert.equal(await js(detached, "document.querySelector('textarea').value"), '主窗口草稿，交接保留。')
  assert.equal(await js(detached, "typeof window.termous"), 'undefined')
  assert.match(await js(detached, "getComputedStyle(document.querySelector('[data-motion=entering]')).animationName"), /window-content-in/, '小窗缺少入场过渡')
  assert.equal(host.webContents.getBackgroundThrottling(), false)
  await click(detached, '模型与推理设置')
  await until(() => js(detached, "!!document.querySelector('[role=menu][aria-label=\"模型与推理设置\"]')"), '小窗模型弹层不可用')
  await click(detached, '模型与推理设置')
  await until(() => js(detached, "!document.querySelector('[role=menu][aria-label=\"模型与推理设置\"]')?.getClientRects().length"), '模型弹层未收起')
  await until(() => js(host, "!!document.querySelector('img[src^=\"data:image/\"]')"), '主页面未显示真实静态截图')
  const identity = { module: 'agent', instance: 'workspace' }
  await js(host, `window.termous.detachedWindows.open(${JSON.stringify(identity)})`)
  assert.equal(BrowserWindow.getAllWindows().length, 2)
  await writeFile(path.join(output, 'detached-dark.png'), (await detached.webContents.capturePage()).toPNG())
  await writeFile(path.join(output, 'embedded-placeholder.png'), (await host.webContents.capturePage()).toPNG())
  host.minimize()
  await input(detached, '主窗口最小化后继续输入。')
  host.hide()
  await input(detached, '主窗口隐藏后继续输入。')
  detached.setBounds({ width: 480, height: 600 })
  await until(() => js(detached, "!!document.querySelector('button[aria-label=\"会话\"]')"), '窄窗未切换抽屉')
  assert(await js(detached, 'document.documentElement.scrollWidth <= innerWidth'))
  await writeFile(path.join(output, 'detached-narrow.png'), (await detached.webContents.capturePage()).toPNG())
  detached.close()
  await until(() => detached.isDestroyed(), '原生关闭没有完成交接')
  assert.equal(await js(host, "document.querySelector('textarea').value"), '主窗口隐藏后继续输入。')
  assert.equal(host.webContents.getBackgroundThrottling(), true)
  assert.equal(await js(host, "!!document.querySelector('img[src^=\"data:image/\"]')"), false)
  assert(await js(host, "window.detachedMotionTrace.some(event => event.type === 'animationstart' && event.name.includes('window-defocus'))"), '打开时没有渐变模糊')
  assert(await js(host, "window.detachedMotionTrace.some(event => event.type === 'animationend' && event.name.includes('window-fade-out') && event.locked)"), '收回覆盖层未完成过渡或提前释放编辑权')
  assert.equal(await js(host, "!!document.querySelector('textarea').closest('[inert]')"), false)
  console.log('通过：初始化、真实截图、重复打开、最小化、隐藏、窄窗、原生关闭、草稿交接')

  const second = await open()
  await click(host, '主题')
  await until(() => js(second, "document.documentElement.dataset.theme === 'light'"), '主题未同步')
  await click(host, '语言')
  await until(() => js(second, "!!document.querySelector('button[aria-label=\"Return to main window\"]')"), '语言未同步')
  await writeFile(path.join(output, 'detached-light-en.png'), (await second.webContents.capturePage()).toPNG())
  await click(host, '语言')
  await until(() => js(second, "!!document.querySelector('button[aria-label=\"返回主窗口\"]')"), '语言切回失败')
  await click(host, '切换页面')
  await click(second, '返回主窗口')
  await until(() => js(host, "document.body.textContent.includes('离开未保存的页面？')"), '返回未经过导航确认')
  await click(host, '继续编辑')
  await until(() => js(host, "!document.querySelector('.ant-modal-wrap:not([style*=\"display: none\"])')"), '取消确认框未关闭')
  assert(!second.isDestroyed())
  assert.equal(await js(second, "!!document.querySelector('[data-motion=leaving]')"), false, '取消导航不应淡出小窗')
  await input(second, '取消返回后仍可编辑。')
  await click(second, '返回主窗口')
  await until(() => js(host, "!!document.querySelector('.ant-modal:not([style*=\"display: none\"])')"), '确认框未打开')
  await click(host, '放弃并返回')
  await until(() => second.isDestroyed(), '确认返回未完成')
  assert.equal(await js(host, "document.querySelector('textarea').value"), '取消返回后仍可编辑。')
  console.log('通过：主题同步、主页面切换、取消导航返回、确认返回')

  const closeElsewhere = await open()
  const originalHostBounds = host.getBounds()
  host.setBounds({ width: 620, height: 600 })
  closeElsewhere.setBounds({ width: 620, height: 520 })
  await until(() => js(closeElsewhere, "(()=>{const log=document.querySelector('[role=log]');return log.scrollHeight-log.clientHeight>160})()"), '历史内容没有形成可验证的滚动区域')
  const scrollAnchor = await js(closeElsewhere, `(()=>{
    const log=document.querySelector('[role=log]');log.scrollTop=60;log.dispatchEvent(new Event('scroll',{bubbles:true}));
    const top=log.getBoundingClientRect().top;
    const anchor=[...log.querySelectorAll('[data-agent-message]')].find(node=>node.getBoundingClientRect().bottom>top);
    return {id:anchor.dataset.agentMessage,offset:anchor.getBoundingClientRect().top-top};
  })()`)
  await click(host, '切换页面')
  closeElsewhere.close()
  await until(() => closeElsewhere.isDestroyed(), '其他主页面下原生关闭未完成')
  assert(await js(host, "document.body.textContent.includes('模拟主页面：有未保存的修改')"))
  await click(host, '切换页面')
  await until(() => js(host, `(()=>{
    const log=document.querySelector('[role=log]');
    const anchor=[...log.querySelectorAll('[data-agent-message]')].find(node=>node.dataset.agentMessage===${JSON.stringify(scrollAnchor.id)});
    return Math.abs(anchor.getBoundingClientRect().top-log.getBoundingClientRect().top-(${JSON.stringify(scrollAnchor.offset)}))<2;
  })()`), '后台收回后返回助手未恢复消息锚点')
  host.setBounds(originalHostBounds)
  console.log('通过：原生 × 保持主窗口当前页面，后台收回后恢复消息锚点')

  const third = await open()
  await until(() => js(third, "document.documentElement.dataset.theme === 'light'"), '重新打开时没有使用宿主当前主题')
  await js(third, `(()=>{const input=document.querySelector('input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['fixture attachment'],'fixture.txt',{type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await until(() => js(third, "document.body.textContent.includes('fixture.txt')"), '附件未接收')
  await until(() => js(third, "!!document.querySelector('button[aria-label=\"预览 fixture.txt\"]')"), '附件上传未完成')
  await click(third, '预览 fixture.txt')
  await until(() => js(third, "document.querySelector('.ant-modal pre')?.textContent === 'fixture attachment'"), '跨窗口附件预览失败')
  await js(third, "document.querySelector('.ant-modal-close').click()")
  await js(third, `(()=>{const input=document.querySelector('input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['handoff attachment'],'handoff.txt',{type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await until(() => js(third, "document.body.textContent.includes('handoff.txt') && !!document.querySelector('[data-phase=uploading]')"), '交接附件未进入上传中')
  third.close()
  await until(() => third.isDestroyed(), '附件交接阻塞关闭')
  await until(() => js(host, "document.body.textContent.includes('handoff.txt') && !document.querySelector('[data-phase=uploading]')"), '主宿主未完成上传')
  console.log('通过：附件传输与上传中关闭')

  await click(host, '新建会话')
  await until(() => js(host, "document.querySelector('textarea')?.value === ''"), '新草稿未打开')
  const fresh = await open()
  await input(fresh, '首次附件前的草稿。')
  await js(fresh, `(()=>{const input=document.querySelector('input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['first attachment'],'first.txt',{type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await until(() => js(fresh, "document.body.textContent.includes('first.txt')"), '新草稿的首次附件未接收')
  await input(fresh, '首次附件创建会话后继续编辑。')
  await js(fresh, `(()=>{const input=document.querySelector('input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([],'empty.txt',{type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await until(() => js(fresh, "document.body.textContent.includes('操作未确认，请刷新状态后检查结果')"), '无效附件没有反馈失败')
  fresh.close()
  await until(() => fresh.isDestroyed(), '首次附件创建会话后交接阻塞')
  assert.equal(await js(host, "document.querySelector('textarea').value"), '首次附件创建会话后继续编辑。')
  await until(() => js(host, "document.body.textContent.includes('first.txt') && !document.querySelector('[data-phase=uploading]')"), '首次附件未在宿主完成上传')
  console.log('通过：首次附件创建会话后的继续输入，无效附件不阻塞收回')

  await host.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await js(host, 'window.detachedMotionTrace = []')
  const reduced = await open(true)
  assert.equal(await js(reduced, "getComputedStyle(document.querySelector('[data-motion=entering]')).animationName"), 'none')
  await input(reduced, '减少动画仍完整交接。')
  reduced.close()
  await until(() => reduced.isDestroyed(), '减少动画模式关闭被阻塞')
  assert.equal(await js(host, 'window.detachedMotionTrace.length'), 0, '减少动画模式仍播放过渡')
  assert.equal(await js(host, "document.querySelector('textarea').value"), '减少动画仍完整交接。')
  await host.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
  host.webContents.debugger.detach()
  console.log('通过：实际入场与收回动画、动画期间编辑锁定、减少动画偏好')

  const fourth = await open()
  await input(fourth, '崩溃前已确认的草稿。')
  await new Promise(resolve => setTimeout(resolve, 100))
  fourth.webContents.forcefullyCrashRenderer()
  await until(() => fourth.isDestroyed(), '崩溃窗口未清理')
  await until(() => js(host, "document.querySelector('textarea')?.value === '崩溃前已确认的草稿。'"), '崩溃后未恢复已确认状态')
  const fifth = await open()
  host.webContents.reload()
  await until(() => fifth.isDestroyed(), '主 Renderer 重载未关闭小窗')
  console.log('通过：子窗口崩溃与主 Renderer 重载清理')

  await until(() => js(host, "!!document.querySelector('textarea')"), '主页面重载未完成')
  const hostCrashChild = await open()
  host.webContents.forcefullyCrashRenderer()
  await until(() => hostCrashChild.isDestroyed(), '主 Renderer 崩溃未关闭小窗')
  host.webContents.reload()
  await until(() => js(host, "!!document.querySelector('textarea')"), '主 Renderer 崩溃后重载失败')
  const probe = await js(host, "window.termous.detachedWindows.open({module:'probe',instance:'one'})")
  await js(host, `window.termous.detachedWindows.send({connection:${JSON.stringify(probe)},kind:'initialize'})`)
  await js(host, `window.termous.detachedWindows.send({connection:${JSON.stringify(probe)},kind:'ready'})`)
  await until(() => !!child()?.isVisible(), '测试模块无法创建窗口')
  assert.equal(host.webContents.getBackgroundThrottling(), false)
  await js(host, `window.termous.detachedWindows.close(${JSON.stringify(probe)})`)
  await until(() => !child(), '测试模块无法释放窗口')
  assert.equal(host.webContents.getBackgroundThrottling(), true)
  await js(host, "window.termous.detachedWindows.open({module:'probe',instance:'one'})")
  await until(() => !child(), '未初始化的窗口没有超时清理')
  assert.equal(host.webContents.getBackgroundThrottling(), true)
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'))
  await js(host, "window.termous.detachedWindows.open({module:'probe',instance:'one'})")
  const exiting = child()!
  manager.close()
  assert(exiting.isDestroyed())
  assert.equal(host.webContents.getBackgroundThrottling(), true)
  console.log('通过：测试模块注册、初始化超时与通用生命周期；专用 preload 正常加载')
} catch (error) {
  console.error(error)
  console.error(consoleErrors.join('\n'))
  if (!host.isDestroyed()) await host.webContents.capturePage().then(image => writeFile(path.join(output, 'failed-host.png'), image.toPNG())).catch(error => console.error('主窗口截图失败', error))
  if (child()) await child()!.webContents.capturePage().then(image => writeFile(path.join(output, 'failed-child.png'), image.toPNG())).catch(error => console.error('子窗口截图失败', error))
  process.exitCode = 1
} finally {
  manager.close()
  host.destroy()
  app.exit(Number(process.exitCode ?? 0))
}
}

void main().catch(error => { console.error(error); app.exit(1) })

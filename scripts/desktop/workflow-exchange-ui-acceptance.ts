import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { DetachedWindows } from '../../electron/detached-windows/manager'
import { registerWorkflowExchange } from '../../electron/workflow-exchange/ipc'
import { click, exchangeClosed, exportWorkflow, importWorkflow, js, until } from './workflow-exchange-ui-driver'
import { detachedChannels, type AppConfig, type DetachedPacket } from '../../common/contracts'

async function main() {
  const directory = process.argv[2]
  const baseURL = process.env.TERMOUS_EXCHANGE_UI_URL!, api = process.env.TERMOUS_EXCHANGE_CORE_URL!
  const output = path.dirname(directory)
  app.setPath('userData', path.join(directory, 'electron-data'))
  await app.whenReady()
  const errors: string[] = []
  app.on('browser-window-created', (_event, window) => {
    // 验收通过 DOM 和真实 IPC 操作独立测试窗口，不接管用户桌面。
    window.webContents.setBackgroundThrottling(false)
    window.on('show', () => window.hide())
    window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  })
  const host = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: {
    preload: path.join(output, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false,
  } })
  const page = new URL('scripts/desktop/workflow-exchange-preview.html', baseURL).href
  const trusted = (event: Electron.IpcMainInvokeEvent) => event.sender === host.webContents && event.senderFrame === host.webContents.mainFrame && event.senderFrame.url === page
  const manager = new DetachedWindows({ host: () => host, trusted, reveal: () => {}, appearance: () => ({ theme: 'dark', language: 'zh-CN' }),
    renderer: '', devURL: page, preload: path.join(output, 'detached-preload.cjs') })
  const stop = registerWorkflowExchange({ ipc: ipcMain, trusted, config: async () => ({ apiBaseUrl: api, apiToken: 'workflow-exchange-acceptance' } as AppConfig),
    language: () => 'zh-CN', owner: origin => origin ? manager.workflowDialogOwner(origin) : host })
  const headers = { 'X-Termous-Token': 'workflow-exchange-acceptance', 'Content-Type': 'application/json' }
  const request = async (resource: string, options?: RequestInit) => {
    const response = await fetch(`${api}/api/v1/desktop-workflows${resource}`, { ...options, headers })
    assert(response.ok, `${resource}: ${response.status} ${await response.clone().text()}`)
    return response.json()
  }
  const manifest = JSON.parse(await readFile('../backend/docs/desktop-workflow-exchange/workflow.json', 'utf8'))
  const input = path.join(directory, '改名工作流.json')
  await writeFile(input, JSON.stringify(manifest))
  const choices: { kind: 'open' | 'save'; file?: string; owner: number }[] = []
  const calls: { kind: string; owner: number }[] = []
  const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalOpenPath = shell.openPath
  const opened: string[] = []
  // 目录打开验证走真实 UI 和 IPC，仅替代文件管理器，避免干扰用户桌面。
  shell.openPath = async directory => { opened.push(directory); return '' }
  const openDirectory = async (window: BrowserWindow, expected: string) => {
    const count = opened.length
    await click(window, '打开目录')
    await until(() => opened.length === count + 1, '打开目录没有经过原生桥接')
    assert.equal(opened[count], expected)
  }
  const choose = (kind: 'open' | 'save', owner: BrowserWindow) => {
    const choice = choices.shift(); assert(choice, `未声明的 ${kind} 对话框`)
    assert.equal(choice.kind, kind); assert.equal(choice.owner, owner.id)
    calls.push({ kind, owner: owner.id }); return choice.file
  }
  // 只替代系统对话框的人工选择结果，UI、preload、IPC、Core 和文件均为实际实现。
  dialog.showOpenDialog = (async (owner: BrowserWindow) => { const file = choose('open', owner); return { canceled: !file, filePaths: file ? [file] : [] } }) as typeof originalOpen
  dialog.showSaveDialog = (async (owner: BrowserWindow) => { const file = choose('save', owner); return { canceled: !file, filePath: file } }) as typeof originalSave
  const queue = (kind: 'open' | 'save', file?: string, owner = host) => choices.push({ kind, file, owner: owner.id })
  const cases: string[] = []
  const packets: unknown[] = []
  const record = (event: Electron.IpcMainEvent, packet: DetachedPacket) => {
    if (packet.operation === 'command' || packet.kind === 'response') packets.push({ sender: event.sender.id, ...packet })
    else if (packet.kind === 'state') packets.push({ sender: event.sender.id, ...packet, payload: (packet.payload as { partitions?: { state?: unknown } })?.partitions?.state })
  }
  ipcMain.on(detachedChannels.packet, record)
  try {
    await host.loadURL(page)
    queue('open'); await click(host, '导入流程')
    await until(() => calls.length === 1, 'StrictMode 挂载后没有调用原生文件选择')
    await exchangeClosed(host)
    assert.deepEqual(await request(''), [])
    cases.push('StrictMode 初次挂载与原生选择取消')

    queue('open', input); await importWorkflow(host)
    const scripts = await request(''); assert.equal(scripts.length, 1)
    const script = scripts[0]
    assert.equal(script.name, manifest.name)
    const single = path.join(directory, '导出.json')
    queue('save', single); await exportWorkflow(host, 'json', false, () => openDirectory(host, directory))
    assert.equal(JSON.parse(await readFile(single, 'utf8')).name, manifest.name)
    const zip = path.join(directory, '导出.zip')
    queue('save', zip); await exportWorkflow(host, 'zip')
    assert.equal((await readFile(zip)).readUInt32LE(), 0x04034b50)
    queue('open', zip); await importWorkflow(host)
    assert.equal((await request('')).length, 2)
    cases.push('真实 Core 的 JSON 导入、提交、JSON 与 ZIP 导出及 ZIP 再导入')

    // 使用确定性图案验证图片像素往返，避免依赖截图或用户文件。
    const pixels = Buffer.alloc(32 * 32 * 4)
    for (let i = 0; i < 32 * 32; i++) { pixels[i * 4] = i % 251; pixels[i * 4 + 1] = i * 17 % 253; pixels[i * 4 + 2] = i * 31 % 255; pixels[i * 4 + 3] = 255 }
    const png = nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }).toPNG()
    const imagePath = 'assets/登录按钮.PNG'
    const imageInput = path.join(directory, '带图输入')
    await mkdir(path.join(imageInput, 'assets'), { recursive: true })
    await writeFile(path.join(imageInput, imagePath), png)
    const imageManifest = { ...manifest, name: '图片交换验收', definition: { schema_version: 2, parameters: [], steps: [
      { id: 'image', name: '图片目标', kind: 'pointer.click', action: {}, target: { kind: 'image', image: { path: imagePath, offset: { x: 0, y: 0 } } } },
    ] }, assets: [{ path: imagePath }] }
    await writeFile(path.join(imageInput, '别名.json'), JSON.stringify(imageManifest))
    await writeFile(path.join(imageInput, '无关.txt'), '不可读取的无关内容')
    queue('open', path.join(imageInput, '别名.json')); await importWorkflow(host, true)
    const folder = path.join(directory, '带图导出')
    queue('save', folder); await exportWorkflow(host, 'directory', false, () => openDirectory(host, folder))
    const exported = JSON.parse(await readFile(path.join(folder, 'workflow.json'), 'utf8'))
    assert.equal(exported.assets.length, 1)
    assert.deepEqual(exported.assets[0], { path: 'assets/image_001.png' })
    assert.equal(exported.definition.steps[0].target.image.path, exported.assets[0].path)
    const exportedPNG = await readFile(path.join(folder, exported.assets[0].path))
    assert.deepEqual(nativeImage.createFromBuffer(exportedPNG).toBitmap(), nativeImage.createFromBuffer(png).toBitmap())
    queue('open', path.join(folder, 'workflow.json')); await importWorkflow(host, true)
    cases.push('改名 JSON 与相邻图片、预览图片、目录导出及像素往返')

    await click(host, '在独立窗口打开')
    await until(() => BrowserWindow.getAllWindows().length === 2, '独立窗口未创建')
    const child = BrowserWindow.getAllWindows().find(window => window !== host)!
    await until(() => js(child, `!!document.querySelector('button[aria-label="返回主窗口"]')&&!document.body.inert`), '独立窗口未取得编辑权')
    assert.equal(await js(child, 'typeof window.termous'), 'undefined')
    const detachedZIP = path.join(directory, '独立窗口.zip')
    queue('save', detachedZIP, child); await exportWorkflow(child, 'zip', false, () => openDirectory(child, directory))
    queue('open', detachedZIP, child); await importWorkflow(child, true)
    await click(child, '返回主窗口')
    await until(() => child.isDestroyed(), '独立窗口返回未完成')
    cases.push('独立窗口经宿主 Controller 导出导入与原生对话框归属')
    cases.push('主窗口与独立窗口成功回执打开对应导出目录')

    // 更新源脚本后从历史面板导出 v1，核对快照仍含 v1 的元数据。
    const old = await request(`/${script.id}`)
    await request(`/${script.id}`, { method: 'PUT', body: JSON.stringify({ expected_revision: 1, name: '更新后的流程', description: '', tags: [], definition: old.version.definition }) })
    await until(() => js(host, `document.body.textContent.includes('更新后的流程')`), '版本事件没有刷新库')
    await js(host, `[...document.querySelectorAll('button')].find(node=>node.textContent.includes('更新后的流程')).click()`)
    await click(host, '更多操作'); await click(host, '版本历史', '[role="menuitem"]')
    await until(() => js(host, `!![...document.querySelectorAll('[role="dialog"] strong')].find(node=>node.textContent==='v1')`), '历史版本未加载')
    await js(host, `[...document.querySelectorAll('[role="dialog"] strong')].find(node=>node.textContent==='v1').parentElement.querySelector('button').click()`)
    const history = path.join(directory, '历史版本.json')
    queue('save', history); await exportWorkflow(host, 'json', true)
    assert.equal(JSON.parse(await readFile(history, 'utf8')).name, manifest.name)
    cases.push('历史版本导出保持原元数据')
    assert.equal(choices.length, 0)
    assert.deepEqual(errors, [])
    assert(!(await readdir(directory)).some(name => name.startsWith('.workflow-export-')))
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: true, cases, nativeDialogCalls: calls }, null, 2))
    console.log('通过：StrictMode → Workspace → Controller → 实际 preload / IPC → 对话框调用 → 实际 Core / 文件')
  } catch (error) {
    await writeFile(path.join(directory, 'failed-packets.json'), JSON.stringify(packets, null, 2))
    for (const window of BrowserWindow.getAllWindows()) await writeFile(path.join(directory, `failed-${window.id}.html`), await js(window, 'document.body.outerHTML'))
    console.error(errors); throw error
  } finally {
    ipcMain.removeListener(detachedChannels.packet, record)
    stop(); manager.close(); dialog.showOpenDialog = originalOpen; dialog.showSaveDialog = originalSave; shell.openPath = originalOpenPath
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
  }
  app.quit()
}
void main().catch(error => { console.error(error); app.exit(1) })

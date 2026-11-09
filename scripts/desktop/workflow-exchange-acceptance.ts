import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, shell, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { registerWorkflowExchange } from '../../electron/workflow-exchange/ipc'
import { workflowExchangeChannels as channels, type AppConfig, type WorkflowFileRequest, type WorkflowFileResponse, type WorkflowExportLocationRequest } from '../../common/contracts'

async function main() {
  const output = path.resolve(process.argv[2])
  await mkdir(output, { recursive: true })
  const directory = await mkdtemp(path.join(output, '原生文件-'))
  app.setPath('userData', path.join(directory, 'user-data'))
  await app.whenReady()
  const host = new BrowserWindow({ show: false }), child = new BrowserWindow({ show: false })
  const manifest = Buffer.from(JSON.stringify({ format: 'termous.desktop-workflow', format_version: 1, name: '验收',
    description: '', tags: [], definition: { schema_version: 2, parameters: [], steps: [] }, assets: [] }))
  const input = path.join(directory, '改名的工作流.json'), destination = path.join(directory, '导出.json')
  await writeFile(input, manifest); await writeFile(destination, '原文件')
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => Promise<WorkflowFileResponse>>()
  const opened: string[] = []; let saveTarget = destination, openFailure = ''
  const owners: number[] = []; let releases = 0, slow = false, invalid = false
  let started: (() => void) | undefined
  const failures: unknown[] = []
  const server = createServer((request, response) => {
    void (async () => {
      assert.equal(request.headers['x-termous-token'], 'fixture')
      if (request.method === 'DELETE') { releases++; response.writeHead(204).end(); return }
      if (request.url?.endsWith('/imports')) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk)
        assert(Buffer.concat(chunks).includes(manifest))
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ id: 'workflow_import_fixture' })); return
      }
      if (request.method === 'POST') {
        const chunks = []; for await (const chunk of request) chunks.push(chunk)
        const { format } = JSON.parse(Buffer.concat(chunks).toString())
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ id: 'workflow_export_fixture', format, content_type: format === 'zip' ? 'application/zip' : 'application/json', assets: [], content_length: manifest.length })); return
      }
      response.setHeader('Content-Length', manifest.length + (invalid ? 1 : 0))
      response.setHeader('Content-Type', 'application/json')
      if (slow) { response.write(manifest.subarray(0, 1)); started?.() }
      else response.end(manifest)
    })().catch(error => { failures.push(error); response.writeHead(500).end() })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert(address && typeof address !== 'string')
  const open = dialog.showOpenDialog, save = dialog.showSaveDialog, openPath = shell.openPath
  // 测试替代用户选择结果，真实文件、HTTP 流、窗口对象及关闭事件仍使用原生实现。
  dialog.showOpenDialog = (async (owner: BrowserWindow) => { owners.push(owner.id); return { canceled: false, filePaths: [input] } }) as typeof open
  dialog.showSaveDialog = (async (owner: BrowserWindow) => { owners.push(owner.id); return { canceled: false, filePath: saveTarget } }) as typeof save
  // 只核对打开目录的目标及系统返回值，不在验收时打开真实文件管理器。
  shell.openPath = async directory => { opened.push(directory); return openFailure }
  const close = registerWorkflowExchange({
    ipc: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, value: unknown) => Promise<WorkflowFileResponse>) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel) } as unknown as IpcMain,
    config: async () => ({ apiBaseUrl: `http://127.0.0.1:${address.port}`, apiToken: 'fixture' } as AppConfig), language: () => 'zh-CN',
    trusted: event => event.sender === host.webContents,
    owner: origin => origin ? origin.generation === 'current' && !child.isDestroyed() ? child : undefined : host,
  })
  const event = { sender: host.webContents } as IpcMainInvokeEvent
  const invoke = (value: WorkflowFileRequest) => handlers.get(channels.run)!(event, value)
  const openFolder = (value: WorkflowExportLocationRequest, sender = event) => handlers.get(channels.openDirectory)!(sender, value)
  const origin = { module: 'desktop-workflow', instance: 'workspace', generation: 'current' }
  try {
    assert.deepEqual(await invoke({ kind: 'import', operation_id: 'import', origin }), { import_id: 'workflow_import_fixture' })
    assert.equal(owners[0], child.id)
    const rejected = await invoke({ kind: 'import', operation_id: 'stale', origin: { ...origin, generation: 'old' } })
    assert.equal(rejected.error?.code, 'desktop_workflow_exchange_busy'); assert.equal(owners.length, 1)
    const request: WorkflowFileRequest = { kind: 'export', operation_id: 'export', script_id: 'script', version: 1, layout: 'json' }
    const exported = await invoke(request); assert.equal(exported.file_name, '导出.json'); assert.equal(owners[1], host.id)
    assert.deepEqual(await readFile(destination), manifest)
    assert.equal(typeof exported.location_id, 'string'); assert(!('directory' in exported))
    const location = { location_id: exported.location_id! }
    assert.deepEqual(await openFolder(location), {}); assert.equal(opened[0], await realpath(directory))
    assert.equal((await openFolder(location, { sender: child.webContents } as IpcMainInvokeEvent)).error?.code, 'workflow_exchange_sender_denied')
    assert.equal((await openFolder({ ...location, origin: { ...origin, generation: 'old' } })).error?.code, 'workflow_exchange_sender_denied')
    assert.equal(opened.length, 1)
    openFailure = '系统打开失败'
    assert.equal((await openFolder(location)).error?.code, 'workflow_exchange_directory_open_failed')
    openFailure = ''; assert.deepEqual(await openFolder({ ...location, origin }), {})
    saveTarget = path.join(directory, '导出.zip')
    const zip = await invoke({ ...request, operation_id: 'export-zip', layout: 'zip' })
    assert.deepEqual(await openFolder({ location_id: zip.location_id! }), {})
    assert.equal(opened[opened.length - 1], await realpath(directory))
    saveTarget = path.join(directory, '导出目录')
    const bundle = await invoke({ ...request, operation_id: 'export-directory', layout: 'directory', origin })
    assert.deepEqual(await openFolder({ location_id: bundle.location_id!, origin }), {})
    assert.equal(opened[opened.length - 1], await realpath(saveTarget))
    await rename(saveTarget, `${saveTarget}-已移动`)
    assert.equal((await openFolder({ location_id: bundle.location_id! })).error?.code, 'workflow_exchange_directory_missing')
    saveTarget = destination
    await writeFile(destination, '保留原文件'); invalid = true
    assert.equal((await invoke(request)).error?.code, 'workflow_exchange_response_invalid')
    assert.equal(await readFile(destination, 'utf8'), '保留原文件')
    invalid = false; slow = true
    const reading = new Promise<void>(resolve => { started = resolve })
    const pending = invoke({ ...request, origin })
    await reading; child.destroy()
    assert.equal((await pending).canceled, true)
    assert.equal(await readFile(destination, 'utf8'), '保留原文件')
    assert.equal(releases, 5); assert.deepEqual(failures, [])
    await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, cases: ['中文路径流式导入', '主窗口与独立窗口对话框归属', '过期 generation 拒绝', '单 JSON 原子发布', 'ZIP 与 JSON 打开父目录', '目录导出打开自身', '打开失败及目录移动错误', '打开目录拒绝不可信发送方及过期窗口', '损坏响应保护原文件', '关闭发起窗口取消在途下载'] }, null, 2))
    console.log('工作流文件交换 Electron 验收通过')
  } finally {
    close(); dialog.showOpenDialog = open; dialog.showSaveDialog = save; shell.openPath = openPath
    if (!child.isDestroyed()) child.destroy(); host.destroy()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
  app.quit()
}
void main().catch(error => { console.error(error); app.exit(1) })

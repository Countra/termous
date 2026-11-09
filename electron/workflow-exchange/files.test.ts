import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig } from '#common/contracts'
import { ExchangeCore } from './core.ts'
import { importFile } from './import.ts'
import { exportFile } from './export.ts'
import { openOrdinary } from './files.ts'

async function directory(t: test.TestContext) {
  const root = path.resolve('../TEMP/workflow-exchange')
  await mkdir(root, { recursive: true })
  const folder = await mkdtemp(path.join(root, 'native-中文-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  return folder
}
async function core(t: test.TestContext, handler: (r: IncomingMessage, w: ServerResponse) => Promise<void> | void) {
  const failures: unknown[] = []
  const server = createServer((r, w) => { void Promise.resolve().then(() => handler(r, w)).catch(error => { failures.push(error); w.writeHead(500).end() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); assert.deepEqual(failures, []) })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return new ExchangeCore({ apiBaseUrl: `http://127.0.0.1:${address.port}`, apiToken: 'fixture-token' } as AppConfig)
}
const image = Buffer.from('本机传输边界测试图片内容')
const hash = createHash('sha256').update(image).digest('hex')
const asset = { path: 'assets/登录按钮.png', sha256: hash, size: image.length, width: 16, height: 16 }
const manifest = { format: 'termous.desktop-workflow', format_version: 1, assets: [{ path: asset.path }], definition: { steps: [{ image: { path: asset.path } }] } }

test('中文 JSON 目录仅传输清单资源，并通过同一文件句柄完成读取', async t => {
  const dir = await directory(t)
  await mkdir(path.join(dir, 'assets'))
  await writeFile(path.join(dir, '自定义名字.json'), JSON.stringify(manifest))
  await writeFile(path.join(dir, asset.path), image)
  await writeFile(path.join(dir, 'ignored-private-file.txt'), '不得传输的目录内容')
  const client = await core(t, async (r, w) => {
    assert.equal(r.url, '/api/v1/desktop-workflows/imports')
    assert.equal(r.headers['x-termous-token'], 'fixture-token')
    const chunks = []; for await (const chunk of r) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    assert(body.includes('name="manifest"')); assert(body.includes(image.toString()))
    assert(!body.includes('不得传输')); assert(!body.includes(dir))
    w.setHeader('Content-Type', 'application/json'); w.end(JSON.stringify({ id: 'workflow_import_fixture' }))
  })
  assert.equal(await importFile(client, path.join(dir, '自定义名字.json'), new AbortController().signal, () => {}), 'workflow_import_fixture')
})

test('目录资源拒绝 junction，已打开文件替换能够检测', async t => {
  const dir = await directory(t), outside = await directory(t)
  await writeFile(path.join(outside, '登录按钮.png'), image)
  await symlink(outside, path.join(dir, 'assets'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(openOrdinary(dir, path.join(dir, asset.path), 1024), { code: 'workflow_exchange_unsafe_path' })
  const file = path.join(dir, 'workflow.json')
  await writeFile(file, '{}')
  const opened = await openOrdinary(dir, file, 1024)
  try {
    await rename(file, path.join(dir, 'previous.json')); await writeFile(file, '{}')
    await assert.rejects(opened.verify(), { code: 'workflow_exchange_source_changed' })
  } finally { await opened.handle.close() }
})

test('目录导出固定快照并拒绝覆盖，单文件失败保护已有目标', async t => {
  const dir = await directory(t), configuration = Buffer.from(JSON.stringify(manifest))
  let bad = false, released = 0
  const client = await core(t, async (r, w) => {
    if (r.method === 'DELETE') { released++; w.writeHead(204).end(); return }
    if (r.method === 'POST') {
      w.setHeader('Content-Type', 'application/json')
      w.end(JSON.stringify({ id: 'workflow_export_fixture', assets: [asset], format: 'json', content_type: 'application/json', content_length: configuration.length })); return
    }
    const data = r.url?.endsWith('/content') ? configuration : image
    w.setHeader('Content-Length', bad ? data.length + 1 : data.length); w.end(data)
  })
  const destination = path.join(dir, '配置目录')
  assert.deepEqual(await exportFile(client, 'script', 2, 'directory', destination, new AbortController().signal, () => {}), { file_name: '配置目录', directory: await realpath(destination) })
  assert.deepEqual(await readFile(path.join(destination, 'workflow.json')), configuration)
  assert.deepEqual(await readFile(path.join(destination, asset.path)), image)
  await assert.rejects(exportFile(client, 'script', 2, 'directory', destination, new AbortController().signal, () => {}), { code: 'workflow_exchange_target_exists' })
  assert.equal(released, 1)
  const single = path.join(dir, 'old.json'); await writeFile(single, '原文件')
  bad = true
  await assert.rejects(exportFile(client, 'script', 2, 'json', single, new AbortController().signal, () => {}), { code: 'workflow_exchange_assets_require_directory' })
  assert.equal(await readFile(single, 'utf8'), '原文件'); assert.equal(released, 2)
})

test('取消上传后释放输入句柄，不遗留后台读取', async t => {
  const dir = await directory(t), file = path.join(dir, 'bundle.zip')
  await writeFile(file, Buffer.alloc(1024 * 1024))
  const abort = new AbortController()
  const client = await core(t, (r, w) => { r.resume(); w.on('close', () => {}); abort.abort() })
  await assert.rejects(importFile(client, file, abort.signal, () => {}))
  await rename(file, path.join(dir, 'closed.zip'))
})

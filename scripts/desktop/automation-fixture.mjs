import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { app, BrowserWindow, nativeImage } from 'electron'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

async function main() {
  // 仅连接本机合成 RFB 和内存 Core 夹具；不读取用户配置，不调用真实远端。
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const output = path.join(root, 'build', 'desktop-automation-fixture')
  const packaged = process.env.TERMOUS_DESKTOP_PACKAGED_FIXTURE === '1'
  await mkdir(output, { recursive: true })
  for (const [source, name, module] of [['electron/desktopAutomation/runtime.ts', 'runtime.mjs', ts.ModuleKind.ESNext], ['electron/desktop-automation-preload.ts', 'preload.cjs', ts.ModuleKind.CommonJS]]) {
    const compiled = ts.transpileModule(await readFile(path.join(root, source), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module } })
    await writeFile(path.join(output, name), compiled.outputText, 'utf8')
  }
  app.setPath('userData', path.resolve(root, '../TEMP/desktop-automation-fixture/electron'))
  await app.whenReady()
  app.on('window-all-closed', () => {})
  const { DesktopAutomationRuntime } = await import(pathToFileURL(path.join(output, 'runtime.mjs')).href)
  const runtime = new DesktopAutomationRuntime({ config: async () => ({ apiBaseUrl: 'http://127.0.0.1:5193', apiToken: 'fixture-token' }), appearance: () => ({ language: 'zh-CN', theme: 'dark' }), renderer: path.join(root, 'dist/index.html'), devURL: packaged ? undefined : 'http://127.0.0.1:5191/', preload: packaged ? path.join(root, 'dist-electron/desktop-automation-preload.cjs') : path.join(output, 'preload.cjs'), warn: code => console.error(code) })
  const client = new Client({ name: 'desktop-automation-fixture', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:5193/mcp'), { authProvider: { token: async () => 'tmcp_fixture-client.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, requestInit: { headers: { 'X-Termous-Token': 'fixture-token' } } })
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  let request = 0, attachment, grant
  const timings = []
  const memories = []
  async function call(name, args = {}, expectedError = false) {
    const result = await client.callTool({ name: `termous.desktops.${name}`, arguments: args })
    if (result.isError && !expectedError) throw new Error(JSON.stringify(result.structuredContent ?? result.content))
    const operation = result.structuredContent?.operation
    if (!expectedError && operation && operation.state !== 'accepted') throw new Error(JSON.stringify(operation))
    return result
  }
  const mutate = (name, args = {}) => call(name, { ...args, client_request_id: `fixture-${++request}` })
  async function capture(args = {}) {
    const started = performance.now()
    const result = await call('capture', { attachment_id: attachment.id, ...args })
    const image = result.content.find(p => p.type === 'image')
    assert.ok(image)
    assert.ok(result.content.some(p => p.type === 'text' && p.text.includes('screenshot_id')))
    const metadata = result.structuredContent.capture
    const decoded = nativeImage.createFromBuffer(Buffer.from(image.data, 'base64'))
    assert.deepEqual(decoded.getSize(), { width: metadata.metadata.width, height: metadata.metadata.height })
    timings.push({ width: metadata.metadata.desktop_width, ms: performance.now() - started, bytes: Buffer.byteLength(image.data, 'base64') })
    return metadata
  }
  async function input(name, args) { return mutate(name, { attachment_id: attachment.id, grant_id: grant.id, ...args }) }
  let passed = false
  try {
    await runtime.start()
    await client.connect(transport)
    const tools = await client.listTools()
    assert.equal(tools.tools.length, 19)
    const { session } = (await mutate('connect', { profile_id: 'fixture' })).structuredContent
    let current
    for (let i = 0; i < 100; i++) { current = (await call('get', { session_id: session.id })).structuredContent.session; if (current.status === 'ready') break; await delay(100) }
    attachment = (await mutate('attach', { session_id: session.id, connection_generation: current.connection_generation })).structuredContent.attachment
    for (let i = 0; i < 150; i++) { attachment = (await call('get', { attachment_id: attachment.id })).structuredContent.attachment; if (attachment.state === 'ready') break; if (attachment.state === 'failed') throw new Error(JSON.stringify(attachment)); await delay(200) }
    assert.equal(attachment.state, 'ready')
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    const window = BrowserWindow.getAllWindows()[0]
    assert.equal(window.isVisible(), false)
    const shot = await capture()
    grant = (await mutate('control.acquire', { attachment_id: attachment.id })).structuredContent.control.attachment.grant
    await input('pointer.click', { screenshot_id: shot.screenshot_id, x: 100, y: 100 })
    await input('keyboard.text', { text: 'Termous 中文' })
    await input('keyboard.shortcut', { codes: ['ControlLeft', 'KeyA'] })
    await input('pointer.drag', { screenshot_id: shot.screenshot_id, points: [{ x: 10, y: 10 }, { x: 80, y: 70 }], duration_ms: 100 })
    await input('pointer.scroll', { screenshot_id: shot.screenshot_id, x: 50, y: 50, delta: 120 })
    for (const code of ['F9', 'F10']) {
      const before = await capture()
      await input('keyboard.key', { code })
      await capture({ after_sequence: before.metadata.frame_sequence })
      for (let i = 0; i < 12; i++) await capture({ max_width: 3840, max_height: 2160 })
    }
    window.show(); window.minimize(); await capture(); window.close()
    assert.equal(window.isDestroyed(), false)
    assert.equal(window.isVisible(), false)
    await capture()
    await mutate('control.release', { attachment_id: attachment.id, grant_id: grant.id })
    const soakSeconds = Math.max(0, Math.min(1800, Number(process.env.TERMOUS_DESKTOP_SOAK_SECONDS ?? 0)))
    const deadline = Date.now() + soakSeconds * 1000
    while (Date.now() < deadline) {
      await capture()
      const metrics = app.getAppMetrics().find(item => item.pid === window.webContents.getOSProcessId())
      memories.push({ elapsed: soakSeconds - (deadline - Date.now()) / 1000, memory: metrics?.memory, cpu: metrics?.cpu })
      await delay(Math.min(30_000, deadline - Date.now()))
    }
    // 人工收回与 MCP 归还使用同一清理完成屏障，旧授权不能在回执后继续输入。
    grant = (await mutate('control.acquire', { attachment_id: attachment.id })).structuredContent.control.attachment.grant
    const reclaimed = await fetch(`http://127.0.0.1:5193/api/v1/remote-desktop-sessions/${encodeURIComponent(session.id)}/automation/reclaim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Termous-Token': 'fixture-token' },
      body: JSON.stringify({ expected_connection_generation: current.connection_generation }),
    })
    assert.equal(reclaimed.status, 200)
    const stale = await call('keyboard.key', { attachment_id: attachment.id, grant_id: grant.id, client_request_id: `fixture-${++request}`, code: 'Enter' }, true)
    assert.equal(stale.isError, true)
    await mutate('detach', { attachment_id: attachment.id })
    await mutate('close', { session_id: session.id, connection_generation: current.connection_generation })
    passed = true
  } catch (error) { console.error(error) }
  finally {
    const report = { passed, packaged, finishedAt: new Date().toISOString(), timings, memories }
    await writeFile(path.join(output, packaged ? 'result-packaged.json' : 'result.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log(JSON.stringify({ passed, captures: timings.length, samples: memories.length }))
    await client.close().catch(() => {})
    runtime.close()
    await fetch('http://127.0.0.1:5193/api/v1/fixture-result', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Termous-Token': 'fixture-token' }, body: JSON.stringify({ passed }) }).catch(() => {})
    app.exit(passed ? 0 : 1)
  }

}
void main().catch(error => { console.error(error); app.exit(1) })

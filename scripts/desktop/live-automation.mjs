import { app, nativeImage } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

async function main() {
  // 此入口只连接显式启动的真实目标夹具；操作由本地队列逐项提交，图片保存在 TEMP。
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const output = path.resolve(root, '../TEMP/runtime/desktop-mcp/live')
  await mkdir(output, { recursive: true })
  const queue = path.join(output, 'commands.json')
  await writeFile(queue, '[]', 'utf8')
  const compiled = ts.transpileModule(await readFile(path.join(root, 'electron/desktopAutomation/runtime.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
  const runtimeFile = path.join(root, 'build/desktop-automation-fixture/live-runtime.mjs')
  await mkdir(path.dirname(runtimeFile), { recursive: true })
  await writeFile(runtimeFile, compiled.outputText, 'utf8')
  app.setPath('userData', path.join(output, 'electron'))
  await app.whenReady()
  app.on('window-all-closed', () => {})
  const { DesktopAutomationRuntime } = await import(pathToFileURL(runtimeFile).href)
  const runtime = new DesktopAutomationRuntime({ config: async () => ({ apiBaseUrl: 'http://127.0.0.1:5193', apiToken: 'fixture-token' }), appearance: () => ({ language: 'zh-CN', theme: 'dark' }), renderer: path.join(root, 'dist/index.html'), preload: path.join(root, 'dist-electron/desktop-automation-preload.cjs'), warn: code => console.error(code) })
  const client = new Client({ name: 'desktop-live-acceptance', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:5193/mcp'), { authProvider: { token: async () => 'tmcp_fixture-client.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, requestInit: { headers: { 'X-Termous-Token': 'fixture-token' } } })
  const headers = { 'Content-Type': 'application/json', 'X-Termous-Token': 'fixture-token' }
  let attachment, grant, desktop, serial = 0, screenshot, closing = false
  let operationFailed = false
  const operations = []
  const mutating = new Set(['connect', 'attach', 'detach', 'close', 'control.acquire', 'control.release', 'pointer.move', 'pointer.click', 'pointer.drag', 'pointer.scroll', 'keyboard.key', 'keyboard.shortcut', 'keyboard.text', 'clipboard.set_text', 'resize'])
  async function call(tool, args = {}) {
    const result = await client.callTool({ name: `termous.desktops.${tool}`, arguments: { ...args, ...(mutating.has(tool) ? { client_request_id: `live-${++serial}` } : {}) } })
    operations.push({ tool, state: result.isError ? 'error' : result.structuredContent?.operation?.state ?? 'accepted' })
    if (result.isError) throw new Error(JSON.stringify(result.structuredContent ?? result.content))
    const operation = result.structuredContent?.operation
    if (mutating.has(tool) && operation && operation.state !== 'accepted') throw new Error(JSON.stringify(operation))
    return result
  }
  async function capture(args = {}) {
    const start = performance.now()
    const result = await call('capture', { attachment_id: attachment.id, ...args })
    screenshot = result.structuredContent.capture
    const image = result.content.find(item => item.type === 'image')
    const bytes = Buffer.from(image.data, 'base64')
    const filename = path.join(output, `${desktop.protocol}-${Date.now()}.png`)
    await writeFile(filename, bytes)
    console.log(JSON.stringify({ image: filename, bytes: bytes.length, ms: performance.now() - start, dimensions: nativeImage.createFromBuffer(bytes).getSize(), capture: screenshot }))
  }
  async function finish(passed) {
    if (closing) return
    closing = true
    let clean = true
    if (grant) await call('control.release', { attachment_id: attachment.id, grant_id: grant.id }).catch(error => { clean = false; console.error(String(error)) })
    if (attachment) await call('detach', { attachment_id: attachment.id }).catch(error => { clean = false; console.error(String(error)) })
    if (desktop) await call('close', { session_id: desktop.id, connection_generation: desktop.connection_generation }).catch(error => { clean = false; console.error(String(error)) })
    await client.close().catch(() => {})
    runtime.close()
    const success = passed && clean && !operationFailed
    const report = { passed: success, finishedAt: new Date().toISOString(), protocol: desktop?.protocol, operations }
    await writeFile(path.join(output, `${desktop?.protocol ?? 'unknown'}-result.json`), JSON.stringify(report, null, 2), 'utf8')
    await fetch('http://127.0.0.1:5193/api/v1/fixture-result', { method: 'POST', headers, body: JSON.stringify({ passed: success }) }).catch(error => { clean = false; console.error(String(error)) })
    app.exit(success && clean ? 0 : 1)
  }
  try {
    const response = await fetch('http://127.0.0.1:5193/api/v1/fixture-target', { headers })
    if (!response.ok) throw new Error('fixture target unavailable')
    const target = await response.json()
    await runtime.start()
    await client.connect(transport)
    desktop = (await call('connect', { profile_id: target.profile_id })).structuredContent.session
    desktop = (await call('get', { session_id: desktop.id, wait_ms: 10000 })).structuredContent.session
    console.log(JSON.stringify({ phase: 'connected', session: desktop }))
    attachment = (await call('attach', { session_id: desktop.id, connection_generation: desktop.connection_generation })).structuredContent.attachment
    for (let i = 0; i < 12 && attachment.state === 'preparing'; i++) {
      attachment = (await call('get', { attachment_id: attachment.id, wait_ms: 10000 })).structuredContent.attachment
    }
    if (attachment.state !== 'ready') throw new Error(JSON.stringify(attachment))
    grant = (await call('control.acquire', { attachment_id: attachment.id })).structuredContent.control.attachment?.grant
    if (!grant) throw new Error('control approval did not produce a grant')
    await capture()
    console.log(JSON.stringify({ phase: 'ready', protocol: target.protocol }))
    let consumed = 0
    // 人工解锁与逐帧核对也需要时间；仍由业务授权独立限制控制期限。
    const deadline = Date.now() + 15 * 60_000
    while (!closing && Date.now() < deadline) {
      try {
        const requests = JSON.parse(await readFile(queue, 'utf8'))
        const request = requests[consumed]
        if (!request) { await new Promise(resolve => setTimeout(resolve, 250)); continue }
        consumed++
        if (request.tool === 'finish') { await finish(request.passed === true); break }
        if (request.tool === 'capture') { await capture(request.args); continue }
        if (request.tool === 'control.acquire') {
          const result = await call('control.acquire', { attachment_id: attachment.id, ...request.args })
          grant = result.structuredContent.control.attachment?.grant
          if (!grant) throw new Error('control approval did not produce a grant')
          console.log(JSON.stringify({ tool: request.tool, granted: true }))
          continue
        }
        const result = await call(request.tool, { attachment_id: attachment.id, grant_id: grant.id, ...(request.tool.startsWith('pointer.') ? { screenshot_id: screenshot.screenshot_id } : {}), ...request.args })
        console.log(JSON.stringify({ tool: request.tool, result: result.structuredContent ?? result.content }))
      } catch (error) { operationFailed = true; console.error(String(error)) }
    }
    if (!closing) await finish(false)
  } catch (error) {
    console.error(String(error))
    await finish(false)
  }
}
void main().catch(error => { console.error(String(error)); app.exit(1) })

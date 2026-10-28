import { app } from 'electron'
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

// 仅连接显式启动并限制到已授权目标的实机夹具；队列支持在长批次运行中查询和取消。
async function main() {
  if (process.env.TERMOUS_DESKTOP_BATCH_LIVE !== '1') throw new Error('需要显式启用桌面批次实机验收')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const output = path.resolve(root, '../TEMP/desktop-batch-live')
  const build = path.join(root, 'build/desktop-batch-live')
  await mkdir(output, { recursive: true })
  await mkdir(build, { recursive: true })
  const queue = path.join(output, 'commands.json')
  await writeFile(queue, '[]', 'utf8')
  const compiled = ts.transpileModule(await readFile(path.join(root, 'electron/desktopAutomation/runtime.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  const modulePath = path.join(build, 'runtime.mjs')
  await writeFile(modulePath, compiled.outputText, 'utf8')
  app.setPath('userData', path.join(output, 'electron'))
  await app.whenReady()
  app.on('window-all-closed', () => {})
  const { DesktopAutomationRuntime } = await import(pathToFileURL(modulePath).href)
  const origin = 'http://127.0.0.1:5193'
  const headers = { 'Content-Type': 'application/json', 'X-Termous-Token': 'fixture-token' }
  const runtime = new DesktopAutomationRuntime({
    config: async () => ({ apiBaseUrl: origin, apiToken: 'fixture-token' }),
    appearance: () => ({ language: 'zh-CN', theme: 'dark' }),
    renderer: path.join(root, 'dist/index.html'),
    preload: path.join(root, 'dist-electron/desktop-automation-preload.cjs'),
    warn: code => console.error(code),
  })
  const client = new Client({ name: 'desktop-batch-live-acceptance', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', origin), {
    authProvider: { token: async () => 'tmcp_fixture-client.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    requestInit: { headers },
  })
  const mutations = new Set(['connect', 'attach', 'detach', 'close', 'control.acquire', 'control.release', 'execute',
    'pointer.move', 'pointer.click', 'pointer.click_current', 'pointer.scroll', 'pointer.drag', 'keyboard.key', 'keyboard.shortcut', 'keyboard.text'])
  const allowed = new Set([...mutations, 'capture', 'get', 'executions.get', 'executions.cancel'])
  const jobs = new Set()
  let session, attachment, grant, screenshot, serial = 0, passed = false, failed = false

  async function call(tool, args = {}, expectedError = false) {
    const result = await client.callTool({ name: `termous.desktops.${tool}`, arguments: {
      ...args, ...(mutations.has(tool) ? { client_request_id: args.client_request_id ?? `batch-live-${++serial}` } : {}),
    } }, { timeout: 180000, maxTotalTimeout: 180000 })
    if (result.isError && !expectedError) throw new Error(JSON.stringify(result.structuredContent ?? result.content))
    return result
  }

  async function save(id, result, elapsed) {
    const data = result.structuredContent
    if (data?.capture) screenshot = data.capture
    const images = []
    for (const [index, content] of result.content.entries()) {
      if (content.type !== 'image') continue
      const filename = path.join(output, `${id}-${index}.png`)
      await writeFile(filename, Buffer.from(content.data, 'base64'))
      images.push(filename)
    }
    const receipt = { tool_error: result.isError === true, elapsed_ms: elapsed, result: data, images }
    const destination = path.join(output, `${id}.json`)
    await writeFile(destination + '.next', JSON.stringify(receipt, null, 2), 'utf8')
    await rename(destination + '.next', destination)
    console.log(JSON.stringify({ id, state: data?.run?.state ?? data?.operation?.state, elapsed_ms: Math.round(elapsed), images }))
  }

  async function perform(command) {
    const { id, tool } = command
    if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(id) || !allowed.has(tool)) throw new Error('测试命令无效')
    const args = { ...command.args }
    if (!['executions.get', 'executions.cancel'].includes(tool)) {
      args.attachment_id ??= attachment.id
      if (tool !== 'capture' && tool !== 'get') args.grant_id ??= grant?.id
      if (tool.startsWith('pointer.') || tool === 'execute' && args.actions?.some(action => action.kind.startsWith('pointer.'))) args.screenshot_id ??= screenshot?.screenshot_id
    }
    const started = performance.now()
    const result = await call(tool, args, true)
    if (tool === 'control.acquire') grant = result.structuredContent.control?.attachment?.grant
    if (tool === 'control.release') grant = undefined
    await save(id, result, performance.now() - started)
    if (result.isError && command.expected_error !== true) throw new Error(`非预期工具错误: ${result.structuredContent?.run?.error_code ?? tool}`)
  }

  try {
    const response = await fetch(`${origin}/api/v1/fixture-target`, { headers })
    if (!response.ok) throw new Error(`目标夹具不可用: ${response.status}`)
    const target = await response.json()
    await runtime.start()
    await client.connect(transport)
    if (!(await client.listTools()).tools.some(tool => tool.name === 'termous.desktops.execute')) throw new Error('当前 Core 未注册桌面批次')
    session = (await call('connect', { profile_id: target.profile_id })).structuredContent.session
    session = (await call('get', { session_id: session.id, wait_ms: 10000 })).structuredContent.session
    attachment = (await call('attach', { session_id: session.id, connection_generation: session.connection_generation })).structuredContent.attachment
    for (let i = 0; i < 12 && attachment.state === 'preparing'; i++) {
      attachment = (await call('get', { attachment_id: attachment.id, wait_ms: 10000 })).structuredContent.attachment
    }
    if (attachment.state !== 'ready') throw new Error(`桌面附着未就绪: ${attachment.state}`)
    grant = (await call('control.acquire', { attachment_id: attachment.id })).structuredContent.control.attachment?.grant
    if (!grant) throw new Error('未取得控制授权')
    await save('initial', await call('capture', { attachment_id: attachment.id }), 0)
    console.log(JSON.stringify({ phase: 'ready', protocol: target.protocol }))
    let consumed = 0
    const deadline = Date.now() + 30 * 60_000
    while (Date.now() < deadline) {
      const requests = JSON.parse(await readFile(queue, 'utf8'))
      const command = requests[consumed]
      if (!command) { await new Promise(resolve => setTimeout(resolve, 100)); continue }
      consumed++
      if (command.tool === 'finish') { await Promise.all(jobs); passed = command.passed === true && !failed; break }
      const job = perform(command).catch(async error => {
        failed = true
        await writeFile(path.join(output, `${command.id}.error.json`), JSON.stringify({ error: String(error) }), 'utf8')
        console.error(JSON.stringify({ id: command.id, error: String(error) }))
      })
      jobs.add(job)
      void job.finally(() => jobs.delete(job))
      if (!command.background) await job
    }
  } finally {
    await Promise.all(jobs)
    // 一项回收失败也要继续关闭其余资源，且不能把带清理错误的测试报告为通过。
    const cleanup = async (name, action) => {
      try { await action() } catch (error) { failed = true; console.error(name, String(error)) }
    }
    if (grant && attachment) await cleanup('release', () => call('control.release', { attachment_id: attachment.id, grant_id: grant.id }))
    if (attachment) await cleanup('detach', () => call('detach', { attachment_id: attachment.id }))
    if (session) await cleanup('close', () => call('close', { session_id: session.id, connection_generation: session.connection_generation }))
    await cleanup('terminate', () => transport.terminateSession())
    await cleanup('client', () => client.close())
    await cleanup('runtime', () => runtime.close())
    passed = passed && !failed
    await cleanup('report', async () => {
      const response = await fetch(`${origin}/api/v1/fixture-result`, { method: 'POST', headers, body: JSON.stringify({ passed }), signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error('无法提交验收结果')
    })
    await cleanup('save-report', () => writeFile(path.join(output, 'session-result.json'), JSON.stringify({ passed: passed && !failed, failed }), 'utf8'))
  }
  app.exit(passed && !failed ? 0 : 1)
}

void main().catch(error => { console.error(String(error)); app.exit(1) })

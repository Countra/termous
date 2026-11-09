import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, utilityProcess } from 'electron'

const output = path.dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(path.join(output, 'config.json'), 'utf8'))
const profile = path.join(output, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.setPath('crashDumps', path.join(output, 'crashes'))
app.setAppLogsPath(path.join(output, 'logs'))
const source = { id: 'fixture', kind: 'mcp', name: 'Fixture', revision: 1, enabled: true,
  mcp: { transport: 'stdio', command: fixture.fixture, args: ['--stdio'] }, secret_configured: false }
const supervisor = spawn(fixture.supervisor, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
const lines = createInterface({ input: supervisor.stdout })
let supervision = Promise.resolve()
function supervise(input) {
  const task = supervision.then(async () => {
    const response = once(lines, 'line', { signal: AbortSignal.timeout(10_000) })
    supervisor.stdin.write(`${JSON.stringify(input)}\n`)
    assert.equal(JSON.parse((await response)[0]).ok, true)
  })
  supervision = task.catch(() => undefined)
  return task
}
let tools = []
const receipts = new Map()
let authorizations = 0
let prepared = false
let confirmed = true
let launchVerifications = 0
const leases = new Set()
// HTTP 仅模拟 Core 合同；进程所有权使用实际 Go Supervisor，MCP 使用官方 Go SDK。
const server = createServer(async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const operation = request.url.split('/').pop()
    let result = {}
    if (operation === 'process') await supervise(input)
    else if (operation === 'config') {
      if (!confirmed) { response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'INTEGRATION_LAUNCH_CONFIRMATION_REQUIRED', message: 'Fixture confirmation required' } })); return }
      if (input.verify_launch) launchVerifications++
      result = prepared
        ? { source: { ...source, mcp: { ...source.mcp, command: 'npx-must-not-run', dependency_id: 'fixture-prepared' } }, secret: {}, launch: { command: fixture.fixture, args: ['--stdio', '--startup-delay=32000'] } }
        : { source, secret: {} }
    }
    else if (operation === 'sources') result = [source]
    else if (operation === 'prepare') result = [{ source, configuration_key: 'fixture' }]
    else if (operation === 'installation-lease') { if (input.release) leases.delete(input.owner); else leases.add(input.owner) }
    else if (operation === 'catalog') tools = input.tools
    else if (operation === 'tools') result = input.name ? tools.find(tool => tool.name === input.name) : tools
    else if (operation === 'receipt') result = receipts.get(input.tool_call_id) ?? null
    else if (operation === 'authorize') {
      authorizations++
      result = { id: input.tool_call_id, generation: 1, state: 'dispatched', may_dispatch: true }
      receipts.set(input.tool_call_id, { ...result, may_dispatch: false })
    } else if (operation === 'settle') receipts.set(input.id, { ...receipts.get(input.id), state: input.state, result: input.result })
    else assert.equal(operation, 'verify-dispatch')
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
  } catch (error) { response.writeHead(500).end(JSON.stringify({ error: { code: 'FIXTURE_FAILED' } })); console.error(error) }
})

function alive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
async function exercise(modulePath, crash) {
  prepared = crash
  const child = utilityProcess.fork(modulePath, [], { cwd: output, stdio: 'ignore' })
  const exited = once(child, 'exit')
  const pending = new Map()
  let ready
  const initialized = new Promise(resolve => { ready = resolve })
  child.on('message', message => {
    if (message.type === 'ready') ready()
    if (message.type === 'result') pending.get(message.id)?.(message)
  })
  let sequence = 0
  const rpc = async payload => {
    const id = String(++sequence)
    let timer
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('扩展宿主未响应')), 15_000)
        pending.set(id, message => message.error ? reject(new Error(message.error)) : resolve(message.value))
        child.postMessage({ type: 'request', id, ...payload })
      })
    } finally { clearTimeout(timer); pending.delete(id) }
  }
  const context = { run_id: crash ? 'crash' : 'normal', session_id: 'session', generation: 1, bearer: 'isolated-fixture' }
  const config = { baseURL: `http://127.0.0.1:${server.address().port}`, token: 'fixture', supervisor: 'fixture' }
  let pid
  try {
    await once(child, 'spawn')
    pid = child.pid
    child.postMessage({ type: 'initialize', config })
    await Promise.race([initialized, delay(10_000).then(() => { throw new Error('扩展宿主未就绪') })])
    confirmed = false
    await assert.rejects(rpc({ operation: 'test', source: source.id, revision: 1 }), /LAUNCH_CONFIRMATION_REQUIRED/u)
    confirmed = true
    const verificationStart = launchVerifications
    const authorizationsStart = authorizations
    const began = Date.now()
    await Promise.all([rpc({ operation: 'prepare', session: context.session_id, owner: 'page' }), rpc({ operation: 'prepare', session: context.session_id, owner: 'page-2' })])
    assert.ok(Date.now() - began < 5000, '准备请求不应等待完整初始化')
    const initial = await rpc({ context, operation: { action: 'directory' } })
    if (crash) { assert.equal(initial.tools.length, 0); assert.ok(Date.now() - began < 15_000) }
    let status
    for (let i = 0; i < 90; i++) {
      status = await rpc({ operation: 'status' })
      if (status.some(value => value.session_id === context.session_id && value.state === 'connected')) break
      await delay(500)
    }
    assert.equal(status.filter(value => value.session_id === context.session_id && value.state === 'connected').length, 1)
    const directory = await rpc({ context, operation: { action: 'directory' } })
    assert.ok(directory.tools.some(tool => tool.name === 'echo'))
    assert.equal(launchVerifications - verificationStart, 1, '多窗口预热与 Run 必须复用同一进程')
    assert.equal(authorizations, authorizationsStart, '预热不得调用业务工具')
    const operation = { action: 'call', source: source.id, revision: 1, name: 'echo', tool_call_id: context.run_id, arguments: { text: 'electron' } }
    const result = await rpc({ context, operation })
    const content = JSON.parse(result.content[0].text)
    assert.equal(content.text, 'electron')
    const remotePID = Number(content.pid)
    assert.ok(alive(remotePID))
    assert.deepEqual(await rpc({ context, operation }), result)
    if (crash) child.kill()
    else child.postMessage({ type: 'close' })
    await exited
    await supervise({ pid, release: true })
    for (let i = 0; i < 40 && alive(remotePID); i++) await delay(50)
    assert.equal(alive(remotePID), false)
  } finally { child.kill(); if (pid) await supervise({ pid, release: true }) }
}

async function main() {
try {
  await app.whenReady()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  await exercise(path.join(output, 'source/dist-electron/agent-integrations.js'), false)
  await exercise(path.join(output, 'fixture.asar/dist-electron/agent-integrations.js'), true)
  assert.equal(authorizations, 2)
  console.log('Electron 扩展验收通过：开发/ASAR、启动确认、32 秒慢初始化、10 秒首次等待、多窗口及 Run 复用、原始及受管 stdio、回执不重派、正常退出与宿主崩溃回收。')
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  server.closeAllConnections(); server.close()
  supervisor.stdin.end(); lines.close()
  await once(supervisor, 'exit')
  app.exit(process.exitCode ?? 0)
}
}
void main()

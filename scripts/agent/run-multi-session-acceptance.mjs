import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import http from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, utilityProcess } from 'electron'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.resolve(web, '../TEMP/runtime/multi-session-acceptance')
const core = 'http://127.0.0.1:8122'
const supervisor = `multi_acceptance_${randomUUID()}`
const port = 18191
const report = { checks: [], sessions: [], runs: [], worker_events: [], cleanup_errors: [] }
const children = new Set()
const responses = new Map()
let lease, provider, model, heartbeat, sequence = 1
let requestChanged = () => undefined
let inspectDone = () => undefined
const server = http.createServer((request, response) => {
  void handleFixture(request, response).catch((error) => {
    response.writeHead(500).end(JSON.stringify({ error: { message: error.message } }))
  })
})

// 仅使用本机合成模型响应；不连接真实模型或远端 SSH，不改默认模型与并发配置。
await mkdir(output, { recursive: true })
for (const [name, directory] of [['userData', 'electron-profile'], ['sessionData', 'electron-session'], ['logs', 'logs'], ['crashDumps', 'crashes']]) app.setPath(name, path.join(output, directory))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
void app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1) })

async function run() {
  let failure
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
    const protocol = /agentRuntimeProtocolVersion = '([^']+)'/u.exec(await readFile(path.join(web, 'common/contracts/agent-runtime.ts'), 'utf8'))[1]
    const skills = skillSnapshot()
    const register = async () => {
      lease = await api('/agent/runtime/supervisor', 'PUT', { supervisor_instance_id: supervisor, runtime_protocol_version: protocol,
        skills_bundle: { status: 'ready', fingerprint: skills.fingerprint, skill_count: 1, resource_count: 1 } })
    }
    await register()
    assert.equal(lease.max_concurrent_runs, 4, '此验收要求当前配置为默认并发 4，不自动覆盖用户配置')
    heartbeat = setInterval(() => { void register().catch(error => { failure = error; for (const child of children) child.kill() }) }, 10000)
    provider = await api('/agent/model-providers', 'POST', { name: `多会话本机验收 ${randomUUID()}`, api_mode: 'chat_completions', base_url: `http://127.0.0.1:${port}/v1`, enabled: true, confirm_insecure_http: true })
    model = (await api(`/agent/model-providers/${provider.id}/models`, 'POST', { remote_model_id: 'multi-fixture', display_name: '本机多会话验收', expected_revision: provider.revision,
      parameter_mode: 'custom', context_window_tokens: 262144, max_output_tokens: 16384, supports_images: false,
      default_reasoning_level: 'off', reasoning_control: 'none', supported_reasoning_levels: ['off'], capabilities_confirmed: true })).model
    for (let index = 0; index < 5; index++) {
      const session = await api('/agent/sessions', 'POST', { title: `并发验收 ${index + 1}`, model_id: model.id, reasoning_level: 'off' })
      report.sessions.push(session.id)
      const run = await api(`/agent/sessions/${session.id}/runs`, 'POST', { client_request_id: randomUUID(), prompt: `MULTI_ACCEPTANCE_${index}：请输出本机验收完成。`, attachment_ids: [] })
      report.runs.push(run)
    }
    const allocations = [], running = []
    for (let index = 0; index < 4; index++) {
      const allocated = await claim()
      assert.ok(allocated.run)
      allocations.push(allocated)
      running.push(await launch(allocated, skills, protocol))
    }
    await waitRequests(4)
    const full = await claim()
    assert.equal(full.run, null)
    assert.equal(full.occupied_slots, 4)
    report.checks.push('4 个真实 Electron Worker 同时请求本机模型，第 5 个 Run 等待')
    await save('awaiting_ui')
    if (process.argv.includes('--inspect-ui')) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('UI 验收释放超时')), 300000)
      inspectDone = () => { clearTimeout(timer); resolve() }
    })
    const firstIndex = report.runs.findIndex(run => run.id === allocations[0].run.id)
    complete(firstIndex)
    await running[0].exited
    // 即便 Run 已完成且进程已退出，Core 也须等显式退出释放才能重新分配名额。
    assert.equal((await api(`/agent/runs/${allocations[0].run.id}`)).status, 'completed')
    assert.equal((await claim()).run, null)
    await release(allocations[0])
    await release(allocations[0])
    const fifth = await claim()
    assert.ok(fifth.run)
    const last = await launch(fifth, skills, protocol)
    await waitRequests(4)
    report.checks.push('业务完成和实际退出均不自动释放名额；幂等退出回执后第 5 个 Run 启动')
    for (const index of responses.keys()) complete(index)
    await Promise.all([...running.slice(1).map(entry => entry.exited), last.exited])
    for (const allocation of [...allocations.slice(1), fifth]) await release(allocation)
    assert.equal((await claim()).occupied_slots, 0)
    for (const run of report.runs) assert.equal((await api(`/agent/runs/${run.id}`)).status, 'completed')
    report.checks.push('五个独立会话均持久化完成，全部进程名额已回收')
    if (failure) throw failure
    report.success = true
  } catch (error) {
    failure = error
    report.success = false
    report.error = error.message
  } finally {
    clearInterval(heartbeat)
    for (const child of children) child.kill()
    // 清理仅针对本次脚本创建的 ID，失败时先将未完成 Run 收口。
    for (const run of report.runs) {
      try {
        const current = await api(`/agent/runs/${run.id}`)
        report.worker_events.push({ run_id: run.id, status: current.status, error_code: current.error_code, error_message: current.error_message })
        if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(current.status)) await api(`/agent/runs/${run.id}/runtime-failures`, 'POST', { supervisor_instance_id: supervisor, generation: run.generation, category: 'forced_stop' })
      } catch (error) { report.cleanup_errors.push(error.message) }
    }
    if (lease) {
      try { await api('/agent/runtime/supervisor', 'DELETE', { supervisor_instance_id: supervisor, expected_revision: lease.revision }) }
      catch (error) { report.cleanup_errors.push(error.message) }
    }
    for (const [resource, ids] of [['sessions', report.sessions], ['models', model ? [model.id] : []], ['model-providers', provider ? [provider.id] : []]]) {
      for (const id of ids) {
        try { const current = await api(`/agent/${resource}/${id}`); await api(`/agent/${resource}/${id}`, 'DELETE', { expected_revision: current.revision }) }
        catch (error) { report.cleanup_errors.push(error.message) }
      }
    }
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await save('finished')
    console.log(JSON.stringify({ success: report.success, checks: report.checks, error: report.error, cleanup_errors: report.cleanup_errors }))
    app.exit(failure || report.cleanup_errors.length ? 1 : 0)
  }
}

async function claim() {
  const input = { supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch, claim_sequence: sequence++ }
  const result = await api('/agent/runtime/queue/claim-next', 'POST', input)
  const repeated = await api('/agent/runtime/queue/claim-next', 'POST', input)
  assert.equal(repeated.execution_id, result.execution_id, '重复领取必须返回原分配')
  return result
}
async function release(allocation) {
  await api('/agent/runtime/executions/release', 'POST', { execution_id: allocation.execution_id, run_id: allocation.run.id, generation: allocation.run.generation,
    supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch })
}
async function launch(allocation, skills, protocol) {
  const run = allocation.run
  const ticket = await api(`/agent/runs/${run.id}/runtime-tickets`, 'POST', { supervisor_instance_id: supervisor, expected_generation: run.generation, execution_id: allocation.execution_id })
  const child = utilityProcess.fork(path.join(web, 'dist-electron/agent-worker.js'), [], { cwd: web, stdio: 'pipe', serviceName: 'Termous Multi Session Acceptance' })
  children.add(child)
  let settled = false, fatal = ''
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Worker 退出超时')) }, 300000)
    child.on('message', message => {
      report.worker_events.push({ run_id: run.id, type: message.type, category: message.category })
      if (message.type === 'settled') settled = true
      if (message.type === 'fatal') fatal = message.category
    })
    child.once('exit', code => {
      report.worker_events.push({ run_id: run.id, exit_code: code })
      clearTimeout(timer); children.delete(child)
      if (code === 0 && settled && !fatal) resolve()
      else reject(new Error(`Worker 退出异常 ${code} ${fatal}`))
    })
    child.once('spawn', () => child.postMessage({ type: 'start', protocol_version: protocol, core_base_url: core, ticket: ticket.ticket, run_id: run.id, generation: run.generation, skills }))
  })
  void exited.catch(() => undefined)
  return { exited }
}
async function handleFixture(request, response) {
  if (request.url === '/release' && request.method === 'POST') { inspectDone(); response.end('ok'); return }
  assert.equal(request.url, '/v1/chat/completions')
  let data = ''
  for await (const chunk of request) { data += chunk.toString(); assert.ok(data.length < 4 << 20) }
  const body = JSON.parse(data)
  assert.equal(body.model, 'multi-fixture')
  const index = Number(/MULTI_ACCEPTANCE_(\d+)/u.exec(JSON.stringify(body.messages))[1])
  responses.set(index, response)
  requestChanged()
}
function complete(index) {
  const response = responses.get(index)
  assert.ok(response)
  responses.delete(index)
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const delta of [{ role: 'assistant', content: `会话 ${index + 1} 验收完成。` }, {}]) {
    response.write(`data: ${JSON.stringify({ id: `multi-${index}`, object: 'chat.completion.chunk', created: 1, model: 'multi-fixture', choices: [{ index: 0, delta, finish_reason: delta.role ? null : 'stop' }] })}\n\n`)
  }
  response.end('data: [DONE]\n\n')
}
async function waitRequests(count) {
  if (responses.size >= count) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`模型请求未到齐: ${responses.size}/${count}`)), 30000)
    requestChanged = () => { if (responses.size >= count) { clearTimeout(timer); resolve() } }
  })
}
async function api(resource, method = 'GET', body) {
  const response = await fetch(`${core}/api/v1${resource}`, { method, headers: { 'X-Termous-Token': 'dev-token', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`${method} ${resource}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}
async function save(phase) { await writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, phase }, null, 2), 'utf8') }
function skillSnapshot() {
  const hash = value => createHash('sha256').update(value).digest('hex')
  const content = '# 本机并发验收\n此样例不执行远程操作。\n'
  const uri = 'skill://multi-acceptance/SKILL.md'
  const catalog = [{ name: 'multi-acceptance', description: '本机并发验收', entry_uri: uri }]
  const resources = [{ uri, sha256: hash(content), size: Buffer.byteLength(content), media_type: 'text/markdown; charset=utf-8', content }]
  return { format_version: 1, fingerprint: hash(JSON.stringify({ format_version: 1, catalog, resources: resources.map(({ uri, sha256, size, media_type }) => ({ uri, sha256, size, media_type })) })), catalog, resources }
}

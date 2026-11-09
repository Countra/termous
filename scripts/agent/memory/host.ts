import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow, utilityProcess } from 'electron'
import { imageMaterializationBudget } from '../../../electron/agent/host/imageMaterializationBudget.ts'
import { agentRuntimeProtocolVersion } from '../../../common/contracts/agent-runtime.ts'

// 仅连接专用隔离 Core；主进程是验收宿主，不能把其指标冒充完整 Termous 主进程。
const root = process.cwd()
const output = path.resolve(root, '../TEMP/agent-memory-research', process.env.TERMOUS_MEMORY_LABEL ?? 'electron-measurement')
const core = 'http://127.0.0.1:18122'
const token = 'memory-acceptance-local'
const supervisor = `memory_${randomUUID()}`
const concurrency = Number(process.env.TERMOUS_MEMORY_CONCURRENCY ?? 4)
const rounds = Number(process.env.TERMOUS_MEMORY_ROUNDS ?? 500)
const workers = new Set<Electron.UtilityProcess>()
const runs: Array<{ id: string; session_id: string; generation: number }> = []
let lease: { supervisor_epoch: number; revision: number }
let sequence = 0
let heartbeat: NodeJS.Timeout | undefined
let sampler: NodeJS.Timeout | undefined
let sampling = false
let failed: unknown
let window: BrowserWindow | undefined
const execFileAsync = promisify(execFile)
mkdirSync(output, { recursive: true })
for (const key of ['userData', 'sessionData', 'logs', 'crashDumps'] as const) {
  const directory = path.join(output, key)
  mkdirSync(directory, { recursive: true })
  app.setPath(key, directory)
}
app.on('window-all-closed', () => {})
void app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })

async function api(resource: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${core}/api/v1${resource}`, { method,
    headers: { 'X-Termous-Token': token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${method} ${resource}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}
function record(value: unknown) { appendFileSync(path.join(output, 'samples.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...value as object }) + '\n') }
function skills() {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const content = '# Memory acceptance\nUse the local observation fixture. Never execute remote commands.\n'
  const uri = 'skill://memory-acceptance/SKILL.md'
  const catalog = [{ name: 'memory-acceptance', description: 'Local memory acceptance.', entry_uri: uri }]
  const resources = [{ uri, sha256: hash(content), size: Buffer.byteLength(content), media_type: 'text/markdown; charset=utf-8', content }]
  return { format_version: 1, fingerprint: hash(JSON.stringify({ format_version: 1, catalog, resources: resources.map(({ uri, sha256, size, media_type }) => ({ uri, sha256, size, media_type })) })), catalog, resources }
}
async function sample() {
  if (sampling) return
  sampling = true
  try {
    const response = await fetch('http://127.0.0.1:18123/memory', { headers: { 'X-Termous-Token': token }, signal: AbortSignal.timeout(5000) })
    assert.ok(response.ok)
    const coreMemory = await response.json()
    if (process.platform === 'win32' && Number.isSafeInteger(coreMemory.pid) && coreMemory.pid > 0) {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${coreMemory.pid} -ErrorAction Stop).PrivateMemorySize64`], { windowsHide: true, timeout: 5000 })
      coreMemory.private_bytes = Number(stdout.trim())
      assert.ok(Number.isSafeInteger(coreMemory.private_bytes) && coreMemory.private_bytes > 0)
    }
    record({ type: 'host_memory', main: process.memoryUsage(), processes: app.getAppMetrics(), core: coreMemory })
    // 仅采集 Chromium 指标，不调用 GC，也不保存不断增长的快照数组。
    if (window && !window.isDestroyed()) {
      const renderer = await window.webContents.executeJavaScript('({heap: performance.memory && {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize}, dom: document.getElementsByTagName("*").length})')
      record({ type: 'renderer_memory', renderer })
    }
  } finally { sampling = false }
}
async function launch(allocation: { execution_id: string; run: { id: string; generation: number } }, bundle: ReturnType<typeof skills>, instance: number) {
  const run = allocation.run
  const ticket = await api(`/agent/runs/${run.id}/runtime-tickets`, 'POST', { supervisor_instance_id: supervisor, expected_generation: run.generation, execution_id: allocation.execution_id })
  const child = utilityProcess.fork(path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory-worker.js'), [], {
    cwd: root, stdio: 'pipe', serviceName: 'Termous Memory Acceptance Worker',
    env: { ...process.env, TERMOUS_MEMORY_INSTANCE: String(instance) },
  })
  workers.add(child)
  let settled = '', fatal = ''
  child.stdout?.on('data', data => appendFileSync(path.join(output, `worker-${instance}.log`), data))
  child.stderr?.on('data', data => appendFileSync(path.join(output, `worker-${instance}.log`), data))
  return await new Promise<void>((resolve, reject) => {
    child.on('message', message => {
      if (message.type === 'memory_sample') { record({ ...message, run_id: run.id }); return }
      if (message.type === 'image_budget') {
        if (message.action === 'release') imageMaterializationBudget.release(run.id, message.request_id)
        else imageMaterializationBudget.acquire({ owner: run.id, id: message.request_id, bytes: message.bytes,
          grant: () => child.postMessage({ type: 'image_budget_granted', run_id: run.id, generation: run.generation, request_id: message.request_id }),
          reject: error => child.postMessage({ type: 'image_budget_rejected', run_id: run.id, generation: run.generation, request_id: message.request_id, message: String(error) }) })
        return
      }
      record({ type: 'worker_event', run_id: run.id, event: message })
      if (message.type === 'settled') { settled = message.outcome; child.postMessage({ type: 'finish_ack' }) }
      if (message.type === 'fatal') { fatal = message.category; child.postMessage({ type: 'finish_ack' }) }
    })
    child.once('spawn', () => child.postMessage({ type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: core,
      ticket: ticket.ticket, run_id: run.id, generation: run.generation, skills: bundle }))
    child.once('exit', code => {
      workers.delete(child); imageMaterializationBudget.release(run.id)
      if (code === 0 && settled === 'completed' && !fatal) resolve()
      else reject(new Error(`Worker ${instance}: exit=${code}, status=${settled}, fatal=${fatal}`))
    })
  }).finally(() => api('/agent/runtime/executions/release', 'POST', { execution_id: allocation.execution_id, run_id: run.id, generation: run.generation,
    supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch }))
}
async function run() {
  const started = Date.now()
  const bundle = skills()
  try {
    assert.ok([1, 4, 8].includes(concurrency))
    await api('/agent/setup', 'POST', {})
    const settings = await api('/settings/agent')
    await api('/settings/agent', 'PATCH', { expected_revision: settings.revision, patch: { max_concurrent_runs: concurrency } })
    const register = async () => { lease = await api('/agent/runtime/supervisor', 'PUT', { supervisor_instance_id: supervisor, runtime_protocol_version: agentRuntimeProtocolVersion,
      skills_bundle: { status: 'ready', fingerprint: bundle.fingerprint, skill_count: 1, resource_count: 1 } }) }
    await register()
    heartbeat = setInterval(() => { void register().catch(error => { failed = error }) }, 10000)
    const provider = await api('/agent/model-providers', 'POST', { name: `Memory fixture ${randomUUID()}`, api_mode: 'chat_completions',
      base_url: 'http://127.0.0.1:18123/v1', enabled: true, confirm_insecure_http: true })
    const { model } = await api(`/agent/model-providers/${provider.id}/models`, 'POST', { remote_model_id: 'memory-fixture', display_name: 'Memory fixture', expected_revision: provider.revision,
      parameter_mode: 'custom', context_window_tokens: 262144, max_output_tokens: 16384, supports_images: true,
      default_reasoning_level: 'off', reasoning_control: 'none', supported_reasoning_levels: ['off'], capabilities_confirmed: true })
    const configured = await api('/settings/agent')
    await api('/settings/agent', 'PATCH', { expected_revision: configured.revision, patch: { default_model_id: model.id } })
    for (let index = 0; index < concurrency; index++) {
      const session = await api('/agent/sessions', 'POST', { title: `Memory ${index + 1}`, model_id: model.id, reasoning_level: 'off' })
      runs.push(await api(`/agent/sessions/${session.id}/runs`, 'POST', { client_request_id: randomUUID(),
        prompt: `MEMORY_ACCEPTANCE_${index}: Observe ${rounds} rounds.\n${'Preserve this local observation context. '.repeat(10000)}`, attachment_ids: [] }))
    }
    writeFileSync(path.join(output, 'runs.json'), JSON.stringify(runs, null, 2))
    window = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } })
    await window.loadURL('http://127.0.0.1:15173/')
    // 验收必须覆盖正在展示消息的视图，不能只测后台保活页面。
    let opened = false
    for (let attempt = 0; attempt < 100 && !opened; attempt++) {
      opened = await window.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[data-tour="nav-agent"]');
        if (!button) return false;
        button.click(); return true;
      })()`)
      if (!opened) await delay(100)
    }
    assert.ok(opened, 'Agent 页面入口未加载')
    await delay(500)
    sampler = setInterval(() => { void sample().catch(error => { failed = error }) }, 5000)
    await sample()
    const tasks = []
    for (let index = 0; index < concurrency; index++) {
      const allocation = await api('/agent/runtime/queue/claim-next', 'POST', { supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch, claim_sequence: ++sequence })
      assert.ok(allocation.run)
      tasks.push(launch(allocation, bundle, index))
    }
    await Promise.all(tasks)
    for (const run of runs) assert.equal((await api(`/agent/runs/${run.id}`)).status, 'completed')
    await sample()
    if (failed) throw failed
    writeFileSync(path.join(output, 'result.json'), JSON.stringify({ success: true, concurrency, rounds, elapsed_ms: Date.now() - started, model: 'local fixture', active_agent_view: true, gc_forced: false }, null, 2))
  } catch (error) {
    failed = error
    writeFileSync(path.join(output, 'result.json'), JSON.stringify({ success: false, error: String(error), elapsed_ms: Date.now() - started }, null, 2))
    console.error(error)
  } finally {
    clearInterval(heartbeat); clearInterval(sampler)
    for (const child of workers) child.kill()
    window?.destroy()
    if (lease) await api('/agent/runtime/supervisor', 'DELETE', { supervisor_instance_id: supervisor, expected_revision: lease.revision }).catch(error => { console.error(error); failed = error })
    app.exit(failed ? 1 : 0)
  }
}

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import http from 'node:http'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, utilityProcess } from 'electron'
import {
  compactionFixtureModel,
  compactionFixturePort,
  compactionFixtureSkillURI,
  compactionFixtureSteer,
  createCompactionAcceptanceFixture,
} from './compaction-acceptance-fixture.mjs'

const webDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outputDirectory = path.resolve(webDirectory, '..', 'TEMP', 'runtime', 'compaction-acceptance')
const coreURL = 'http://127.0.0.1:8122'
const workerCoreURL = 'http://127.0.0.1:18190'
const supervisorID = `acceptance_${randomUUID()}`
const report = { started_at: new Date().toISOString(), providers: [], models: [], sessions: [], runs: [], checks: [] }
const fixture = createCompactionAcceptanceFixture()
const coreProxy = http.createServer((request, response) => {
  let requestBody = ''
  if (request.url.endsWith('/runtime-events')) {
    request.on('data', (chunk) => { requestBody += chunk.toString('utf8') })
  }
  const upstream = http.request(new URL(request.url, coreURL), { method: request.method, headers: request.headers }, (received) => {
    response.writeHead(received.statusCode, received.headers)
    if (received.statusCode >= 400) {
      let body = ''
      received.on('data', (chunk) => { if (body.length < 16000) body += chunk.toString('utf8') })
      received.on('end', () => {
        report.http_errors ??= []
        let events
        try {
          events = JSON.parse(requestBody).events?.map((event) => ({
            kind: event.kind, sequence: event.sequence,
            ...(event.payload.steer_applied ? { steer_applied: event.payload.steer_applied } : {}),
          }))
        } catch { events = undefined }
        report.http_errors.push({ path: request.url, status: received.statusCode, body, events })
      })
    }
    received.pipe(response)
  })
  upstream.on('error', (error) => { response.writeHead(502); response.end(error.message) })
  request.pipe(upstream)
})
let lease
let renewal = Promise.resolve()
let heartbeat
let activeWorker
let activeRun
let failure

await mkdir(outputDirectory, { recursive: true })
app.setPath('userData', path.join(outputDirectory, 'electron-profile'))
app.setPath('sessionData', path.join(outputDirectory, 'electron-session'))
app.setPath('logs', path.join(outputDirectory, 'electron-logs'))
app.setPath('crashDumps', path.join(outputDirectory, 'electron-crashes'))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
// ESM 主入口不能顶层等待 ready，否则 Electron 会等待模块加载而无法发出 ready。
void app.whenReady().then(runAcceptance).catch((error) => {
  console.error(error)
  app.exit(1)
})

async function runAcceptance() {
  try {
    await mkdir(outputDirectory, { recursive: true })
    const protocolSource = await readFile(path.join(webDirectory, 'common/contracts/agent-runtime.ts'), 'utf8')
    const protocolVersion = /agentRuntimeProtocolVersion = '([^']+)'/u.exec(protocolSource)?.[1]
    assert.ok(protocolVersion)
    const skills = skillSnapshot()
    const register = async () => {
      lease = await api('/agent/runtime/supervisor', 'PUT', {
        supervisor_instance_id: supervisorID, runtime_protocol_version: protocolVersion,
        skills_bundle: { status: 'ready', fingerprint: skills.fingerprint, skill_count: 1, resource_count: 1 },
      })
    }
    await fixture.listen()
    await new Promise((resolve, reject) => {
      coreProxy.once('error', reject)
      coreProxy.listen(18190, '127.0.0.1', resolve)
    })
    await register()
    heartbeat = setInterval(() => {
      renewal = renewal.then(register).catch((error) => { failure = error; activeWorker?.kill() })
    }, 10000)
    const initialSettings = await api('/agent/settings')
    for (const mode of ['chat_completions', 'responses']) {
      const model = await ensureModel(mode)
      const session = await api('/agent/sessions', 'POST', {
        title: `上下文压缩验收 ${mode} ${new Date().toISOString()}`, model_id: model.id, reasoning_level: 'high',
      })
      report.sessions.push({ id: session.id, mode })
      await appendFile(path.join(outputDirectory, 'identities.jsonl'), JSON.stringify({ kind: 'session', id: session.id, mode }) + '\n')
      await saveReport()
      const completed = await runScenario(session, `${mode}-double`, 8, {
        steer: true, skills, protocolVersion,
      })
      assert.equal(completed.run.status, 'completed')
      assert.ok(completed.compactions.filter((event) => event.payload.compaction.status === 'completed').length >= 2)
      assert.equal(completed.events.filter((event) => event.kind === 'steer_applied').length, 1)
      assert.ok(completed.requests.filter((entry) => entry.kind === 'main').every((entry) => entry.steer_count <= 1))
      const firstSummary = completed.requests.findIndex((entry) => entry.kind === 'summary')
      assert.ok(completed.requests.slice(firstSummary + 1).some((entry) => entry.kind === 'main' && entry.steer_count === 1))
      assert.ok(completed.requests.filter((entry) => entry.kind === 'summary').every((entry) => entry.tool_count === 0 && entry.reasoning === 'minimal'))
      const restored = await runScenario(session, `${mode}-restore`, 0, { skills, protocolVersion })
      assert.equal(restored.run.status, 'completed')
      assert.equal(restored.requests.filter((entry) => entry.kind === 'main').length, 1)
      assert.equal(restored.requests.find((entry) => entry.kind === 'main')?.summary_count, 1)
      assert.equal(restored.compactions.length, 0)
      report.checks.push(`${mode}: 同任务多次压缩、工具与追加指令、下一任务恢复通过`)
      await saveReport()
      if (mode === 'chat_completions') {
        for (const fault of ['length', 'cancel']) {
          const faultSession = await api('/agent/sessions', 'POST', {
            title: `上下文压缩验收 ${fault} ${new Date().toISOString()}`, model_id: model.id, reasoning_level: 'high',
          })
          report.sessions.push({ id: faultSession.id, mode, fault })
          await appendFile(path.join(outputDirectory, 'identities.jsonl'), JSON.stringify({ kind: 'session', id: faultSession.id, mode, fault }) + '\n')
          const failed = await runScenario(faultSession, `${mode}-${fault}`, 8, {
            cancel: fault === 'cancel', skills, protocolVersion,
          })
          assert.equal(failed.run.status, fault === 'cancel' ? 'cancelled' : 'failed')
          assert.equal(failed.compactions.filter((event) => event.payload.compaction.status === 'completed').length, 0)
          assert.deepEqual(failed.compactions.map((event) => event.payload.compaction.status), ['started', fault === 'cancel' ? 'cancelled' : 'failed'])
          const retry = await runScenario(faultSession, `${mode}-${fault}-retry-safe`, 0, { skills, protocolVersion })
          assert.equal(retry.run.status, 'completed')
          report.checks.push(`${mode}: ${fault} 保留原始上下文并在新任务重试通过`)
        }
      }
    }
    assert.deepEqual(await api('/agent/settings'), initialSettings, '验收不得修改全局设置')
    report.success = true
  } catch (error) {
    failure ??= error
    report.success = false
    report.error = { message: failure.message, stack: failure.stack }
    if (activeRun) {
      try {
        const snapshot = await api(`/agent/runs/${activeRun.id}`)
        const events = await collectEvents(activeRun.id, activeRun.generation)
        await writeFile(path.join(outputDirectory, `failure-${activeRun.id}.json`), JSON.stringify({ snapshot, events }, null, 2), 'utf8')
        await api(`/agent/runs/${activeRun.id}/runtime-failures`, 'POST', {
          supervisor_instance_id: supervisorID, generation: activeRun.generation, category: 'forced_stop',
        })
      } catch (cleanupError) { report.cleanup_error = cleanupError.message }
    }
  } finally {
    clearInterval(heartbeat)
    await renewal
    activeWorker?.kill()
    if (lease) {
      try {
        await api('/agent/runtime/supervisor', 'DELETE', {
          supervisor_instance_id: supervisorID, expected_revision: lease.revision,
        })
      } catch (error) { report.cleanup_error = error.message }
    }
    await fixture.close()
    coreProxy.closeAllConnections()
    await new Promise((resolve) => coreProxy.close(resolve))
    await cleanupCreatedResources()
    report.finished_at = new Date().toISOString()
    report.requests = fixture.requests
    await saveReport()
    console.log(JSON.stringify({ success: report.success, report: path.join(outputDirectory, 'report.json'), error: report.error?.message }))
    app.exit(report.success ? 0 : 1)
  }
}

async function runScenario(session, name, rounds, options) {
  const run = await api(`/agent/sessions/${session.id}/runs`, 'POST', {
    client_request_id: `compaction_acceptance_${randomUUID()}`,
    prompt: `COMPACTION_ACCEPTANCE_REQUEST：执行 ${name} 安全本地 Skill 读取验收。`, attachment_ids: [],
  })
  activeRun = run
  report.runs.push({ id: run.id, session_id: session.id, scenario: name })
  await appendFile(path.join(outputDirectory, 'identities.jsonl'), JSON.stringify({ kind: 'run', id: run.id, session_id: session.id, scenario: name }) + '\n')
  await saveReport()
  const ticket = await api(`/agent/runs/${run.id}/runtime-tickets`, 'POST', {
    supervisor_instance_id: supervisorID, expected_generation: run.generation,
  })
  const firstRequest = fixture.requests.length
  const outbound = []
  let sentSteer = false
  fixture.arm(name, rounds, async () => {
    if (options.cancel && !sentSteer) {
      sentSteer = true
      const current = await api(`/agent/runs/${run.id}`)
      await api(`/agent/runs/${run.id}/stop`, 'POST', {
        expected_revision: current.revision, expected_generation: run.generation,
      })
      activeWorker.postMessage({ type: 'abort', run_id: run.id, generation: run.generation })
    }
    if (options.steer && !sentSteer) {
      sentSteer = true
      activeWorker.postMessage({ type: 'steer', run_id: run.id, generation: run.generation,
        client_request_id: `agsr_acceptance_${randomUUID()}`, message: compactionFixtureSteer })
    }
  })
  const child = utilityProcess.fork(path.join(webDirectory, 'dist-electron/agent-worker.js'), [], {
    cwd: webDirectory, serviceName: 'Termous Compaction Acceptance', stdio: 'pipe',
    env: { ...process.env, TEMP: path.resolve(outputDirectory, '..'), TMP: path.resolve(outputDirectory, '..') },
  })
  activeWorker = child
  const stderr = []
  child.stderr?.on('data', (chunk) => { stderr.push(chunk.toString('utf8')) })
  const outcome = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Worker 场景超时: ${name}`)) }, 120000)
    child.on('message', (message) => {
      outbound.push(message)
      if (message.type === 'fatal') {
        clearTimeout(timeout)
        reject(new Error(`Worker fatal: ${message.category}`))
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const settled = outbound.find((message) => message.type === 'settled')
      if (code !== 0 || !settled) reject(new Error(`Worker 退出异常 ${code}: ${stderr.join('').slice(-3000)}`))
      else resolve(settled.outcome)
    })
    child.once('spawn', () => child.postMessage({
      type: 'start', protocol_version: options.protocolVersion,
      core_base_url: workerCoreURL, ticket: ticket.ticket, run_id: run.id, generation: run.generation, skills: options.skills,
    }))
  })
  activeWorker = undefined
  const persisted = await api(`/agent/runs/${run.id}`)
  const events = await collectEvents(run.id, run.generation)
  const compactions = events.filter((event) => event.kind === 'compaction')
  const result = { scenario: name, outcome, run: persisted, events, compactions,
    requests: fixture.requests.slice(firstRequest), outbound }
  await writeFile(path.join(outputDirectory, `${name}-${run.id}.json`), JSON.stringify(result, null, 2), 'utf8')
  report.runs[report.runs.length - 1].status = persisted.status
  console.log(JSON.stringify({ scenario: name, outcome, compactions: compactions.map((event) => event.payload.compaction.status), requests: result.requests.length, error_code: persisted.error_code }))
  activeRun = undefined
  return result
}

async function ensureModel(mode) {
  const baseURL = `http://127.0.0.1:${compactionFixturePort}/v1`
  const name = `Termous 压缩验收 ${mode}`
  const providers = await api('/agent/model-providers?limit=200')
  let provider = providers.items.find((item) => item.name === name && item.base_url === baseURL && item.api_mode === mode)
  const createdProvider = !provider
  if (!provider) provider = await api('/agent/model-providers', 'POST', {
    name, api_mode: mode, base_url: baseURL, enabled: true, confirm_insecure_http: true,
  })
  report.providers.push({ id: provider.id, mode, created: createdProvider })
  await appendFile(path.join(outputDirectory, 'identities.jsonl'), JSON.stringify({ kind: 'provider', id: provider.id, mode, created: createdProvider }) + '\n')
  await saveReport()
  const models = await api(`/agent/model-providers/${provider.id}/models?limit=200`)
  let model = models.items.find((item) => item.remote_model_id === compactionFixtureModel)
  const createdModel = !model
  if (!model) {
    const created = await api(`/agent/model-providers/${provider.id}/models`, 'POST', {
      remote_model_id: compactionFixtureModel, display_name: '上下文压缩安全验收', expected_revision: provider.revision,
      parameter_mode: 'custom', context_window_tokens: 65536, max_output_tokens: 16384,
      supports_images: false, default_reasoning_level: 'high', reasoning_control: 'openai_effort',
      supported_reasoning_levels: ['minimal', 'high'], capabilities_confirmed: true,
    })
    model = created.model
  }
  assert.equal(model.context_window_tokens, 65536)
  assert.equal(model.max_output_tokens, 16384)
  report.models.push({ id: model.id, mode, created: createdModel })
  await appendFile(path.join(outputDirectory, 'identities.jsonl'), JSON.stringify({ kind: 'model', id: model.id, mode, created: createdModel }) + '\n')
  await saveReport()
  return model
}

async function collectEvents(runID, generation) {
  const events = []
  let after = 0
  while (true) {
    const page = await api(`/agent/runs/${runID}/events?generation=${generation}&after_sequence=${after}&limit=200`)
    if (!page.items.length) return events
    events.push(...page.items)
    after = page.items[page.items.length - 1].sequence
    if (page.items.length < 200) return events
  }
}

async function api(resource, method = 'GET', body) {
  const response = await fetch(`${coreURL}/api/v1${resource}`, {
    method, headers: { 'X-Termous-Token': 'dev-token', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`${method} ${resource}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}

async function saveReport() {
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
}

async function cleanupCreatedResources() {
  // 只按本次创建记录清理验收数据，复用的 Provider 和模型不属于删除范围。
  for (const [collection, resource] of [
    [report.sessions, 'sessions'],
    [report.models.filter((item) => item.created), 'models'],
    [report.providers.filter((item) => item.created), 'model-providers'],
  ]) {
    for (const item of collection) {
      try {
        const current = await api(`/agent/${resource}/${item.id}`)
        await api(`/agent/${resource}/${item.id}`, 'DELETE', { expected_revision: current.revision })
        item.removed = true
        await appendFile(path.join(outputDirectory, 'identities.jsonl'), JSON.stringify({ kind: 'removed', resource, id: item.id }) + '\n')
      } catch (error) {
        report.cleanup_errors ??= []
        report.cleanup_errors.push({ id: item.id, message: error.message })
      }
    }
  }
}

function skillSnapshot() {
  const content = '# 安全压缩验收\n此 Skill 仅是读取样例；不得执行远程操作。\n'
  const catalog = [{ name: 'termous-compaction-acceptance', description: '读取本地文本的压缩验收', entry_uri: compactionFixtureSkillURI }]
  const resources = [{ uri: compactionFixtureSkillURI, sha256: hash(content), size: Buffer.byteLength(content), media_type: 'text/markdown; charset=utf-8', content }]
  const canonical = JSON.stringify({ format_version: 1, catalog,
    resources: resources.map(({ uri, sha256, size, media_type }) => ({ uri, sha256, size, media_type })) })
  return { format_version: 1, fingerprint: hash(canonical), catalog, resources }
}

function hash(value) { return createHash('sha256').update(value).digest('hex') }

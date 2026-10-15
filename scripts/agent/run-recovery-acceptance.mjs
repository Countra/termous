import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, utilityProcess } from 'electron'
import { validateAgentSkillsBundleDirectory } from './validate-skills-bundle.mjs'
import { recoveryEvidence } from './recovery-acceptance-evidence.mjs'

// 使用既有认证链；不读取模型密钥，不新建主机、Profile 或模型配置。
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.resolve(web, '../TEMP/runtime/agent-progress')
const core = 'http://127.0.0.1:8122'
const supervisor = `recovery_acceptance_${randomUUID()}`
const report = { started_at: new Date().toISOString(), cases: [], sessions: [], cleanup_errors: [] }
let lease, heartbeat, child, allocation, sequence = 1, supervisorError
const originalDesktops = new Set()
const createdDesktops = new Set()
await mkdir(output, { recursive: true })
for (const [name, folder] of [['userData', 'electron-profile'], ['sessionData', 'electron-session'], ['logs', 'logs'], ['crashDumps', 'crashes']]) app.setPath(name, path.join(output, folder))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
void app.whenReady().then(main).catch((error) => { console.error(error.message); app.exit(1) })

async function main() {
  try {
    const bundle = path.join(web, 'build/agent/skills')
    const manifest = await validateAgentSkillsBundleDirectory(bundle)
    const resources = await Promise.all(manifest.resources.map(async ({ path: relative, ...entry }) => ({ ...entry, content: await readFile(path.join(bundle, relative), 'utf8') })))
    const skills = { format_version: manifest.format_version, fingerprint: manifest.fingerprint, catalog: manifest.catalog, resources }
    const protocol = /agentRuntimeProtocolVersion = '([^']+)'/u.exec(await readFile(path.join(web, 'common/contracts/agent-runtime.ts'), 'utf8'))?.[1]
    assert.ok(protocol, '未找到 Runtime 协议版本')
    const register = async () => {
      lease = await api('/agent/runtime/supervisor', 'PUT', { supervisor_instance_id: supervisor, runtime_protocol_version: protocol,
        skills_bundle: { status: 'ready', fingerprint: skills.fingerprint, skill_count: skills.catalog.length, resource_count: skills.resources.length } })
    }
    await register()
    heartbeat = setInterval(() => { void register().catch((error) => { supervisorError = error; child?.kill() }) }, 10000)
    const models = (await api('/agent/models')).items
    const model = models.find((item) => item.remote_model_id === 'glm-5.3-flash')
    assert.ok(model, '未找到已配置的 glm-5.3-flash')
    const hosts = await api('/host-assets')
    const profiles = await api('/remote-desktop-profiles')
    const targets = ['VM-Debian12', 'win'].map((name) => {
      const host = hosts.find((item) => item.name === name)
      assert.ok(host, `未找到主机 ${name}`)
      const candidates = profiles.filter((item) => item.host_id === host.id)
      const profile = name === 'win' ? candidates.find((item) => item.name === 'win测试' && item.protocol === 'rdp')
        : candidates.find((item) => item.protocol === 'vnc' && item.is_default) ?? (candidates.length === 1 ? candidates[0] : undefined)
      assert.ok(profile, `未找到准确 Profile ${name}`)
      return profile
    })
    for (const desktop of await api('/remote-desktop-sessions')) originalDesktops.add(desktop.id)
    for (let index = 0; index < 5; index++) {
      const profile = targets[index % 2]
      const session = await api('/agent/sessions', 'POST', { title: `首次恢复验收 ${index + 1}`, model_id: model.id, reasoning_level: 'low',
        resource_reference: { kind: 'desktop_profile', desktop_profile_id: profile.id } })
      report.sessions.push(session.id)
      const entry = { index: index + 1, profile_id: profile.id, protocol: profile.protocol, history: index >= 3, runs: [] }
      report.cases.push(entry)
      if (entry.history) entry.runs.push(await run(session, '请只列出当前桌面会话，简要报告绑定 Profile 是否已有会话。本轮不建立附着，不输入，不关闭会话。', protocol, skills))
      const oldID = `recovery_expired_${index}`
      const result = await run(session, `旧记录中的会话 ID 是 ${oldID}。请先用 termous.desktops.get 核验这条旧记录，然后为本轮已绑定 Profile 确保桌面连接存在，并查询实际会话的状态后报告。旧记录不是锁定 Session 的指令，目标始终是本轮 Profile。不操作远程应用，不获取控制，不关闭连接；尚在连接或等待认证时报告真实状态即可。`, protocol, skills)
      entry.runs.push(result)
      const live = (await api('/remote-desktop-sessions')).filter((item) => item.profile_id === profile.id)
      entry.evidence = recoveryEvidence(result, oldID, live)
      entry.success = entry.runs.every((item) => item.status === 'completed') && entry.evidence.success
      await save()
      console.log(JSON.stringify({ case: entry.index, success: entry.success, requests: result.requests, ...entry.evidence }))
      if (supervisorError) throw supervisorError
    }
    report.success = report.cases.length === 5 && report.cases.every((entry) => entry.success)
  } catch (error) { report.success = false; report.error = error.message }
  finally {
    clearInterval(heartbeat)
    child?.kill()
    if (allocation) await release().catch((error) => report.cleanup_errors.push(error.message))
    if (lease) await api('/agent/runtime/supervisor', 'DELETE', { supervisor_instance_id: supervisor, expected_revision: lease.revision }).catch((error) => report.cleanup_errors.push(error.message))
    for (const id of report.sessions) {
      await api(`/agent/sessions/${id}`).then((session) => api(`/agent/sessions/${id}`, 'DELETE', { expected_revision: session.revision })).catch((error) => report.cleanup_errors.push(error.message))
    }
    for (const id of createdDesktops) await api(`/remote-desktop-sessions/${id}`, 'DELETE').catch((error) => report.cleanup_errors.push(error.message))
    report.completed_at = new Date().toISOString()
    await save()
    console.log(JSON.stringify({ success: report.success, error: report.error, cleanup_errors: report.cleanup_errors }))
    app.exit(report.success && !report.cleanup_errors.length ? 0 : 1)
  }
}

async function run(session, prompt, protocol, skills) {
  const created = await api(`/agent/sessions/${session.id}/runs`, 'POST', { client_request_id: randomUUID(), prompt, attachment_ids: [] })
  allocation = await api('/agent/runtime/queue/claim-next', 'POST', { supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch, claim_sequence: sequence++ })
  assert.equal(allocation.run?.id, created.id, '不能领取其他用户任务')
  const ticket = await api(`/agent/runs/${created.id}/runtime-tickets`, 'POST', { supervisor_instance_id: supervisor, expected_generation: created.generation, execution_id: allocation.execution_id })
  child = utilityProcess.fork(path.join(web, 'dist-electron/agent-worker.js'), [], { cwd: web, stdio: 'pipe', serviceName: 'Termous Recovery Acceptance' })
  let exited = false, settled = false, fatal, cursor = 0
  const exit = new Promise((resolve) => {
    child.on('message', (message) => { if (message.type === 'settled') settled = true; if (message.type === 'fatal') fatal = message.category })
    child.once('exit', (code) => { exited = true; resolve(code) })
    child.once('spawn', () => child.postMessage({ type: 'start', protocol_version: protocol, core_base_url: core, ticket: ticket.ticket, run_id: created.id, generation: created.generation, skills }))
  })
  const result = { run_id: created.id, status: 'running', requests: 0, calls: [], tools_by_request: [] }
  const deadline = Date.now() + 180000
  const collect = async () => {
    const page = await api(`/agent/runs/${created.id}/events?generation=${created.generation}&after_sequence=${cursor}&limit=200`)
    for (const event of page.items) {
      cursor = event.sequence
      if (event.kind === 'request_usage') {
        result.requests++
        result.tools_by_request.push(event.payload.request_usage?.effective_tools ?? [])
      }
      const part = event.kind === 'message_part' ? event.payload.message_part?.content : undefined
      const call = part?.tool_call
      if (call) {
        const fields = ['session_id', 'profile_id', 'wait_ms', 'names', 'operation', 'query']
        result.calls.push({ id: call.tool_call_id, name: call.tool_name, request: result.requests,
          args: Object.fromEntries(fields.filter((key) => call.arguments?.[key] !== undefined).map((key) => [key, call.arguments[key]])) })
      }
      const receipt = part?.tool_result
      if (!receipt) continue
      const current = result.calls.find((item) => item.id === receipt.tool_call_id)
      if (current) current.failed = receipt.is_error === true
      for (const content of receipt.content ?? []) {
        if (content.type !== 'text') continue
        let data
        try { data = JSON.parse(content.text) } catch { continue }
        if (current && data.error?.code) current.error_code = data.error.code
        if (current && data.session?.id && !receipt.is_error) current.verified_session = data.session.id
        if (current?.name === 'discover_tools' && Array.isArray(data.tools)) current.discovered_tools = data.tools.map((tool) => tool.original_name)
        if (receipt.tool_name === 'termous.desktops.connect' && data.created === true && data.session?.id && !originalDesktops.has(data.session.id)) createdDesktops.add(data.session.id)
      }
    }
  }
  try {
    while (!exited) {
      await collect()
      if (Date.now() >= deadline || result.requests >= 20) throw new Error('验收达到独立时间或请求上限')
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    const code = await exit
    await collect()
    result.status = (await api(`/agent/runs/${created.id}`)).status
    if (code !== 0 || !settled || fatal) throw new Error(`Worker 未正常结束: ${fatal ?? code}`)
  } catch (error) {
    child.kill()
    await exit
    await api(`/agent/runs/${created.id}/runtime-failures`, 'POST', { supervisor_instance_id: supervisor, generation: created.generation, category: 'forced_stop' })
    result.status = 'failed'; result.error = error.message
  } finally { child = undefined; await release() }
  return result
}

async function release() {
  await api('/agent/runtime/executions/release', 'POST', { execution_id: allocation.execution_id, run_id: allocation.run.id, generation: allocation.run.generation,
    supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch })
  allocation = undefined
}
async function api(resource, method = 'GET', body) {
  const response = await fetch(`${core}/api/v1${resource}`, { method, headers: { 'X-Termous-Token': 'dev-token', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`${method} ${resource}: HTTP ${response.status}`)
  return response.status === 204 ? undefined : response.json()
}
async function save() { await writeFile(path.join(output, 'recovery-report.json'), JSON.stringify(report, null, 2), 'utf8') }

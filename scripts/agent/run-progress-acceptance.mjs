import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, utilityProcess } from 'electron'
import ts from 'typescript'
import { validateAgentSkillsBundleDirectory } from './validate-skills-bundle.mjs'

// 使用开发 Core 的既有认证链；模型密钥仅由 Core 交给 Worker，不经过验收日志。
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.resolve(web, '../TEMP/runtime/agent-progress')
const core = 'http://127.0.0.1:8122'
const supervisor = `progress_acceptance_${randomUUID()}`
const report = { started_at: new Date().toISOString(), cases: [], sessions: [], cleanup_errors: [] }
const probe = process.argv.includes('--probe')
const capabilities = process.argv.includes('--capabilities')
let lease, heartbeat, runtime, host, desktop, child, allocation, sequence = 1
await mkdir(output, { recursive: true })
for (const [name, folder] of [['userData', 'electron-profile'], ['sessionData', 'electron-session'], ['logs', 'logs'], ['crashDumps', 'crashes']]) app.setPath(name, path.join(output, folder))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
app.on('web-contents-created', (_event, contents) => {
  // 验收只记录执行端错误类别；去掉含一次性票据的 URL，禁止记录 bootstrap。
  contents.on('console-message', (details) => {
    if (details.level !== 'error') return
    report.renderer_errors ??= []
    if (report.renderer_errors.length < 20) {
      const message = details.message.replace(/(?:https?|wss?|file):\/\/[^\s"']+/gu, '[url]').slice(0, 500)
      report.renderer_errors.push(message)
      console.log(JSON.stringify({ renderer_error: message }))
    }
  })
  contents.on('did-fail-load', (_event, code, description) => { report.renderer_load_error = { code, description } })
})
void app.whenReady().then(main).catch((error) => { console.error(error.message); app.exit(1) })

async function main() {
  let failure
  try {
    const protocol = /agentRuntimeProtocolVersion = '([^']+)'/u.exec(await readFile(path.join(web, 'common/contracts/agent-runtime.ts'), 'utf8'))[1]
    const bundle = path.join(web, 'build/agent/skills')
    const manifest = await validateAgentSkillsBundleDirectory(bundle)
    const resources = await Promise.all(manifest.resources.map(async ({ path: relative, ...entry }) => ({ ...entry, content: await readFile(path.join(bundle, relative), 'utf8') })))
    const skills = { format_version: manifest.format_version, fingerprint: manifest.fingerprint, catalog: manifest.catalog, resources }
    const register = async () => { lease = await api('/agent/runtime/supervisor', 'PUT', { supervisor_instance_id: supervisor, runtime_protocol_version: protocol,
      skills_bundle: { status: 'ready', fingerprint: skills.fingerprint, skill_count: skills.catalog.length, resource_count: skills.resources.length } }) }
    await register()
    heartbeat = setInterval(() => { void register().catch((error) => { failure = error; child?.kill() }) }, 10000)
    const models = (await api('/agent/models')).items
    const model = models.find((entry) => entry.remote_model_id === 'glm-5.3-flash')
    assert.ok(model, '未找到已配置的 glm-5.3-flash')
    if (capabilities) {
      const scenarios = [
        ['找出执行 SSH 命令、读取命令结果，以及保存命令片段各自的工具；说明保存是否等于执行。', ['termous.commands.dispatch', 'termous.commands.get', 'termous.snippets.create']],
        ['找出上传文件、查询传输任务和取消传输各自的工具；说明取消是否代表回滚。', ['termous.files.transfers.upload', 'termous.files.transfers.get', 'termous.files.transfers.cancel']],
        ['找出启动 systemd 服务、查询其异步操作，以及读取当前用户定时任务配置的工具；区分服务运行和配置保存。', ['termous.remoteops.services.action', 'termous.remoteops.services.operations.get', 'termous.remoteops.crontab.get']],
        ['找出读取已保存隧道配置、启动隧道实例、查询隧道状态和停止隧道的工具；区分配置和运行实例。', ['termous.forwarding.profiles.get', 'termous.forwarding.instances.start', 'termous.forwarding.instances.get', 'termous.forwarding.instances.stop']],
        ['找出普通桌面即时截图、创建 workflow 固定快照和同帧局部放大的工具；区分两类截图 ID。', ['termous.desktops.capture', 'termous.desktop_workflows.captures.create', 'termous.desktop_workflows.captures.view']],
      ]
      for (const [index, [question, expected]] of scenarios.entries()) {
        const session = await api('/agent/sessions', 'POST', { title: `统一能力导航验收 ${index + 1}`, model_id: model.id, reasoning_level: 'low' })
        report.sessions.push(session.id)
        const result = await run(session, `这是工具目录导航验收，不执行任何业务操作，也不需要连接资源。只调用 discover_tools，用简短中文目标动作分别搜索所需操作，不用精确工具名搜索；查到后简要解释职责边界。${question}`, protocol, skills)
        const success = result.status === 'completed' && expected.every((name) => result.effective_tools.includes(`m_${name.replaceAll('_', '_u').replaceAll('.', '_d')}`))
          && result.tool_sequence.every((entry) => ['discover_tools', 'read_skill_resource'].includes(entry.name))
        report.cases.push({ index: index + 1, expected, runs: [result], success })
        await save()
        console.log(JSON.stringify({ case: index + 1, success, requests: result.requests }))
      }
      report.success = report.cases.every((entry) => entry.success)
      return
    }
    const catalog = await api('/host-assets/provision', 'POST', { client_request_id: randomUUID(), host: { name: 'Agent 循环回归本机夹具', platform: 'linux', tags: [] }, ssh: [],
      remote_desktops: [{ draft_id: 'fixture', name: '本机只读 VNC', route: 'direct', protocol: 'vnc', is_default: true,
        vnc: { target_host: '127.0.0.1', port: 5194, shared: true, default_view_only: true, default_display_mode: 'fit' } }] })
    host = catalog.host.id
    report.host_id = host
    const profile = catalog.remote_desktops[0].id
    const runtimeFile = path.join(output, 'desktop-runtime.mjs')
    const compiled = ts.transpileModule(await readFile(path.join(web, 'electron/desktopAutomation/runtime.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    const require = createRequire(import.meta.url)
    await writeFile(runtimeFile, compiled.outputText.replace("from 'ws'", `from '${pathToFileURL(require.resolve('ws')).href}'`))
    const { DesktopAutomationRuntime } = await import(pathToFileURL(runtimeFile).href)
    runtime = new DesktopAutomationRuntime({ config: async () => ({ apiBaseUrl: core, apiToken: 'dev-token' }), appearance: () => ({ language: 'zh-CN', theme: 'dark' }),
      devURL: 'http://127.0.0.1:5191/',
      renderer: path.join(web, 'dist/index.html'), preload: path.join(web, 'dist-electron/desktop-automation-preload.cjs'), warn: (code) => { report.runtime_warnings ??= []; report.runtime_warnings.push(code) } })
    await runtime.start()
    for (let index = 0; index < (probe ? 1 : 5); index++) {
      await prepareDesktop(profile)
      const session = await api('/agent/sessions', 'POST', { title: `工具导航验收 ${index + 1}`, model_id: model.id, reasoning_level: 'low',
        resource_reference: { kind: 'desktop_session', session_id: desktop.id, connection_generation: desktop.connection_generation } })
      report.sessions.push(session.id)
      const history = index >= 3
      const entry = { index: index + 1, history, runs: [] }
      report.cases.push(entry)
      await save()
      try {
        if (history) {
          const preparation = await run(session, '后续目标是给这个已关联桌面创建供 workflow 模板使用的固定快照，再放大查看左上角 100×100 区域。现在先用普通桌面截图观察当前画面一次，然后停下等待我说继续；此轮暂不制作固定快照。', protocol, skills)
          entry.runs.push(preparation)
          assert.ok(preparation.status === 'completed' && preparation.successful_tools.includes('termous.desktops.capture'), '历史准备轮未成功观察桌面')
          // 上轮结束会释放托管执行端；重新绑定同一夹具的新会话，同时保留真实对话历史。
          await prepareDesktop(profile)
          const current = await api(`/agent/sessions/${session.id}`)
          await api(`/agent/sessions/${session.id}/resource-binding`, 'PUT', { kind: 'desktop_session', session_id: desktop.id,
            connection_generation: desktop.connection_generation, expected_revision: current.revision })
        }
        const prompt = history ? '现在可以了，请继续完成之前的固定快照和局部查看目标。' : [
          '为这个已关联桌面创建一个 workflow 固定快照，再从同一快照放大查看左上角 100×100 区域。执行成功后报告实际结果即可，不需要键盘鼠标输入。',
          '我需要桌面脚本的图像模板素材。请先观察当前画面，然后保存固定原帧并放大查看左上角 100×100 区域。不要只重复即时截图，也暂不确认模板。',
          '这是循环恢复验收：先对已关联桌面连续调用普通截图三次，随后完成 workflow 的固定快照，再按 2 倍放大查看左上角 100×100 区域。无需输入操作，完成后停止。',
        ][index]
        const result = await run(session, prompt, protocol, skills)
        entry.runs.push(result)
        entry.success = result.status === 'completed' && result.snapshot_created === true && result.snapshot_viewed === true
          && (index !== 2 || result.progress.some((notice) => notice.tool_name === 'termous.desktops.capture' && notice.status === 'detected'))
        if (!entry.success) entry.error = '未完成固定快照与局部查看'
      } catch (error) { entry.success = false; entry.error = error.message }
      await save()
      console.log(JSON.stringify({ case: entry.index, success: entry.success, error: entry.error, requests: entry.runs.map((run) => run.requests) }))
      if (failure) throw failure
    }
    report.success = report.cases.length === (probe ? 1 : 5) && report.cases.every((entry) => entry.success)
  } catch (error) { report.success = false; report.error = error.message }
  finally {
    clearInterval(heartbeat)
    child?.kill()
    runtime?.close()
    if (allocation) await release().catch((error) => report.cleanup_errors.push(error.message))
    if (lease) await api('/agent/runtime/supervisor', 'DELETE', { supervisor_instance_id: supervisor, expected_revision: lease.revision }).catch((error) => report.cleanup_errors.push(error.message))
    if (desktop) await api(`/remote-desktop-sessions/${desktop.id}`, 'DELETE').catch((error) => report.cleanup_errors.push(error.message))
    // 只删除本次创建的对象；可保留五个验收会话供界面检查。
    if (!process.argv.includes('--keep-sessions')) for (const id of report.sessions) {
      await api(`/agent/sessions/${id}`, 'GET').then((value) => api(`/agent/sessions/${id}`, 'DELETE', { expected_revision: value.revision })).catch((error) => report.cleanup_errors.push(error.message))
    }
    if (host && !process.argv.includes('--keep-sessions')) await api(`/hosts/${host}`, 'DELETE').catch((error) => report.cleanup_errors.push(error.message))
    report.completed_at = new Date().toISOString()
    await save()
    app.exit(report.success && !report.cleanup_errors.length ? 0 : 1)
  }
}

async function run(session, prompt, protocol, skills) {
  const created = await api(`/agent/sessions/${session.id}/runs`, 'POST', { client_request_id: randomUUID(), prompt, attachment_ids: [] })
  report.active_run = { run_id: created.id, session_id: session.id }
  await save()
  allocation = await api('/agent/runtime/queue/claim-next', 'POST', { supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch, claim_sequence: sequence++ })
  assert.equal(allocation.run?.id, created.id, '验收不能领取其他用户任务')
  const ticket = await api(`/agent/runs/${created.id}/runtime-tickets`, 'POST', { supervisor_instance_id: supervisor, expected_generation: created.generation, execution_id: allocation.execution_id })
  child = utilityProcess.fork(path.join(web, 'dist-electron/agent-worker.js'), [], { cwd: web, stdio: 'pipe', serviceName: 'Termous Progress Acceptance' })
  let exited = false, settled = false, fatal = ''
  const exit = new Promise((resolve) => {
    child.on('message', (message) => { if (message.type === 'settled') settled = true; if (message.type === 'fatal') fatal = message.category })
    child.once('exit', (code) => { exited = true; resolve(code) })
    child.once('spawn', () => child.postMessage({ type: 'start', protocol_version: protocol, core_base_url: core, ticket: ticket.ticket, run_id: created.id, generation: created.generation, skills }))
  })
  const result = { run_id: created.id, status: 'running', requests: 0, successful_tools: [], tool_sequence: [], progress: [], discovered_tools: [], effective_tools: [] }
  const deadline = Date.now() + 240000
  let cursor = 0, failure
  const collect = async () => {
    const page = await api(`/agent/runs/${created.id}/events?generation=${created.generation}&after_sequence=${cursor}&limit=200`)
    for (const event of page.items) {
      cursor = event.sequence
      if (event.kind === 'request_usage') {
        result.requests++
        for (const tool of event.payload.request_usage?.effective_tools ?? []) if (!result.effective_tools.includes(tool)) result.effective_tools.push(tool)
      }
      if (event.kind === 'tool_completed' || event.kind === 'tool_failed') {
        result.tool_sequence.push({ name: event.payload.tool.tool_name, success: event.kind === 'tool_completed' })
        if (event.kind === 'tool_completed') result.successful_tools.push(event.payload.tool.tool_name)
      }
      if (event.kind === 'progress') result.progress.push(event.payload.progress)
      const receipt = event.kind === 'message_part' ? event.payload.message_part?.content?.tool_result : undefined
      if (receipt && !receipt.is_error) for (const part of receipt.content ?? []) {
        if (part.type !== 'text' || !part.text.includes('{')) continue
        let data
        try { data = JSON.parse(part.text.slice(part.text.indexOf('{'))) } catch { continue }
        if (receipt.tool_name === 'discover_tools' && Array.isArray(data.tools)) {
          for (const tool of data.tools) if (typeof tool.original_name === 'string' && !result.discovered_tools.includes(tool.original_name)) result.discovered_tools.push(tool.original_name)
        }
        if (receipt.tool_name === 'termous.desktop_workflows.captures.create' && typeof data.snapshot?.snapshot_id === 'string') {
          result.snapshot_created = true
          result.snapshot_id = data.snapshot.snapshot_id
        }
        if (receipt.tool_name === 'termous.desktop_workflows.captures.view' && data.view?.snapshot_id === result.snapshot_id && result.snapshot_id) {
          const view = data.view.image_view
          result.snapshot_viewed = view?.source_region?.x === 0 && view?.source_region?.y === 0
            && view?.source_region?.width === 100 && view?.source_region?.height === 100 && view.width > 100 && view.height > 100
        }
      }
    }
  }
  try {
    while (!exited) {
      await collect()
      if (Date.now() >= deadline || result.requests >= 24) throw new Error('验收达到独立的时间或请求上限')
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const code = await exit
    await collect()
    const current = await api(`/agent/runs/${created.id}`)
    result.status = current.status
    result.error_code = current.error_code
    if (code !== 0 || !settled || fatal) throw new Error(`Worker 未正常完成: ${fatal || code}`)
  } catch (error) {
    failure = error
    child.kill()
    await exit
    await api(`/agent/runs/${created.id}/runtime-failures`, 'POST', { supervisor_instance_id: supervisor, generation: created.generation, category: 'forced_stop' })
    result.status = 'failed'; result.error = error.message
  } finally { child = undefined; await release(); delete report.active_run }
  if (failure) result.error = failure.message
  return result
}

async function release() {
  await api('/agent/runtime/executions/release', 'POST', { execution_id: allocation.execution_id, run_id: allocation.run.id, generation: allocation.run.generation,
    supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch })
  allocation = undefined
}
async function prepareDesktop(profile) {
  if (desktop) await api(`/remote-desktop-sessions/${desktop.id}`, 'DELETE')
  desktop = await api('/remote-desktop-sessions', 'POST', { profile_id: profile })
  report.desktops ??= []
  report.desktops.push(desktop.id)
  const deadline = Date.now() + 30000
  while (!desktop.connection_generation || !['ready', 'streaming', 'reattach_wait'].includes(desktop.status)) {
    if (Date.now() >= deadline) throw new Error(`本机桌面未就绪: ${desktop.status}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
    desktop = await api(`/remote-desktop-sessions/${desktop.id}`)
  }
}
async function api(resource, method = 'GET', body) {
  const response = await fetch(`${core}/api/v1${resource}`, { method, headers: { 'X-Termous-Token': 'dev-token', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`${method} ${resource}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}
async function save() { await writeFile(path.join(output, capabilities ? 'capability-report.json' : probe ? 'probe-report.json' : 'report.json'), JSON.stringify(report, null, 2), 'utf8') }

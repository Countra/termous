import { app, nativeImage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

// 仅供当轮已授权的协议验收；不直接输入，所有手势都经过固定版本的工作流服务。
async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const output = path.resolve(root, '../TEMP/runtime/desktop-workflow')
  await mkdir(output, { recursive: true })
  const queue = path.join(output, 'commands.json')
  await writeFile(queue, '[]', 'utf8')
  const runtimeFile = path.join(root, 'build/desktop-automation-fixture/workflow-runtime.mjs')
  await mkdir(path.dirname(runtimeFile), { recursive: true })
  const compiled = ts.transpileModule(await readFile(path.join(root, 'electron/desktopAutomation/runtime.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
  await writeFile(runtimeFile, compiled.outputText, 'utf8')
  app.setPath('userData', path.join(output, 'electron'))
  await app.whenReady()
  app.on('window-all-closed', () => {})
  const { DesktopAutomationRuntime } = await import(pathToFileURL(runtimeFile).href)
  const runtime = new DesktopAutomationRuntime({ config: async () => ({ apiBaseUrl: 'http://127.0.0.1:5193', apiToken: 'fixture-token' }), appearance: () => ({ language: 'zh-CN', theme: 'dark' }), renderer: path.join(root, 'dist/index.html'), preload: path.join(root, 'dist-electron/desktop-automation-preload.cjs'), warn: code => console.error(code) })
  const base = 'http://127.0.0.1:5193/api/v1'
  const headers = { 'X-Termous-Token': 'fixture-token' }
  const reports = []
  let target, session, preview, currentRun, lastImage, serial = 0, failure = false
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  async function request(route, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + route, { method, headers: body === undefined || body instanceof FormData ? headers : { ...headers, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) })
    if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`)
    if (response.status === 204) return
    return response.json()
  }
  async function state(id = currentRun.id) { return request(`/desktop-workflow-runs/${id}`) }
  async function until(test, seconds = 60) {
    const deadline = Date.now() + seconds * 1000
    while (Date.now() < deadline) {
      const value = await state()
      if (test(value.run)) return value
      if (!['preparing', 'running', 'paused'].includes(value.run.state)) throw new Error(JSON.stringify(value.run))
      await delay(100)
    }
    throw new Error('等待运行状态超时')
  }
  async function command(action) { return request(`/desktop-workflow-runs/${currentRun.id}/control`, { request_id: `command-${++serial}`, action }) }
  async function start(steps, options = {}) {
    const script = await request('/desktop-workflows', { name: '桌面脚本真实验收', definition: { schema_version: 1, steps: steps.map((s, i) => ({ id: `step-${i}`, action: {}, ...s })) } })
    currentRun = await request('/desktop-workflow-runs', { script_id: script.id, version: script.revision, request_id: `run-${++serial}`, ...(session ? { session_id: session.id, connection_generation: session.generation } : { profile_id: target.profile_id }), keep_connection: true, ...options })
    const duplicate = await request('/desktop-workflow-runs', { script_id: script.id, version: script.revision, request_id: `run-${serial}`, ...(session ? { session_id: session.id, connection_generation: session.generation } : { profile_id: target.profile_id }), keep_connection: true, ...options })
    if (duplicate.id !== currentRun.id) throw new Error('重复请求创建新运行')
    return currentRun
  }
  async function capture() {
    const started = performance.now()
    const response = await fetch(`${base}/desktop-workflow-previews/${preview.id}/capture`, { method: 'POST', headers })
    if (!response.ok) throw new Error(await response.text())
    lastImage = Buffer.from(await response.arrayBuffer())
    const filename = path.join(output, `${target.protocol}-${Date.now()}.png`)
    await writeFile(filename, lastImage)
    console.log(JSON.stringify({ image: filename, ms: performance.now() - started, metadata: JSON.parse(response.headers.get('X-Termous-Desktop-Snapshot')) }))
  }
  let passed = false
  try {
    target = await request('/fixture-target')
    await runtime.start()
    await start([{ kind: 'capture' }, { kind: 'breakpoint' }])
    const initial = await until(run => run.state === 'paused')
    session = { id: initial.run.session_id, generation: initial.run.connection_generation }
    preview = await request('/desktop-workflow-previews', { session_id: session.id, connection_generation: session.generation })
    await command('cancel')
    await until(run => run.state === 'cancelled')
    await capture()
    console.log(JSON.stringify({ phase: 'ready', protocol: target.protocol }))
    let consumed = 0
    const deadline = Date.now() + 25 * 60_000
    while (Date.now() < deadline) {
      const jobs = JSON.parse(await readFile(queue, 'utf8'))
      const job = jobs[consumed]
      if (!job) { await delay(250); continue }
      consumed++
      try {
        if (job.type === 'finish') { passed = job.passed === true && !failure; break }
        if (job.type === 'capture') { await capture(); continue }
        if (job.type === 'template') {
          const form = new FormData()
          form.append('file', new Blob([nativeImage.createFromBuffer(lastImage).crop(job.region).toPNG()], { type: 'image/png' }), 'template.png')
          const asset = await request('/desktop-workflow-assets', form)
          console.log(JSON.stringify({ asset: asset.id })); continue
        }
        if (job.type === 'run') {
          await start(job.steps, { debug: !!job.debug })
          if (job.debug) {
            await until(run => run.state === 'paused')
            await command('step')
            await until(run => run.state === 'paused' && run.executed > 0)
            await command('resume')
          }
          const result = await until(run => ['completed', 'failed', 'uncertain', 'interrupted', 'cancelled', 'timed_out'].includes(run.state))
          reports.push(result)
          console.log(JSON.stringify({ result }))
          if (result.run.state !== 'completed') failure = true
          await capture()
        }
      } catch (error) { failure = true; console.error(String(error)) }
    }
  } catch (error) { failure = true; console.error(String(error)) }
  finally {
    if (currentRun) { const value = await state().catch(() => undefined); if (value && ['preparing', 'running', 'paused'].includes(value.run.state)) await command('cancel').catch(() => { failure = true }) }
    if (preview) await request(`/desktop-workflow-previews/${preview.id}`, undefined, 'DELETE').catch(error => { failure = true; console.error('预览回收失败', String(error)) })
    runtime.close()
    const report = { passed: passed && !failure, protocol: target?.protocol, reports }
    await writeFile(path.join(output, `${target?.protocol ?? 'unknown'}-result.json`), JSON.stringify(report, null, 2))
    await request('/fixture-result', { passed: report.passed }).catch(() => { failure = true })
    app.exit(report.passed && !failure ? 0 : 1)
  }
}
void main().catch(error => { console.error(String(error)); app.exit(1) })

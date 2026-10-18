import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPiAgent } from '../../electron/agent/runtime/piAgentAdapter.ts'
import { WorkerCoreClient } from '../../electron/agent/worker/workerCoreClient.ts'
import { RuntimeEventWriter } from '../../electron/agent/runtime/runtimeEventWriter.ts'
import { agentRuntimeProtocolVersion } from '../../common/contracts/index.ts'
import { createAgentSkillBundleSnapshot } from '../../electron/agent/contracts/skillBundle.ts'
import { validateAgentSkillsBundleDirectory } from './validate-skills-bundle.mjs'
import { guidanceFixture, guidanceMessages } from './tool-guidance-fixture.mjs'
import { assertGuidanceCoreIdle, guidanceHeartbeat } from './tool-guidance-core.mjs'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = path.resolve(web, '../TEMP/runtime/agent-guidance')
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const coreURL = 'http://127.0.0.1:8122'
const modelName = argument('model')
assert.ok(modelName, '请用 --model 指定已有模型，不自动替换模型')
const repetitions = Number(argument('repetitions') ?? 3)
assert.ok(Number.isInteger(repetitions) && repetitions > 0 && repetitions <= 10)
const scenarios = (argument('scenarios') ?? 'first,history,compaction,discover').split(',')
assert.ok(scenarios.every((value) => ['first', 'history', 'compaction', 'discover'].includes(value)))
const baseline = argument('baseline')
const variants = baseline ? [['baseline', (await import(pathToFileURL(path.resolve(baseline)).href)).createPiAgent], ['current', createPiAgent]] : [['current', createPiAgent]]
const supervisor = `guidance_${randomUUID()}`
const report = { model: modelName, synthetic: true, started_at: new Date().toISOString(), cases: [], cleanup_errors: [] }
let lease, heartbeat, claimSequence = 1
await mkdir(output, { recursive: true })
const reportPath = path.join(output, argument('report') ?? 'report.json')
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2))
const manifest = await validateAgentSkillsBundleDirectory(path.join(web, 'build/agent/skills'))
const resources = await Promise.all(manifest.resources.map(async (entry) => ({ ...entry, content: await readFile(path.join(web, 'build/agent/skills', entry.path), 'utf8') })))
const skills = createAgentSkillBundleSnapshot(manifest.catalog, resources)
let baselineSkills = skills
if (argument('baseline-skill')) {
  const content = await readFile(argument('baseline-skill'), 'utf8')
  baselineSkills = createAgentSkillBundleSnapshot(manifest.catalog, resources.map((resource) => resource.uri === 'skill://termous-remote-desktop/SKILL.md'
    ? { ...resource, content, size: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') } : resource))
}
try {
  await assertGuidanceCoreIdle(coreURL)
  const models = (await api('/agent/models')).items.filter((entry) => entry.remote_model_id === modelName)
  assert.equal(models.length, 1, '模型必须精确且唯一')
  const register = async () => { lease = await api('/agent/runtime/supervisor', 'PUT', { supervisor_instance_id: supervisor, runtime_protocol_version: agentRuntimeProtocolVersion,
    skills_bundle: { status: 'ready', fingerprint: skills.fingerprint, skill_count: skills.catalog.length, resource_count: skills.resources.length } }) }
  await register()
  heartbeat = guidanceHeartbeat(register)
  for (const scenario of scenarios) for (let index = 1; index <= repetitions; index++) for (const [variant, create] of variants) {
    heartbeat.check()
    await assertGuidanceCoreIdle(coreURL)
    const result = { variant, scenario, index, requests: [], usage_records: [], calls: [], discoveries: [], discovery_results: [], tool_failures: [], compactions: 0, progress: [], errors: [] }
    report.cases.push(result)
    let session, run, allocation, ownershipConflict
    try {
      session = await api('/agent/sessions', 'POST', { title: `工具软纠错合成验收 ${variant}/${scenario}/${index}`, model_id: models[0].id, reasoning_level: argument('reasoning') ?? 'low' })
      run = await api(`/agent/sessions/${session.id}/runs`, 'POST', { client_request_id: randomUUID(), prompt: '本地合成工具选择验收，不操作真实桌面。', attachment_ids: [] })
      await assertGuidanceCoreIdle(coreURL, run.id)
      allocation = await api('/agent/runtime/queue/claim-next', 'POST', { supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch, claim_sequence: claimSequence++ })
      ownershipConflict = allocation.run?.id !== run.id
      assert.ok(!ownershipConflict, '领取身份不属于验收任务，立即结束验收')
      const ticket = await api(`/agent/runs/${run.id}/runtime-tickets`, 'POST', { supervisor_instance_id: supervisor, expected_generation: run.generation, execution_id: allocation.execution_id })
      const start = { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: coreURL, ticket: ticket.ticket, run_id: run.id, generation: run.generation, skills }
      // 凭据只通过既有 ticket/bootstrap 交换进入内存，不读取凭据文件、不写入报告。
      const bootstrap = await new WorkerCoreClient().bootstrap(start)
      bootstrap.messages = guidanceMessages(scenario)
      bootstrap.context = { estimated_tokens: 0, warning: false, progress_supported: true, request_usage_supported: true }
      result.configured_context_window = bootstrap.model.snapshot.context_window_tokens
      if (scenario === 'compaction') {
        // 使用既有手动压缩入口覆盖压缩后继续；不写回模型设置或改变窗口与预算。
        bootstrap.model = { ...bootstrap.model, snapshot: { ...bootstrap.model.snapshot, force_context_compression: true } }
        result.fixture_forced_compaction = true
      }
      const fixture = guidanceFixture(scenario, (call) => {
        result.calls.push({ ...call, request: result.requests.length })
        if (call.input && result.first_input_request === undefined) result.first_input_request = result.requests.length
      })
      let controller, timedOut = false
      const writer = new RuntimeEventWriter({ start, runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0,
        onFailure: () => controller?.abort(), core: { appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => {
          for (const event of batch) {
            if (event.kind === 'request_usage') result.usage_records.push(event.payload.request_usage)
            if (event.kind === 'progress') result.progress.push(event.payload.progress)
            if (event.kind === 'error') result.errors.push(event.payload.error?.code)
          }
          return batch[batch.length - 1].sequence
        } } })
      controller = create({ bootstrap, events: writer, skills: variant === 'baseline' ? baselineSkills : skills, mcp: fixture.mcp,
        fetch: async (url, init) => {
          const body = JSON.parse(String(init?.body))
          result.requests.push({ tools: (body.tools ?? []).map((tool) => tool.name ?? tool.function?.name) })
          return fetch(url, init)
        },
        audit: { capture: (event) => {
          if (event.type === 'message_end' && event.message.role === 'assistant') for (const part of event.message.content) {
            if (part.type === 'toolCall' && part.name === 'discover_tools') result.discoveries.push(part.arguments)
          }
          if (event.type !== 'message_end' || event.message.role !== 'toolResult') return
          const message = event.message
          if (message.isError) result.tool_failures.push({ name: message.toolName, request: result.requests.length })
          if (message.toolName !== 'discover_tools' || message.isError) return
          // 只记录发现回执的工具标识，不保存 Skill 正文、模型旁白或认证信息。
          const content = message.content.find((part) => part.type === 'text')
          if (!content) return
          const discovered = JSON.parse(content.text)
          result.discovery_results.push({ request: result.requests.length,
            tools: (discovered.tools ?? []).map((tool) => tool.original_name),
            unavailable: (discovered.unavailable ?? []).map((tool) => tool.name), not_found: discovered.not_found ?? [] })
        } },
        commitCheckpoint: async (input) => {
          result.compactions++
          return { last_sequence: input.sequence, checkpoint: { id: `synthetic-checkpoint-${result.compactions}`, version: 2,
            boundary_message_sequence: 0, run_id: run.id, generation: run.generation, covered_event_sequence: input.covered_event_sequence,
            summary: input.summary, estimated_tokens: input.tokens_after, retained_tail: input.retained_tail, image_sources: [], details: input.details } }
        },
      })
      // 仅验收程序设置超时；不改变产品的预算与循环策略。
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, Number(argument('timeout') ?? 180000))
      try { result.status = await controller.continue(); await writer.flush() }
      finally { clearTimeout(timer); controller.abort(); await controller.waitForIdle(); controller.close(); await writer.close() }
      result.timed_out = timedOut
      result.success = result.status === 'completed' && fixture.success() && (scenario !== 'compaction' || result.compactions > 0)
      result.total_tokens = result.usage_records.reduce((sum, entry) => sum + entry.usage.total_tokens, 0)
      const firstInput = result.calls.findIndex((call) => call.input)
      const preceding = firstInput < 0 ? result.calls : result.calls.slice(0, firstInput)
      result.nonprogress_calls = preceding.filter((call, position) => preceding.slice(0, position).some((old) => old.name === call.name && old.error === call.error)).length
    } catch (error) { result.success = false; result.error = error.code ?? error.name }
    finally {
      if (run) await api(`/agent/runs/${run.id}/runtime-failures`, 'POST', { supervisor_instance_id: supervisor, generation: run.generation, category: 'forced_stop' }).catch(() => report.cleanup_errors.push('结束验收运行失败'))
      if (allocation?.execution_id) await api('/agent/runtime/executions/release', 'POST', { supervisor_instance_id: supervisor, supervisor_epoch: lease.supervisor_epoch,
        execution_id: allocation.execution_id, run_id: allocation.run.id, generation: allocation.run.generation }).catch(() => report.cleanup_errors.push('释放验收执行槽失败'))
      if (session) await api(`/agent/sessions/${session.id}`).then((value) => api(`/agent/sessions/${session.id}`, 'DELETE', { expected_revision: value.revision })).catch(() => report.cleanup_errors.push('删除验收会话失败'))
      await save()
    }
    if (ownershipConflict || report.cleanup_errors.length) throw new Error('验收资源身份或清理异常，停止后续测试')
    console.log(JSON.stringify({ variant, scenario, index, success: result.success, requests: result.requests.length, first_input: result.first_input_request, tokens: result.total_tokens, compactions: result.compactions, error: result.error }))
  }
} finally {
  await heartbeat?.stop()
  if (lease) await api('/agent/runtime/supervisor', 'DELETE', { supervisor_instance_id: supervisor, expected_revision: lease.revision }).catch(() => report.cleanup_errors.push('注销验收宿主失败'))
  report.completed_at = new Date().toISOString()
  await save()
}
process.exitCode = report.cases.every((entry) => entry.success) && !report.cleanup_errors.length ? 0 : 1

async function api(resource, method = 'GET', body) {
  const response = await fetch(`${coreURL}/api/v1${resource}`, { method, headers: { 'X-Termous-Token': 'dev-token', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Core ${method} ${resource}: HTTP ${response.status}`)
  return response.status === 204 ? undefined : response.json()
}

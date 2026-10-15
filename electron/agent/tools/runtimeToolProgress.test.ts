import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'

const skill = () => ({ content: [{ type: 'text' as const, text: '说明' }], details: { kind: 'skill_resource', uri: 'skill://fixture/A', sha256: 'same', size: 6 } })
const read = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: { kind: 'mcp', originalToolName: 'fixture', readOnly: true, result: { content: [], structuredContent: value } } })
const write = (value: unknown) => { const result = read(value); result.details.readOnly = false; return result }
const capture = (index: number, image = 'same', generation = 1) => ({ ...read({ capture: { screenshot_id: `shot-${index}`, expires_at: index, metadata: { connection_generation: generation, frame_sequence: index }, image_view: { view_id: `view-${index}`, width: 800, height: 600 } } }), content: [{ type: 'image' as const, mimeType: 'image/png', data: image }] })
const name = 'termous.desktops.capture'
const args = { attachment_id: 'attachment' }

test('脚本详情摘要区分当前修订与所读版本，检查点恢复也不带入脚本正文', () => {
  const progress = new RuntimeToolProgress()
  progress.observe('termous.desktop_workflows.get', { script_id: 'script', version: 2 }, read({ detail: {
    script: { id: 'script', revision: 6 },
    version: { script_id: 'script', number: 2, definition: { steps: [{ text: 'private script body' }] } },
  } }), false)
  for (const current of [progress, new RuntimeToolProgress()]) {
    if (current !== progress) assert.equal(current.restore(progress.snapshot()), true)
    assert.match(current.summary(), /"revision":6/)
    assert.match(current.summary(), /"number":2/)
    assert.doesNotMatch(current.summary(), /private script body/)
  }
})

test('历史重复启动回放第三次提示；真实运行身份和版本进入摘要，不以旁白更新版本', () => {
  const fixture = JSON.parse(readFileSync(new URL('../test-support/workflow-start-loop-incident.json', import.meta.url), 'utf8')) as { calls: Array<{ tool: string; args: unknown; error: boolean; data: unknown }> }
  assert.equal(fixture.calls.length, 5)
  for (const terminal of [false, true]) {
    const progress = new RuntimeToolProgress()
    for (const [index, call] of fixture.calls.entries()) {
      const data = terminal ? { run: { id: 'run-1', script_id: 'script-1', version: 2, state: 'failed', executed: 6, error_code: 'desktop_generation_stale' } } : call.data
      const guidance = progress.observe(call.tool, call.args, write(data), call.error)
      assert.equal(Boolean(guidance), index === 2)
      if (guidance) {
        assert.match(guidance, /termous.desktop_workflows.get/)
        assert.match(guidance, /expected_revision/)
        assert.match(guidance, /skill:\/\/termous-desktop-workflows\/references\/editing.md/)
      }
      assert.equal(progress.beforeCall(call.tool, call.args), undefined)
      assert.equal(progress.hidden(call.tool), false)
    }
    const summary = progress.summary()
    assert.match(summary, /"id":"run-1"/)
    assert.match(summary, /"version":2/)
    if (terminal) assert.match(summary, /"executed":6/)
  }
})

test('真实故障的 62 次脱敏调用回放能提示并保留准确快照入口', () => {
  const fixture = JSON.parse(readFileSync(new URL('../test-support/desktop-loop-incident.json', import.meta.url), 'utf8')) as { calls: Array<{ tool: string; args: unknown; error: boolean; data: unknown; image_hashes?: string[] }> }
  const progress = new RuntimeToolProgress()
  let notices = 0
  for (const call of fixture.calls) {
    const result = read(call.data)
    const guidance = progress.observe(call.tool, call.args, { ...result, content: [...result.content, ...(call.image_hashes ?? []).map((data) => ({ type: 'image' as const, mimeType: 'image/png', data }))] }, call.error)
    if (guidance && call.tool === name) {
      notices++
      assert.match(guidance, /termous.desktop_workflows.captures.create/)
    }
    assert.equal(progress.beforeCall(call.tool, call.args), undefined)
  }
  assert.equal(fixture.calls.length, 62)
  assert.ok(notices > 0 && notices < 15)
})

test('相同图片的新 ID、到期时间和帧号不能掩盖循环，第三次提示且不拦截', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 1; i <= 12; i++) {
    const guidance = progress.observe(name, { ...args, wait_ms: i, client_request_id: String(i) }, capture(i), false)
    assert.equal(Boolean(guidance), [3, 6, 12].includes(i))
    if (guidance) assert.match(guidance, /termous.desktop_workflows.captures.create/)
    assert.equal(progress.beforeCall(name, args), undefined)
    assert.equal(progress.hidden(name), false)
  }
  assert.equal(progress.drain().length, 3)
})

test('诊断与恢复仅保留当前可用候选，缺失权限不能变成可执行建议', () => {
  const progress = new RuntimeToolProgress(Date.now, (tool) => tool === name)
  for (let i = 0; i < 3; i++) progress.observe(name, args, capture(i), false)
  const notice = progress.drain()[0]!
  assert.deepEqual(notice.next_tools, [])
  assert.match(notice.guidance, /不在当前可用目录/)
  const previous = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) previous.observe(name, args, capture(i), false)
  const restored = new RuntimeToolProgress(Date.now, () => false)
  assert.equal(restored.restore(previous.snapshot()), true)
  assert.deepEqual(restored.snapshot().notices[0]![1].next_tools, [])
  for (const value of [undefined, {}, { version: 1 }, { ...previous.snapshot(), version: 2 }]) {
    assert.equal(new RuntimeToolProgress().restore(value), false)
  }
})

test('成功与无新帧错误交替仍累计，变化参数不规避同类失败', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) {
    progress.observe(name, args, capture(i), false)
    progress.observe(name, { ...args, wait_ms: i, invalid: i }, read({ error: { code: 'desktop_no_new_frame', message: `attempt ${i}` } }), true)
  }
  const notices = progress.drain()
  assert.ok(notices.some((item) => item.reason === 'repeated_observation'))
  assert.ok(notices.some((item) => item.reason === 'repeated_failure' || item.reason === 'cycle'))
  assert.match(progress.summary(), /desktop_no_new_frame/)
})

test('发现工具、重复 Skill、无关查询和输入回执不清除截图诊断', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) progress.observe(name, args, capture(i), false)
  progress.drain()
  for (let i = 0; i < 3; i++) {
    progress.observe('discover_tools', {}, read({ tools: [i] }), false)
    progress.observe('read_skill_resource', { uri: 'skill://fixture/A', refresh: true }, skill(), false)
    progress.observe('termous.hosts.get', { id: 'other' }, read({ version: i }), false)
    progress.observe('termous.desktops.keyboard.key', args, write({ state: 'accepted' }), false)
  }
  assert.match(progress.summary(), /screenshot_id/)
  assert.equal(progress.drain().some((item) => item.status === 'progressed'), false)
})

test('查询成功但异步附着失败也累计；新附着 ID 不能掩盖同一代次故障', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) progress.observe('termous.desktops.get', { attachment_id: `a-${i}`, wait_ms: 10000 },
    read({ attachment: { id: `a-${i}`, session_id: 's', connection_generation: 1, state: 'failed', reason: 'desktop_generation_stale' } }), false)
  const notice = progress.drain()[0]!
  assert.equal(notice.reason, 'repeated_failure')
  assert.match(notice.guidance, /desktop_generation_stale/)
  assert.match(notice.guidance, /A failed state must not be treated as ready/)
  assert.equal(progress.beforeCall('termous.desktops.attach', { session_id: 's' }), undefined)
})

test('真实画面或连接代次变化恢复该观察；其他资源不误恢复', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) progress.observe(name, args, capture(i), false)
  progress.drain()
  progress.observe(name, { attachment_id: 'other' }, capture(4, 'changed'), false)
  assert.equal(progress.drain().length, 0)
  progress.observe(name, args, capture(5, 'changed'), false)
  assert.equal(progress.drain()[0]?.status, 'progressed')
  progress.observe(name, args, capture(6, 'changed', 2), false)
  assert.equal(progress.drain().length, 0)
})

test('同一代次附着恢复就绪后更新失败诊断，等待或其他代次不能冒充恢复', () => {
  const progress = new RuntimeToolProgress()
  const result = (state: string, generation = 1) => read({ attachment: { id: 'a', session_id: 's', connection_generation: generation, state, reason: state === 'failed' ? 'desktop_generation_stale' : undefined } })
  for (let i = 0; i < 3; i++) progress.observe('termous.desktops.get', { attachment_id: `a-${i}` }, result('failed'), false)
  progress.drain()
  progress.observe('termous.desktops.get', { attachment_id: 'a', wait_ms: 1000 }, result('preparing'), false)
  progress.observe('termous.desktops.get', { attachment_id: 'a' }, result('ready', 2), false)
  assert.equal(progress.drain().length, 0)
  progress.observe('termous.desktops.get', { attachment_id: 'a' }, result('ready'), false)
  assert.equal(progress.drain()[0]?.status, 'progressed')
})

test('准确创建同一附着的固定快照才恢复普通截图诊断；失败与其他资源不恢复', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) progress.observe(name, args, capture(i), false)
  progress.drain()
  const create = 'termous.desktop_workflows.captures.create'
  progress.observe(create, args, write({ error: { code: 'desktop_not_ready' } }), true)
  progress.observe(create, { attachment_id: 'other' }, write({ snapshot: { snapshot_id: 'other' } }), false)
  assert.equal(progress.drain().length, 0)
  progress.observe(create, args, write({ snapshot: { snapshot_id: 'fixed' } }), false)
  assert.equal(progress.drain()[0]?.status, 'progressed')
  assert.doesNotMatch(progress.summary(), /"status":"detected"/)
})

test('识别 2～4 步往返模式；正常等待和连续输入没有次数上限', () => {
  for (const length of [2, 3, 4]) {
    const progress = new RuntimeToolProgress()
    for (let i = 0; i < length * 3; i++) progress.observe(`fixture.${i % length}`, { id: 'resource' }, read({ state: 'unchanged' }), false)
    assert.ok(progress.drain().some((item) => item.reason === 'cycle'))
  }
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 30; i++) {
    progress.observe('termous.desktop_workflows.runs.get', { run_id: 'r', wait_ms: 500 }, read({ report: { run: { state: 'running' } } }), false)
    progress.observe('approval.get', {}, read({ approval: { state: 'pending' } }), false)
    progress.observe('termous.desktops.keyboard.key', args, write({ accepted: true }), false)
  }
  assert.equal(progress.drain().length, 0)
  for (let i = 0; i < 3; i++) progress.observe('termous.desktop_workflows.runs.get', { run_id: 'r', wait_ms: i }, read({ report: { run: { state: 'completed' } } }), false)
  assert.ok(progress.drain().length)
})

test('检查点恢复证据和摘要，不恢复历史清理权限；摘要有界且不包含输入正文', () => {
  const first = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) first.observe(name, args, capture(i), false)
  first.observe('termous.desktops.keyboard.text', { ...args, text: 'private text' }, write({ state: 'accepted' }), false)
  first.observe('termous.desktop_workflows.captures.release', { snapshot_id: 'released' }, write({ completed: true }), false)
  const second = new RuntimeToolProgress()
  second.restore(JSON.parse(JSON.stringify(first.snapshot())))
  assert.equal(second.summary(), first.summary())
  assert.equal(second.beforeCall('termous.desktop_workflows.captures.release', { snapshot_id: 'released' }), undefined)
  assert.ok(second.summary().length <= 2048)
  assert.doesNotMatch(second.summary(), /private text/)
  for (let i = 4; i <= 6; i++) second.observe(name, args, capture(i), false)
  assert.equal(second.drain()[0]?.count, 6)
})

test('短周期窗口包含实际输入与等待，不把跨很久的观察拼成最近循环', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) {
    progress.observe('fixture.a', args, read({ state: 'same' }), false)
    progress.observe('fixture.b', args, read({ state: 'same' }), false)
    for (let j = 0; j < 12; j++) progress.observe('termous.desktops.keyboard.key', args, write({ accepted: true }), false)
  }
  assert.equal(progress.drain().some((notice) => notice.reason === 'cycle'), false)
})

test('中文状态按字节限制检查点大小，恢复后的摘要仍包含当前代次', () => {
  const progress = new RuntimeToolProgress()
  for (let resource = 0; resource < 50; resource++) for (let count = 0; count < 3; count++) {
    progress.observe(name, { attachment_id: `资源${'甲'.repeat(70)}${resource}` }, capture(count, 'same', resource + 1), false)
  }
  const snapshot = progress.snapshot()
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 48 * 1024)
  const restored = new RuntimeToolProgress()
  restored.restore(snapshot)
  assert.ok(restored.summary().length > 0)
  const single = new RuntimeToolProgress()
  single.observe(name, args, capture(1, 'frame', 9), false)
  assert.match(single.summary(), /"connection_generation":9/)
})

test('已释放快照不因换请求标识再次派发，其他资源和后续创建仍可清理', () => {
  const progress = new RuntimeToolProgress()
  const name = 'termous.desktop_workflows.captures.release'
  const args = { snapshot_id: 'old', client_request_id: 'one' }
  assert.equal(progress.beforeCall(name, args), undefined)
  progress.observe(name, args, write({ completed: true }), false)
  assert.match(progress.beforeCall(name, { ...args, client_request_id: 'two' })!, /captures.create/)
  assert.equal(progress.hidden(name), true)
  assert.equal(progress.beforeCall(name, { snapshot_id: 'other' }), undefined)
  progress.rediscover(name)
  assert.equal(progress.hidden(name), false)
  assert.ok(progress.beforeCall(name, args))
  progress.observe('termous.desktop_workflows.captures.create', {}, write({ snapshot: { snapshot_id: 'new' } }), false)
  assert.equal(progress.hidden(name), false)
  assert.equal(progress.beforeCall(name, { snapshot_id: 'new' }), undefined)
  progress.reset()
  assert.ok(progress.beforeCall(name, args))
})

test('只有明确确认的终态才保护；不吞失败，不把其他代次或可重连会话永久关闭', () => {
  const progress = new RuntimeToolProgress()
  const name = 'termous.desktops.control.release'
  const args = { attachment_id: 'a', grant_id: 'g1' }
  progress.observe(name, args, write({ completed: true }), true)
  assert.equal(progress.beforeCall(name, args), undefined)
  progress.observe(name, args, write({ completed: false }), false)
  assert.equal(progress.beforeCall(name, args), undefined)
  progress.observe(name, args, write({ completed: true }), false)
  assert.ok(progress.beforeCall(name, args))
  assert.equal(progress.beforeCall(name, { ...args, grant_id: 'g2' }), undefined)
  progress.observe('termous.desktops.close', { session_id: 's', connection_generation: 1 }, write({ completed: true }), false)
  assert.equal(progress.beforeCall('termous.desktops.close', { session_id: 's', connection_generation: 2 }), undefined)
  for (const other of ['termous.files.sessions.close', 'termous.commands.interrupt', 'termous.desktop_workflows.runs.control']) {
    progress.observe(other, args, write({ closed: true, completed: true }), false)
    assert.equal(progress.beforeCall(other, args), undefined)
  }
})
